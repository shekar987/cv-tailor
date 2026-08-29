import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// CRUD for the application tracker. RLS ("auth.uid() = user_id") is the real
// boundary; every write is additionally scoped by user id.
//
// No LLM call, so no burst limiter — these are ordinary DB reads/writes.

const MAX_APPLICATIONS = 1000;
const MAX_COMPANY = 200;
const MAX_ROLE = 200;
const MAX_SALARY = 100;
const MAX_NOTES = 2000;
const MAX_CV_REF = 200;
const MAX_SESSION_ID = 64;
const MAX_JD_CHARS = 15_000; // matches /api/tailor's cap

const STATUSES = ["Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

// The list omits tailored_cv (a multi-KB snapshot per row); GET ?id= adds it.
const SELECT_COLUMNS =
  "id, company_name, role, cv_reference, tailor_session_id, status, salary, date_applied, followup_date, notes, job_description, source, created_at, updated_at";
const DETAIL_COLUMNS =
  "id, company_name, role, cv_reference, tailor_session_id, status, salary, date_applied, followup_date, notes, job_description, source, created_at, updated_at, tailored_cv";

const MAX_TAILORED_CV_JSON = 200_000;

// Migrations are applied by hand here, so "column does not exist" (42703) is
// a real, reachable state — name the fix rather than returning a generic 500.
const MIGRATION_HINT =
  "The database is missing the latest migration (supabase/migrations/20260829120000_applications_tailored_cv.sql). Run it in the Supabase SQL editor, then try again.";
function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703";
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
    if (jd.length > MAX_JD_CHARS) return { error: "Job description is too long (max ~15,000 characters)." };
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
    if (id) {
      const { data: row, error: rowError } = await supabase
        .from("applications")
        .select(DETAIL_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (rowError) {
        console.error("applications detail read error:", rowError.message);
        if (isMissingColumn(rowError)) {
          return NextResponse.json({ error: MIGRATION_HINT }, { status: 500 });
        }
        return NextResponse.json({ error: "Could not load that application" }, { status: 500 });
      }
      if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      return NextResponse.json({ application: row });
    }

    const { data: rows, error: readError } = await supabase
      .from("applications")
      .select(SELECT_COLUMNS)
      .order("date_applied", { ascending: false })
      .order("created_at", { ascending: false });

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
      return NextResponse.json(
        { error: "Job description is too long (max ~15,000 characters)." },
        { status: 400 }
      );
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

    const { count } = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_APPLICATIONS) {
      return NextResponse.json(
        { error: `You can track up to ${MAX_APPLICATIONS} applications. Delete some to add more.` },
        { status: 400 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("applications")
      .insert({ ...record, user_id: userId })
      .select("id")
      .single();

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
    return NextResponse.json({ ok: true, id: inserted?.id });
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

    const id = typeof body.id === "string" && body.id ? body.id : null;
    if (!id) return NextResponse.json({ error: "No application specified" }, { status: 400 });

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
