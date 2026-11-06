// POST /api/applications/cleanup (6 Nov 2026, Chunk 19): the safe tracker
// clean-up (lib/trackerCleanup holds every rule). Owner only, signed in.
//   { dryRun: true } (the default, and an empty body): the plan, no write at all.
//   { dryRun: false, ids: [...] }: only those ids, each re-decided from the
//   database now; a protected row among them is a 409 and nothing is applied.
// Writes run as the user (RLS), each conditional on the row being as the plan
// read it. Never sends or sets confirmed_by_user (a body carrying it is a 400).
// No model call.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { readApplicationPages, type OrderableQuery } from "@/lib/applicationRows";
import { readCleanupRequest, runCleanup, type Attachments, type CleanupDb, type CleanupRow } from "@/lib/trackerCleanup";
import { MAX_NOTES_CHARS } from "@/lib/limits";
import { DEFAULT_TIMEZONE, dayKey } from "@/lib/planTime";

export const runtime = "nodejs";

const ROW_COLUMNS =
  "id, company_name, role, status, date_applied, followup_date, notes, created_at, stages_reached, tailor_session_id, sent_cv_name:sent_cv->>fileName, prep_generated_at:prep_pack->>generatedAt";
const ID_BATCH = 150;
const MIGRATION_HINT = "The clean-up needs the tracker's stage history (migration 20261103120000) and the sent-CV column (20260927120000).";

class ReadFailed extends Error {}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const limit = await checkBurstLimit(userId, "tracker-cleanup", { limit: 30, windowSeconds: 3600 });
    if (!limit.ok) return NextResponse.json({ error: "Too many clean-up runs this hour. Try again later." }, { status: 429 });
    if (declaresMoreThan(req, 64 * 1024)) return payloadTooLarge();

    const { data: profile } = await supabase.from("profiles").select("is_unlimited").eq("id", userId).maybeSingle();
    if (!profile?.is_unlimited) return NextResponse.json({ error: "The clean-up is the owner's tool." }, { status: 403 });

    const raw = await req.text();
    let body: unknown = null;
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Send JSON: { dryRun } or { dryRun: false, ids: [...] }." }, { status: 400 });
      }
    }
    const request = readCleanupRequest(body);
    if ("error" in request) return NextResponse.json({ error: request.error }, { status: 400 });

    const db: CleanupDb = {
      async readRows() {
        const read = await readApplicationPages<CleanupRow>(() => supabase.from("applications").select(ROW_COLUMNS) as unknown as OrderableQuery);
        if (read.error) throw new ReadFailed(read.error.code === "42703" || read.error.code === "PGRST204" ? MIGRATION_HINT : read.error.message);
        return read.rows;
      },
      async readAttachments(ids) {
        const out = new Map<string, Attachments>();
        const bump = (id: string, key: keyof Attachments) => {
          const a = out.get(id) ?? { events: 0, interviews: 0 };
          a[key] += 1;
          out.set(id, a);
        };
        for (let i = 0; i < ids.length; i += ID_BATCH) {
          const slice = ids.slice(i, i + ID_BATCH);
          const [events, interviews] = await Promise.all([
            supabase.from("application_events").select("application_id").in("application_id", slice),
            supabase.from("mock_interviews").select("application_id").in("application_id", slice),
          ]);
          // A missing table holds nothing; any other read error must stop a delete.
          for (const [res, key] of [[events, "events"], [interviews, "interviews"]] as const) {
            if (res.error && res.error.code !== "PGRST205" && res.error.code !== "42P01") throw new ReadFailed(res.error.message);
            for (const r of (res.data ?? []) as { application_id: string }[]) bump(r.application_id, key);
          }
        }
        return out;
      },
      async update(id, patch, expect) {
        let q = supabase.from("applications").update(patch).eq("id", id).eq("user_id", userId).in("status", expect.status);
        if (expect.followup_date !== undefined) q = expect.followup_date === null ? q.is("followup_date", null) : q.eq("followup_date", expect.followup_date);
        const { data, error } = await q.select("id");
        if (error) throw new ReadFailed(error.message);
        return (data ?? []).length;
      },
      async appendNote(id, line) {
        const { data, error } = await supabase.rpc("append_application_note", { p_id: id, p_line: line, p_max: MAX_NOTES_CHARS });
        if (error) throw new ReadFailed(error.message);
        return data !== null;
      },
      async remove(id, expect) {
        const { data, error } = await supabase.from("applications").delete().eq("id", id).eq("user_id", userId).in("status", expect.status).select("id");
        if (error) throw new ReadFailed(error.message);
        return (data ?? []).length;
      },
    };

    const result = await runCleanup(db, request, dayKey(Date.now(), DEFAULT_TIMEZONE));
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    if (err instanceof ReadFailed) {
      console.error("tracker cleanup error:", err.message);
      return NextResponse.json({ error: err.message === MIGRATION_HINT ? MIGRATION_HINT : "The clean-up could not read or write your tracker; nothing else was changed." }, { status: err.message === MIGRATION_HINT ? 503 : 500 });
    }
    console.error("tracker cleanup error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "The clean-up failed." }, { status: 500 });
  }
}
