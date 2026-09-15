import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_JD_CHARS, MAX_NOTES_CHARS, JD_TOO_LONG } from "@/lib/limits";
import { packFromRow } from "@/lib/prepPack";

// CRUD for the application tracker. RLS ("auth.uid() = user_id") is the real
// boundary; every write is additionally scoped by user id.
//
// No LLM call, so no burst limiter — these are ordinary DB reads/writes.

const MAX_APPLICATIONS = 1000;
const MAX_COMPANY = 200;
const MAX_ROLE = 200;
const MAX_SALARY = 100;
const MAX_NOTES = MAX_NOTES_CHARS;
const MAX_CV_REF = 200;
const MAX_SESSION_ID = 64;

// A non-UUID id can only be a typo or a probe; Postgres would answer with a
// cast error (22P02) that the handlers would otherwise report as a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const STATUSES = ["Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

// The list omits tailored_cv and prep_pack (multi-KB JSON per row); GET ?id=
// adds them. The list does carry one JSON-path alias — whether a prep pack
// exists — so the tracker can label its Prep action without the payload.
const SELECT_COLUMNS =
  "id, company_name, role, cv_reference, tailor_session_id, status, salary, date_applied, followup_date, notes, job_description, source, created_at, updated_at";
const LIST_COLUMNS = `${SELECT_COLUMNS}, prep_generated_at:prep_pack->>generatedAt`;
const DETAIL_COLUMNS_NO_PREP = `${SELECT_COLUMNS}, tailored_cv`;
const DETAIL_COLUMNS = `${DETAIL_COLUMNS_NO_PREP}, prep_pack`;

const MAX_TAILORED_CV_JSON = 200_000;

// Migrations are applied by hand here, so "column does not exist" is a real,
// reachable state — name the fix rather than returning a generic 500. Postgres
// reports it as 42703 on reads; PostgREST reports it as PGRST204 on writes
// (the column isn't in its schema cache).
const MIGRATION_HINT =
  "The database is missing the latest migration (supabase/migrations/20260829120000_applications_tailored_cv.sql). Run it in the Supabase SQL editor, then try again.";
// Softer variant for the paths that can still succeed without the column.
const SNAPSHOT_WARNING =
  "Saved without the CV snapshot: the database is missing migration 20260829120000_applications_tailored_cv.sql. Run it in the Supabase SQL editor to store CVs with applications.";
// Stage 4's column is the newer of the two, so it is the first to be missing.
const PREP_WARNING =
  "Interview prep packs can't be stored yet: the database is missing migration 20260915120000_applications_prep_pack.sql. Run it in the Supabase SQL editor.";
function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}
const TAILORED_CV_KEYS = ["summary", "skills", "experience", "projects", "profile", "sectionOrder"] as const;

// The CV snapshot comes from our own client, so this only pins the shape and
// size: a plain object, known keys only, bounded JSON.
function cleanTailoredCv(value: unknown): { snapshot: Record<string, unknown> | null } | { error: string } {
  if (value == null) return { snapshot: null };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "Invalid tailored CV snapshot." };
  const input = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const key of TAILORED_CV_KEYS) {
    if (input[key] !== undefined) snapshot[key] = input[key];
  }
  if (JSON.stringify(snapshot).length > MAX_TAILORED_CV_JSON) {
    return { error: "Tailored CV snapshot is too large to store." };
  }
  return { snapshot };
}

// Strict YYYY-MM-DD that also exists on the calendar (rejects 2026-02-30).
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Machine-supplied optional text (session id, cv reference): clamp silently.
function clampOptional(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

type Editable = {
  company_name?: string;
  role?: string;
  status?: Status;
  salary?: string | null;
  date_applied?: string;
  followup_date?: string | null;
  notes?: string | null;
  job_description?: string | null;
};

type Validation = { fields: Editable } | { error: string };

// The fields a user can edit inline. On create (partial = false) every
// required field must be present; on update (partial = true) absent keys are
// left untouched and present keys are validated. Over-cap text is rejected
// rather than truncated so nothing the user typed is silently lost.
function validateEditable(body: Record<string, unknown>, partial: boolean): Validation {
  const fields: Editable = {};

  // A present-but-wrong-typed value is a client bug, not "empty": rejecting it
  // keeps a numeric salary from silently wiping the stored text.
  const typeProblem = (["company_name", "role", "salary", "notes", "job_description"] as const).find(
    (key) => key in body && body[key] != null && typeof body[key] !== "string"
  );
  if (typeProblem) return { error: `${typeProblem.replace("_", " ")} must be text.` };

  if (!partial || "company_name" in body) {
    const company = typeof body.company_name === "string" ? body.company_name.trim() : "";
    if (!company) return { error: "Company name is required." };
    if (company.length > MAX_COMPANY) {
      return { error: `Company name is too long (max ${MAX_COMPANY} characters).` };
    }
    fields.company_name = company;
  }

  if (!partial || "role" in body) {
    const role = typeof body.role === "string" ? body.role.trim() : "";
    if (!role) return { error: "Role is required." };
    if (role.length > MAX_ROLE) return { error: `Role is too long (max ${MAX_ROLE} characters).` };
    fields.role = role;
  }

  if (!partial || "status" in body) {
    if (!partial && body.status === undefined) {
      fields.status = "Applied";
    } else if (!isStatus(body.status)) {
      return { error: "Pick a valid status." };
    } else {
      fields.status = body.status;
    }
  }

  if (!partial || "date_applied" in body) {
    if (!isIsoDate(body.date_applied)) return { error: "Enter a valid date applied (YYYY-MM-DD)." };
    fields.date_applied = body.date_applied;
  }

  if (!partial || "followup_date" in body) {
    if (body.followup_date == null || body.followup_date === "") {
      fields.followup_date = null;
    } else if (!isIsoDate(body.followup_date)) {
      return { error: "Enter a valid follow-up date (YYYY-MM-DD)." };
    } else {
      fields.followup_date = body.followup_date;
    }
  }

  if (!partial || "salary" in body) {
    const salary = typeof body.salary === "string" ? body.salary.trim() : "";
    if (salary.length > MAX_SALARY) return { error: `Salary is too long (max ${MAX_SALARY} characters).` };
    fields.salary = salary || null;
  }

  if (!partial || "notes" in body) {
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > MAX_NOTES) return { error: `Notes are too long (max ${MAX_NOTES} characters).` };
    fields.notes = notes || null;
  }

  // Editable after the fact so a manually added row can get its posting
  // pasted in later. On create the JD is handled with the snapshot fields.
  if (partial && "job_description" in body) {
    const jd = typeof body.job_description === "string" ? body.job_description.trim() : "";
    if (jd.length > MAX_JD_CHARS) return { error: JD_TOO_LONG };
    fields.job_description = jd || null;
  }

  return { fields };
}

// ISO dates compare correctly as strings.
function followupTooEarly(dateApplied: string, followup: string | null): boolean {
  return followup !== null && followup < dateApplied;
}

const FOLLOWUP_ERROR = "Follow-up date can't be earlier than the date applied.";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    // One full record, snapshot included.
    const id = new URL(req.url).searchParams.get("id");
    if (id !== null) {
      if (!isUuid(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      // Two optional columns, applied by hand in order: try both, then without
      // prep_pack, then without either — each rung naming the migration it
      // lacks. The rest of the record is readable at every rung.
      const ladder: { columns: string; warning?: string }[] = [
        { columns: DETAIL_COLUMNS },
        { columns: DETAIL_COLUMNS_NO_PREP, warning: PREP_WARNING },
        { columns: SELECT_COLUMNS, warning: SNAPSHOT_WARNING },
      ];
      let row: Record<string, unknown> | null = null;
      let warning: string | undefined;
      for (let rung = 0; rung < ladder.length; rung++) {
        const { data, error: rowError } = await supabase
          .from("applications")
          .select(ladder[rung].columns)
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (rowError && isMissingColumn(rowError) && rung < ladder.length - 1) continue;
        if (rowError) {
          console.error("applications detail read error:", rowError.message);
          return NextResponse.json({ error: "Could not load that application" }, { status: 500 });
        }
        row = (data as Record<string, unknown> | null) ?? null;
        warning = ladder[rung].warning;
        break;
      }
      if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const snapshot = row.tailored_cv ?? null;
      const prepPack = packFromRow(row.prep_pack);
      return NextResponse.json({
        application: { ...row, tailored_cv: snapshot, prep_pack: prepPack },
        ...(warning ? { warning } : {}),
      });
    }

    const first = await supabase
      .from("applications")
      .select(LIST_COLUMNS)
      .order("date_applied", { ascending: false })
      .order("created_at", { ascending: false });
    let rows = first.data as Record<string, unknown>[] | null;
    let readError = first.error;
    if (readError && isMissingColumn(readError)) {
      // prep_pack not migrated yet — the list must stay quiet about it; the
      // detail read and /api/prep name the migration when it matters.
      const second = await supabase
        .from("applications")
        .select(SELECT_COLUMNS)
        .order("date_applied", { ascending: false })
        .order("created_at", { ascending: false });
      rows = second.data as Record<string, unknown>[] | null;
      readError = second.error;
    }

    if (readError) {
      console.error("applications read error:", readError.message);
      return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
    }
    return NextResponse.json({ applications: rows ?? [] });
  } catch (err) {
    console.error("applications GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const validated = validateEditable(body, false);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const { fields } = validated;
    if (followupTooEarly(fields.date_applied!, fields.followup_date ?? null)) {
      return NextResponse.json({ error: FOLLOWUP_ERROR }, { status: 400 });
    }

    const jobDescription = typeof body.job_description === "string" ? body.job_description.trim() : "";
    if (jobDescription.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    }

    // Only a tailoring run carries a session id / CV reference; manual rows
    // never do, so a forged session id on a manual entry is dropped.
    const source = body.source === "tailored" ? "tailored" : "manual";
    const sessionId = source === "tailored" ? clampOptional(body.tailor_session_id, MAX_SESSION_ID) : null;
    const cvReference = source === "tailored" ? clampOptional(body.cv_reference, MAX_CV_REF) : null;
    const cv = source === "tailored" ? cleanTailoredCv(body.tailored_cv) : { snapshot: null };
    if ("error" in cv) {
      return NextResponse.json({ error: cv.error }, { status: 400 });
    }

    const record = {
      ...fields,
      source,
      tailor_session_id: sessionId,
      cv_reference: cvReference,
      job_description: jobDescription || null,
      tailored_cv: cv.snapshot,
    };

    // Duplicate rule: one row per tailoring session. Check-then-insert rather
    // than upsert — PostgREST's onConflict can't target the partial unique
    // index. The existing row is returned untouched so inline edits the user
    // made in the tracker since aren't overwritten.
    if (sessionId) {
      const { data: existing, error: existingError } = await supabase
        .from("applications")
        .select("id")
        .eq("user_id", userId)
        .eq("tailor_session_id", sessionId)
        .maybeSingle();
      if (existingError) {
        console.error("applications lookup error:", existingError.message);
        return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
      }
      if (existing) {
        return NextResponse.json({ ok: true, id: existing.id, alreadySaved: true });
      }
    }

    // The cap is only enforceable if the count is trusted: a failed count is
    // an error, not zero.
    const { count, error: countError } = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) {
      console.error("applications count error:", countError.message);
      return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_APPLICATIONS) {
      return NextResponse.json(
        { error: `You can track up to ${MAX_APPLICATIONS} applications. Delete some to add more.` },
        { status: 400 }
      );
    }

    let { data: inserted, error: insertError } = await supabase
      .from("applications")
      .insert({ ...record, user_id: userId })
      .select("id")
      .single();

    // The snapshot column hasn't been migrated in yet: save everything else
    // rather than blocking the tracker, and tell the client why the CV is
    // missing.
    let warning: string | undefined;
    if (insertError && isMissingColumn(insertError)) {
      const { tailored_cv: _dropped, ...withoutSnapshot } = record;
      void _dropped;
      ({ data: inserted, error: insertError } = await supabase
        .from("applications")
        .insert({ ...withoutSnapshot, user_id: userId })
        .select("id")
        .single());
      if (!insertError) warning = SNAPSHOT_WARNING;
    }

    if (insertError) {
      // 23505 = the partial unique index fired: two clicks raced past the
      // check above. Resolve to the row that won.
      if (insertError.code === "23505" && sessionId) {
        const { data: winner } = await supabase
          .from("applications")
          .select("id")
          .eq("user_id", userId)
          .eq("tailor_session_id", sessionId)
          .maybeSingle();
        if (winner) {
          return NextResponse.json({ ok: true, id: winner.id, alreadySaved: true });
        }
      }
      console.error("applications insert error:", insertError.message);
      if (isMissingColumn(insertError)) {
        return NextResponse.json({ error: MIGRATION_HINT }, { status: 500 });
      }
      return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: inserted?.id, ...(warning ? { warning } : {}) });
  } catch (err) {
    console.error("applications POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (body.id === undefined || body.id === null || body.id === "") {
      return NextResponse.json({ error: "No application specified" }, { status: 400 });
    }
    if (!isUuid(body.id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const id = body.id;

    const validated = validateEditable(body, true);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const { fields } = validated;
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // The date rule spans two columns; when the patch carries only one of
    // them, compare against what's stored.
    let dateApplied = fields.date_applied;
    let followup = "followup_date" in fields ? (fields.followup_date ?? null) : undefined;
    if (dateApplied === undefined || followup === undefined) {
      const { data: existing, error: existingError } = await supabase
        .from("applications")
        .select("date_applied, followup_date")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (existingError) {
        console.error("applications lookup error:", existingError.message);
        return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json({ error: "Application not found" }, { status: 404 });
      }
      dateApplied ??= existing.date_applied as string;
      if (followup === undefined) followup = (existing.followup_date as string | null) ?? null;
    }
    if (followupTooEarly(dateApplied, followup)) {
      return NextResponse.json({ error: FOLLOWUP_ERROR }, { status: 400 });
    }

    // Scoped by id as well as RLS: belt and braces on a write. RLS hides
    // another user's row rather than erroring, so an empty result means
    // "not yours or not there".
    const { data: updated, error: updateError } = await supabase
      .from("applications")
      .update(fields)
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");

    if (updateError) {
      console.error("applications update error:", updateError.message);
      return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("applications PUT error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "No application specified" }, { status: 400 });
    if (!isUuid(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    const { error: deleteError } = await supabase
      .from("applications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("applications delete error:", deleteError.message);
      return NextResponse.json({ error: "Could not delete that application" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("applications DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete that application" }, { status: 500 });
  }
}
