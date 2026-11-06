import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { MAX_APPLICATIONS, readApplicationPages, type OrderableQuery } from "@/lib/applicationRows";
import { coldEmailKey, coldEmailRecord, MAX_BULK_ROWS, planBulkUpsert, readColdEmails, type ExistingRow } from "@/lib/coldEmails";
import { oldStatusLabel } from "@/lib/tracker";

// POST /api/applications/bulk-upsert (6 Nov 2026, Chunk 18): cold emails a
// Gmail Sent sweep found, logged on the tracker. Body: an array of
// { company_name, role, contact_email, date_sent, followup_date, notes }, or
// { rows: [...] }. One row per (company, contact email); a missing one is
// inserted as Applied with source "cold-email"; an existing one is NEVER
// changed — not its status, not its notes (lib/coldEmails planBulkUpsert has
// no update in it). Posting the same payload twice inserts nothing the second
// time. No model call; burst-limited like the job import.
//
// Answers { inserted: [{ index, id }], existing: [{ index, id, status,
// matchedWithoutEmail }], duplicateInPayload: [index], problems: [{ index,
// error }] } — the sweep can see exactly what happened to each row it sent.

export const runtime = "nodejs";

const MIGRATION_HINT =
  "Logging cold emails needs the database migration supabase/migrations/20261106120000_applications_cold_email.sql. Run it in the Supabase SQL editor, then try again.";
const MAX_BODY_BYTES = 512 * 1024;
const EXISTING_COLUMNS = "id, company_name, contact_email, status, source, role";

function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

// The source or contact-email CHECK refusing a row means the migration is missing;
// a status CHECK is the older spelling (lib/tracker oldStatusLabel).
function isMigrationCheck(err: { code?: string; message?: string } | null): boolean {
  return err?.code === "23514" && /applications_(?:source|contact_email)_check/.test(err.message ?? "");
}

function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const limit = await checkBurstLimit(userId, "bulk-upsert", { limit: 20, windowSeconds: 3600 });
    if (!limit.ok) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
      return NextResponse.json({ error: `Too many cold-email syncs this hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, { status: 429 });
    }
    if (declaresMoreThan(req, MAX_BODY_BYTES)) return payloadTooLarge();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Send a JSON array of rows, or { rows: [...] }." }, { status: 400 });
    }
    const read = readColdEmails(body, todayInLondon());
    if (read.tooMany) {
      return NextResponse.json({ error: `Send at most ${MAX_BULK_ROWS} rows at a time.` }, { status: 400 });
    }
    if (read.problems.some((p) => p.index < 0)) {
      return NextResponse.json({ error: read.problems[0].error, problems: read.problems }, { status: 400 });
    }

    // Every row the user has, to dedupe against (RLS: only theirs).
    const existingRead = await readApplicationPages<ExistingRow>(
      () => supabase.from("applications").select(EXISTING_COLUMNS) as unknown as OrderableQuery
    );
    if (existingRead.error) {
      if (isMissingColumn(existingRead.error)) {
        return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      console.error("bulk-upsert read error:", existingRead.error.message);
      return NextResponse.json({ error: "Could not read your tracker" }, { status: 500 });
    }
    const existing = existingRead.rows;
    const plan = planBulkUpsert(existing, read.rows);

    if (existing.length + plan.insert.length > MAX_APPLICATIONS) {
      return NextResponse.json(
        { error: `You can track up to ${MAX_APPLICATIONS} applications. These ${plan.insert.length} would pass it: delete some to add more.` },
        { status: 400 }
      );
    }

    let inserted: { index: number; id: string }[] = [];
    if (plan.insert.length > 0) {
      const records = (status: string) => plan.insert.map(({ row }) => ({ ...coldEmailRecord(row, status), user_id: userId }));
      const back = "id, company_name, contact_email";
      let { data, error } = await supabase.from("applications").insert(records("applied")).select(back);
      if (error && error.code === "23514" && !isMigrationCheck(error)) {
        // A database before the status migration stores the old label.
        ({ data, error } = await supabase.from("applications").insert(records(oldStatusLabel("applied") ?? "Applied")).select(back));
      }
      if (error) {
        if (isMissingColumn(error) || isMigrationCheck(error)) {
          return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
        }
        console.error("bulk-upsert insert error:", error.message);
        return NextResponse.json({ error: "Could not save those cold emails" }, { status: 500 });
      }
      // Each new id matched back to its row by the dedupe key, never by position.
      const idByKey = new Map(((data ?? []) as { id: string; company_name: string; contact_email: string }[]).map((r) => [coldEmailKey(r.company_name, r.contact_email), r.id]));
      inserted = plan.insert
        .map(({ index, row }) => ({ index, id: idByKey.get(coldEmailKey(row.company_name, row.contact_email)) }))
        .filter((r): r is { index: number; id: string } => typeof r.id === "string");
    }

    return NextResponse.json({
      ok: true,
      inserted,
      existing: plan.existing,
      duplicateInPayload: plan.duplicateInPayload,
      problems: read.problems,
    });
  } catch (err) {
    console.error("bulk-upsert error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save those cold emails" }, { status: 500 });
  }
}
