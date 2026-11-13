import { NextRequest, NextResponse } from "next/server";
import { autoCloseMessage, closesOnConfirmation, confirmationAdded, confirmationIn } from "@/lib/autoClose";
import { ACTION_MIGRATION_HINT } from "@/lib/planSchema";
import { DEFAULT_TIMEZONE, dayKey } from "@/lib/planTime";
import { DUPLICATE_NOTE, cleanNoteLine, decideNotesWrite, isRecentDuplicate, sameVersion, stampNoteLine, staleRefusal } from "@/lib/notesWrite";
import { MAX_ACTIVE_RULES, companyKey, normalizeRule, readCooldowns, ruleExists, type CompanyRule } from "@/lib/companyRules";
import { dueWithin, parseDueParam, type DueEvent, type DueRow } from "@/lib/deadlines";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { MAX_JD_CHARS, MAX_COVER_LETTER_CHARS, JD_TOO_LONG } from "@/lib/limits";
import { packFromRow } from "@/lib/prepPack";
import { matchAtsKeywords, tailoredSectionsText } from "@/lib/atsMatch";
import { seniorityOf } from "@/lib/insights";
import { GATE_CATEGORIES } from "@/lib/knockouts";
import { SENT_CV_BUCKET, normalizeSentCv, publicSentCv, ownsPath } from "@/lib/sentCv";
import { apiStatus, oldStatusLabel, clearsFollowup, followupClearedNote, appendNoteLine } from "@/lib/tracker";
import { isFormatStyleId, type FormatStyleId } from "@/lib/formatStyles/ids";
import { normalizeStyleCheck } from "@/lib/styleCheck";
import { REFERRAL_MIGRATION_HINT } from "@/lib/referrals";
import { triageForUser, withTriage } from "@/lib/applicationTriage";
import {
  LITE_COLUMNS, LITE_DUE_STATUSES, MAX_APPLICATIONS, liteDuePendingFilter, afterCursor, encodeCursor, liteSearchFilter, readApplicationPages, readListMode, readLiteQuery,
  storedValuesFor, toListRow, toLiteRow, toPageRow, type OrderableQuery,
} from "@/lib/applicationRows";
import {
  FOLLOWUP_ERROR, MAX_NOTES, clampOptional, followupTooEarly, readLoggedBy, resolveSentDate, validateEditable,
} from "@/lib/applicationFields";
import { idempotent, jsonBodyOf } from "@/lib/idempotentRoute";
import { MOVE_BACK_RECORDED, REOPEN_RECORDED, REPORT_DISMISSED, REPORT_HELD, UNDO_EXPIRED, decideClosingWrite, isEnding, mergePendingOutcome, normalizePendingOutcome, normalizeUndoSnapshot, reportTaken, reportedNote, undoIsLive, undoWrite, type ClosingCurrent, type PendingOutcome } from "@/lib/closing";

const REFERRAL_KEYS = ["referral", "referrer_name", "req_id", "referral_status"] as const;

// CRUD for the application tracker. RLS ("auth.uid() = user_id") is the real
// boundary; every write is additionally scoped by user id.
//
// No LLM call, so no burst limiter — these are ordinary DB reads/writes.
//
// Since 12 Nov 2026 (Chunk 22) every write (POST, PUT, PATCH) honours an
// Idempotency-Key header (lib/idempotency): the same key runs once.

// No model call and no file: a minute is ample, and the idempotency claim's
// staleness (2 minutes) depends on a request never outliving it.
export const maxDuration = 60;

const MAX_CV_REF = 200;
const MAX_SESSION_ID = 64;
const PATH = "/api/applications";
// A dateless row on a database that still requires a date (before migration 20261112120000).
const DATE_MIGRATION_HINT =
  "Saving a Ready to submit row without a date applied needs migration 20261112120000_fast_tracker_api.sql. Run it in the Supabase SQL editor, or send the date.";
function isNotNullViolation(error: { code?: string } | null): boolean {
  return !!error && error.code === "23502";
}
const londonToday = () => dayKey(Date.now(), DEFAULT_TIMEZONE);

// A non-UUID id can only be a typo or a probe; Postgres would answer with a
// cast error (22P02) that the handlers would otherwise report as a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// The status list lives in lib/tracker (one copy for the sheet, this route,
// the export and the insights). A database without migration 20261103120000
// refuses the new keys (23514): a status with an old label is written with that
// label instead, and one without (Assessment, Won, Ghosted) answers 503
// needs_migration rather than a 500.
const STATUS_MIGRATION_HINT =
  "That status needs the database migration supabase/migrations/20261103120000_application_events.sql. Run it in the Supabase SQL editor, then try again.";
const OUTCOME_MIGRATION_HINT = STATUS_MIGRATION_HINT.replace("That status needs", "Saving a rejection reason needs");
function isStatusCheckViolation(error: { code?: string; message?: string } | null): boolean {
  return !!error && error.code === "23514";
}

// The list omits tailored_cv and prep_pack (multi-KB JSON per row); GET ?id=
// adds them. The list does carry one JSON-path alias — whether a prep pack
// exists — so the tracker can label its Prep action without the payload.
// notes and job_description are read here but leave the server as a preview and
// a flag (lib/applicationRows toListRow); PostgREST has no way to select a
// substring or a "has text" test, and the detail read returns them in full.
const SELECT_COLUMNS =
  "id, company_name, role, cv_reference, tailor_session_id, status, salary, date_applied, followup_date, notes, job_description, source, created_at, updated_at";
// gates: the pre-check's eligibility read stored with the snapshot, so the
// sheet can show "Knockout: <quote>" / "Clear" per row without the detail read;
// gates.triage is the JD triage (lib/triage/jdTriage), computed here.
// format_style: the format style the CV was made with, or the one picked by
// hand for a manual row (lib/formatStyles; absent = not recorded).
// logged_by: who logged the row ("you", or an automation's name; lib/applicationFields
// readLoggedBy), for the "Logged by" badge (Chunk 22).
// cover_letter_text: the letter stored with a tailored snapshot, read here only to answer
// `has_cover_letter` (lib/applicationRows toListRow); the text never leaves the server in
// the list, like the JD's (Chunk 24: the row's CV and Letter buttons).
const LIST_COLUMNS = `${SELECT_COLUMNS}, prep_generated_at:prep_pack->>generatedAt, gates:tailored_cv->gates, format_style:tailored_cv->>formatStyle, logged_by:tailored_cv->>loggedBy, cover_letter_text:tailored_cv->>coverLetter`;
// sent_cv_name: the file name of the CV the user uploaded for the row
// (lib/sentCv, migration 20260927120000), so the sheet can mark it.
const LIST_COLUMNS_SENT = `${LIST_COLUMNS}, sent_cv_name:sent_cv->>fileName`;
// Who spoke last and when (migration 20261030120000): the "Reply owed" badge
// (lib/tracker isReplyOwed). The newest optional columns, so the first rung.
const LIST_COLUMNS_CONTACT = `${LIST_COLUMNS_SENT}, last_contact_from, last_contact_at`;
// The referral columns (lib/referrals, migration 20261031120000) on top.
const LIST_COLUMNS_REFERRAL = `${LIST_COLUMNS_CONTACT}, referral, referrer_name, req_id, referral_status`;
// The stages a row has passed through and why it ended (migration 20261103120000).
const LIST_COLUMNS_STAGES = `${LIST_COLUMNS_REFERRAL}, stages_reached, outcome_reason`;
// Closing a row (migration 20261104130000; lib/closing), the newest rung.
const LIST_COLUMNS_CLOSED = `${LIST_COLUMNS_STAGES}, closed_at, close_reason, lesson, pending_outcome`;
// Who a cold email went to (migration 20261106120000; lib/coldEmails), the newest rung.
const LIST_COLUMNS_COLD = `${LIST_COLUMNS_CLOSED}, contact_email`;
// The address an application was made from and the next thing due (migration
// 20261110120000, Chunk 21; lib/deadlines): the newest rung.
const DEADLINE_KEYS = ["applied_from_email", "next_deadline", "deadline_note"] as const;
const LIST_COLUMNS_DEADLINE = `${LIST_COLUMNS_COLD}, ${DEADLINE_KEYS.join(", ")}`;
// The cover letter file sent with it (migration 20261112120000, Chunk 22), by name, for the
// row's Letter button (Chunk 24): the newest rung.
const LIST_COLUMNS_LETTER = `${LIST_COLUMNS_DEADLINE}, sent_letter_name:sent_cover_letter->>fileName`;
const DEADLINE_MIGRATION_HINT =
  "Saving the applied-from address or a deadline needs migration 20261110120000_safe_notes_cooldowns_deadlines.sql. Run it in the Supabase SQL editor, then try again.";
const DEADLINE_SAVED_WITHOUT =
  "Saved without the applied-from address and deadline: run migration 20261110120000_safe_notes_cooldowns_deadlines.sql in the Supabase SQL editor.";
// What GET ?due= reads: just enough for lib/deadlines, newest columns first.
const DUE_LADDER = [
  `id, company_name, role, status, followup_date, closed_at, ${DEADLINE_KEYS.join(", ")}`,
  "id, company_name, role, status, followup_date, closed_at",
  "id, company_name, role, status, followup_date",
];
const CLOSED_MIGRATION_HINT = "Closing a row needs migration 20261104130000_applications_closed.sql. Run it in the Supabase SQL editor, then try again.";
const CLOSED_SAVED_WITHOUT = "The status is saved, but the date, reason and lesson are not: run migration 20261104130000_applications_closed.sql in the Supabase SQL editor.";
// updated_at: a Reopen's report note is composed from these notes, so its write is guarded by it.
const CLOSING_LADDER = ["status, stages_reached, pending_outcome, lesson, closed_at, close_reason, followup_date, notes, updated_at", "status, stages_reached", "status"];
const UNDO_MIGRATION_HINT = "Undo needs migration 20261105120000_stages_append_only.sql. Run it in the Supabase SQL editor.";
const UNDO_READ = "status, notes, followup_date, undo_snapshot";
const UNDO_ANSWER = "status, stages_reached, closed_at, close_reason, lesson, pending_outcome, followup_date, notes";
const CLOSE_KEYS = ["closed_at", "close_reason", "lesson", "pending_outcome"] as const;
const CONTACT_MIGRATION_HINT =
  "Recording who spoke last needs the database migration supabase/migrations/20261030120000_applications_last_contact.sql. Run it in the Supabase SQL editor, then try again.";
const DETAIL_COLUMNS_NO_PREP = `${SELECT_COLUMNS}, tailored_cv`;
const DETAIL_COLUMNS = `${DETAIL_COLUMNS_NO_PREP}, prep_pack`;
const DETAIL_COLUMNS_SENT = `${DETAIL_COLUMNS}, sent_cv`;
// The cover letter file sent with it (migration 20261112120000, Chunk 22): the newest rung.
const DETAIL_COLUMNS_LETTER = `${DETAIL_COLUMNS_SENT}, sent_cover_letter`;

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
const SECTION_KEYS = ["summary", "skills", "experience", "projects", "profile", "sectionOrder"] as const;

// The role's terms the client asks to be scored against the snapshot: the
// analyser's keyword list and required skills. Bounded so a hand-written row
// can't store an arbitrary list; verdicts are never accepted from the client.
const MAX_ATS_TERMS = 25;
const MAX_ATS_TERM_CHARS = 120;

function termList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const term of value) {
    if (typeof term !== "string") continue;
    const t = term.trim().slice(0, MAX_ATS_TERM_CHARS);
    if (!t) continue;
    out.push(t);
    if (out.length >= MAX_ATS_TERMS) break;
  }
  return out;
}

// The stored keyword analysis is computed HERE, from the snapshot text, with
// the same matcher and the same text assembly the tailor route reconciles
// with — so the tracker's figures are re-derivable from the stored document
// rather than being whatever a client claimed. Only the lists are stored;
// counts are derived on read.
function scoreSnapshot(snapshot: Record<string, unknown>, atsInput: unknown) {
  if (!atsInput || typeof atsInput !== "object" || Array.isArray(atsInput)) return null;
  const a = atsInput as Record<string, unknown>;
  const keywords = termList(a.keywords);
  const required = termList(a.required);
  if (keywords.length === 0 && required.length === 0) return null;
  const text = tailoredSectionsText({
    summary: snapshot.summary,
    skills: snapshot.skills,
    experience: snapshot.experience,
    projects: snapshot.projects,
  });
  // Lists plus explicit counts: the denominator is what the insights divide
  // by, and the backfill (which never had the lists) stores counts alone.
  const verdict = (terms: string[]) => {
    const r = matchAtsKeywords(text, terms);
    return { hits: r.matchedKeywords, misses: r.missedKeywords, matched: r.matched, total: r.total };
  };
  return { keywords: verdict(keywords), required: verdict(required), computedAt: new Date().toISOString() };
}

// The eligibility-gate read the pre-check gave this run (lib/knockouts
// GatesSummary), stored for the tracker's insights: which reads went on to
// progress. Bounded enums and counts only; anything malformed is dropped.
const GATE_READS = ["apply", "long_shot", "skip"] as const;
const GATE_VERDICTS = ["pass", "soft", "hard", "unknown"] as const;
function cleanGates(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const g = value as Record<string, unknown>;
  if (typeof g.read !== "string" || !(GATE_READS as readonly string[]).includes(g.read)) return null;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(50, Math.round(v))) : 0);
  const items = Array.isArray(g.items)
    ? g.items
        .filter(
          (x): x is { category: string; verdict: string; requirement?: unknown } =>
            !!x &&
            typeof x === "object" &&
            (GATE_CATEGORIES as readonly string[]).includes((x as { category?: unknown }).category as string) &&
            (GATE_VERDICTS as readonly string[]).includes((x as { verdict?: unknown }).verdict as string)
        )
        .slice(0, 20)
        .map((x) => ({
          category: x.category,
          verdict: x.verdict,
          // The JD sentence the gate was read from, bounded like the detector's snippet.
          ...(typeof x.requirement === "string" && x.requirement.trim() ? { requirement: x.requirement.trim().slice(0, 200) } : {}),
        }))
    : [];
  return { read: g.read, hard: count(g.hard), soft: count(g.soft), unknown: count(g.unknown), items };
}

// The CV snapshot comes from our own client, so this only pins the shape and
// size: a plain object, known keys only, bounded JSON. Two keys ride along
// with the sections — the cover letter as sent (text, capped, rejected rather
// than truncated) and the server-scored keyword analysis above.
function cleanTailoredCv(value: unknown, role: string): { snapshot: Record<string, unknown> | null } | { error: string } {
  if (value == null) return { snapshot: null };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "Invalid tailored CV snapshot." };
  const input = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const key of SECTION_KEYS) {
    if (input[key] !== undefined) snapshot[key] = input[key];
  }
  if (input.coverLetter != null) {
    if (typeof input.coverLetter !== "string") return { error: "Cover letter must be text." };
    const letter = input.coverLetter.trim();
    if (letter.length > MAX_COVER_LETTER_CHARS) {
      return { error: `Cover letter is too long to store (max ${MAX_COVER_LETTER_CHARS.toLocaleString("en-GB")} characters).` };
    }
    if (letter) snapshot.coverLetter = letter;
  }
  const ats = scoreSnapshot(snapshot, input.ats);
  if (ats) snapshot.ats = ats;
  const gates = cleanGates(input.gates);
  if (gates) snapshot.gates = gates;
  // Prompt 13: the page count the CV was sent at and the posting's age at
  // application (both read client-side, both bounded here).
  const pages = Number(input.pages);
  if (Number.isFinite(pages) && pages >= 1 && pages <= 5) snapshot.pages = Math.round(pages);
  const age = Number(input.postingAgeDays);
  if (Number.isFinite(age) && age >= 0 && age <= 365) snapshot.postingAgeDays = Math.round(age);
  // Role seniority, read off the title here so every save carries it.
  if (role) snapshot.seniority = seniorityOf(role);
  // The format style this CV was made with (lib/formatStyles) and the style's
  // own format check as the page re-ran it on the edited preview
  // (lib/styleCheck), both bounded; absent = not recorded.
  if (isFormatStyleId(input.formatStyle)) snapshot.formatStyle = input.formatStyle;
  const styleCheck = normalizeStyleCheck(input.styleCheck);
  if (styleCheck) snapshot.styleCheck = styleCheck;
  if (JSON.stringify(snapshot).length > MAX_TAILORED_CV_JSON) {
    return { error: "Tailored CV snapshot is too large to store." };
  }
  return { snapshot };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    // ?due=48h: what is due in the next 48 hours (lib/deadlines), the same list as the red
    // strip on /applications, so a sweep can push it at 07:00. The plain list is unchanged.
    const params = new URL(req.url).searchParams;
    const dueHours = parseDueParam(params.get("due"));
    if (dueHours === "invalid") return NextResponse.json({ error: 'Use due=<hours>h, up to 168h (for example due=48h).' }, { status: 400 });
    if (dueHours !== null) {
      let dueRows: Record<string, unknown>[] = [];
      let dueError: { code?: string; message: string } | null = null;
      let withDeadlines = true;
      for (let rung = 0; rung < DUE_LADDER.length; rung++) {
        const read = await readApplicationPages(() => supabase.from("applications").select(DUE_LADDER[rung]) as unknown as OrderableQuery);
        dueRows = read.rows ?? [];
        dueError = read.error;
        withDeadlines = rung === 0;
        if (!(dueError && isMissingColumn(dueError) && rung < DUE_LADDER.length - 1)) break;
      }
      if (dueError) {
        console.error("applications due read error:", dueError.message);
        return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
      }
      // The plan's open events too (an assessment added in the Action Centre); none until its
      // migration, and a failed read only leaves them out.
      const { data: eventRows, error: eventsError } = await supabase
        .from("application_events")
        .select("id, application_id, title, status, due_at, starts_at, date_only")
        .eq("user_id", userId)
        .eq("status", "scheduled")
        .limit(2000);
      if (eventsError && eventsError.code !== "PGRST205" && eventsError.code !== "42P01") console.error("applications due events read error:", eventsError.code ?? "unknown");
      const now = Date.now();
      const due = dueWithin(dueRows as unknown as DueRow[], now, dueHours, DEFAULT_TIMEZONE, eventsError ? [] : ((eventRows ?? []) as DueEvent[])).map((item) => ({ ...item, status: apiStatus(item.status) }));
      return NextResponse.json({ due, hours: dueHours, now: new Date(now).toISOString(), ...(withDeadlines ? {} : { warning: DEADLINE_MIGRATION_HINT.replace("Saving the applied-from address or a deadline needs", "Deadlines and applied-from addresses need") }) });
    }

    // One full record, snapshot included.
    const id = params.get("id");
    if (id !== null) {
      if (!isUuid(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      // Optional columns, applied by hand in order: try them all, then without
      // sent_cv (quietly — only an upload needs it, and the upload route names
      // the migration), then without prep_pack, then without either — each
      // later rung naming the migration it lacks. The rest of the record is
      // readable at every rung.
      const ladder: { columns: string; warning?: string }[] = [
        { columns: DETAIL_COLUMNS_LETTER },
        { columns: DETAIL_COLUMNS_SENT },
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
      // The uploaded CV's record without its storage path (lib/sentCv).
      const sentCv = publicSentCv(normalizeSentCv(row.sent_cv));
      const sentLetter = publicSentCv(normalizeSentCv(row.sent_cover_letter));
      return NextResponse.json({
        application: { ...row, status: apiStatus(row.status), tailored_cv: snapshot, prep_pack: prepPack, sent_cv: sentCv, sent_cover_letter: sentLetter },
        ...(warning ? { warning } : {}),
      });
    }

    // ?lite=1: the light list for automations (lib/applicationRows readLiteQuery): seven
    // small fields, filtered in the database, one select per 1,000 rows. Columns every
    // database has, so no ladder; due_by's pending-outcome filter alone is dropped on a
    // database without migration 20261104130000.
    if (params.get("lite") === "1") {
      const lite = readLiteQuery(params);
      if ("error" in lite) return NextResponse.json({ error: lite.error }, { status: 400 });
      const { q, since, statuses, dueBy, limit } = lite.query;
      let pendingFilter = true;
      const build = () => {
        let query = supabase.from("applications").select(LITE_COLUMNS).eq("user_id", userId);
        if (q) query = query.or(liteSearchFilter(q));
        if (since) query = query.gte("date_applied", since);
        if (statuses) query = query.in("status", storedValuesFor(statuses));
        // The rows the page's "Follow-ups due today" counts (lib/followupsDue).
        if (dueBy) {
          query = query.lte("followup_date", dueBy).in("status", storedValuesFor(LITE_DUE_STATUSES));
          if (pendingFilter) query = query.or(liteDuePendingFilter());
        }
        return query.order("date_applied", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: true });
      };
      // One row past the limit says whether there is more.
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; from <= limit; from += 1000) {
        const to = Math.min(from + 999, limit);
        let res = await build().range(from, to);
        if (res.error && dueBy && pendingFilter && isMissingColumn(res.error)) {
          pendingFilter = false;
          res = await build().range(from, to);
        }
        if (res.error) {
          console.error("applications lite read error:", res.error.code ?? "unknown");
          return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
        }
        const page = (res.data ?? []) as unknown as Record<string, unknown>[];
        rows.push(...page);
        if (page.length < to - from + 1) break;
      }
      return NextResponse.json({ applications: rows.slice(0, limit).map(toLiteRow), more: rows.length > limit });
    }

    // A missing optional column drops one rung (sent_cv, then prep_pack /
    // tailored_cv) — the list stays quiet about it; the detail read, /api/prep
    // and the upload route name the migration when it matters.
    let rows: Record<string, unknown>[] | null = null;
    let readError: { code?: string; message: string } | null = null;
    const listLadder = [LIST_COLUMNS_LETTER, LIST_COLUMNS_DEADLINE, LIST_COLUMNS_COLD, LIST_COLUMNS_CLOSED, LIST_COLUMNS_STAGES, LIST_COLUMNS_REFERRAL, LIST_COLUMNS_CONTACT, LIST_COLUMNS_SENT, LIST_COLUMNS, SELECT_COLUMNS];

    // ?stage=&limit=&cursor= is one page (lib/applicationRows readListMode): the same
    // columns and order, no notes preview. No parameters, or ?all=1, is the full
    // list below, unchanged: the owner's sweeps read it.
    const mode = readListMode(new URL(req.url).searchParams);
    if (mode.mode === "error") return NextResponse.json({ error: mode.error }, { status: 400 });
    if (mode.mode === "page") {
      for (let rung = 0; rung < listLadder.length; rung++) {
        let query = supabase.from("applications").select(listLadder[rung]);
        if (mode.statuses) query = query.in("status", storedValuesFor(mode.statuses));
        if (mode.cursor) query = query.or(afterCursor(mode.cursor));
        const res = await query
          .order("date_applied", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .limit(mode.limit + 1);
        if (res.error && isMissingColumn(res.error) && rung < listLadder.length - 1) continue;
        if (res.error) {
          console.error("applications page read error:", res.error.message);
          return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
        }
        const data = (res.data ?? []) as unknown as Record<string, unknown>[];
        const page = data.slice(0, mode.limit);
        const nextCursor = data.length > mode.limit ? encodeCursor(page[page.length - 1]) : null;
        return NextResponse.json({ applications: page.map(toPageRow), nextCursor });
      }
    }
    for (let rung = 0; rung < listLadder.length; rung++) {
      const read = await readApplicationPages(
        () => supabase.from("applications").select(listLadder[rung]) as unknown as OrderableQuery
      );
      rows = read.rows;
      readError = read.error;
      if (!(readError && isMissingColumn(readError) && rung < listLadder.length - 1)) break;
    }

    if (readError) {
      console.error("applications read error:", readError.message);
      return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
    }
    return NextResponse.json({ applications: (rows ?? []).map(toListRow) });
  } catch (err) {
    console.error("applications GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return idempotent(req, PATH, jsonBodyOf(req), () => createApplication(req));
}

async function createApplication(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    const validated = validateEditable(body, false);
    if ("error" in validated) {
      return NextResponse.json(validated, { status: 400 });
    }
    const { fields } = validated;
    if (followupTooEarly(fields.date_applied, fields.followup_date ?? null)) {
      return NextResponse.json({ error: FOLLOWUP_ERROR }, { status: 400 });
    }
    const logged = readLoggedBy(body.logged_by);
    if ("error" in logged) return NextResponse.json({ error: logged.error }, { status: 400 });

    const jobDescription = typeof body.job_description === "string" ? body.job_description.trim() : "";
    if (jobDescription.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    }

    // Only a tailoring run carries a session id / CV reference; manual rows
    // never do, so a forged session id on a manual entry is dropped.
    const source = body.source === "tailored" ? "tailored" : "manual";
    const sessionId = source === "tailored" ? clampOptional(body.tailor_session_id, MAX_SESSION_ID) : null;
    const cvReference = source === "tailored" ? clampOptional(body.cv_reference, MAX_CV_REF) : null;
    // A hand-added row stores only the format style the user picked for it
    // (lib/formatStyles), if any — a tag, never a CV: the panel and the prep
    // route read a snapshot without sections as "none".
    const cv = source === "tailored"
      ? cleanTailoredCv(body.tailored_cv, String(fields.role ?? ""))
      : { snapshot: isFormatStyleId(body.formatStyle) ? { formatStyle: body.formatStyle } : null };
    if ("error" in cv) {
      return NextResponse.json({ error: cv.error }, { status: 400 });
    }
    // Who logged it rides in the snapshot like the style tag (a key, never a CV).
    const snapshot = logged.loggedBy ? { ...(cv.snapshot ?? {}), loggedBy: logged.loggedBy } : cv.snapshot;

    const record = {
      ...fields,
      source,
      tailor_session_id: sessionId,
      cv_reference: cvReference,
      job_description: jobDescription || null,
      tailored_cv: withTriage(snapshot, jobDescription ? await triageForUser(supabase, userId, jobDescription) : null),
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
    // No deadline columns yet (migration 20261110120000): the row saves without them.
    if (insertError && isMissingColumn(insertError) && DEADLINE_KEYS.some((k) => k in record)) {
      for (const k of DEADLINE_KEYS) delete (record as Record<string, unknown>)[k];
      ({ data: inserted, error: insertError } = await supabase
        .from("applications")
        .insert({ ...record, user_id: userId })
        .select("id")
        .single());
      if (!insertError) warning = DEADLINE_SAVED_WITHOUT;
    }
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

    const oldInsertLabel = isStatusCheckViolation(insertError) && fields.status ? oldStatusLabel(fields.status) : null;
    if (oldInsertLabel) {
      ({ data: inserted, error: insertError } = await supabase
        .from("applications")
        .insert({ ...record, status: oldInsertLabel, user_id: userId })
        .select("id")
        .single());
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
      if (isStatusCheckViolation(insertError) && fields.status) {
        return NextResponse.json({ error: STATUS_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isNotNullViolation(insertError) && fields.date_applied === null) {
        return NextResponse.json({ error: DATE_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
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

// A confirmation written to a row closes its open submission items (lib/autoClose).
// A failure here is logged and never fails the note that was already saved.
async function closeOnConfirmation(supabase: Awaited<ReturnType<typeof signedIn>> extends infer C ? (C extends { supabase: infer S } ? S : never) : never, userId: string, applicationId: string) {
  const { data: open, error } = await supabase
    .from("application_events")
    .select("id, title, kind")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .in("status", ["scheduled", "to_book"]);
  if (error) {
    console.error("auto-close read error:", error.code ?? "unknown");
    return null;
  }
  const rows = (open ?? []) as { id: string; title: string; kind: string }[];
  const closed = rows.filter((e) => closesOnConfirmation(e.kind, e.title)).map((e) => ({ id: e.id, title: e.title }));
  const stillOpen = rows.filter((e) => !closesOnConfirmation(e.kind, e.title)).map((e) => e.title);
  if (closed.length > 0) {
    const at = new Date().toISOString();
    const { error: closeError } = await supabase
      .from("application_events")
      .update({ status: "done", closed_by: "note", closed_at: at, updated_at: at })
      .in("id", closed.map((e) => e.id))
      .eq("user_id", userId);
    if (closeError) {
      console.error("auto-close error:", closeError.code ?? "unknown");
      return null;
    }
  }
  return closed.length + stillOpen.length > 0 ? { closed, stillOpen, message: autoCloseMessage(closed, stillOpen) } : null;
}

type RouteSupabase = NonNullable<Awaited<ReturnType<typeof signedIn>>>["supabase"];
type SavedRule = Pick<CompanyRule, "company_name" | "rule_type" | "value">;

function isMissingTable(err: { code?: string } | null): boolean {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

// A line appended to a row's notes that ties a wait to applying again ("please wait at least
// one year before applying again", "re-apply after 90 days") becomes a company rule
// (lib/companyRules), so the next posting from that company is a Skip before any credit.
// Only a `sure` reading is saved on its own, and only from appended text, never from a whole
// replacement (a restore would re-date old lines): an intake year, the same role or "this
// year" waits for the user's click on the row. A rule the user switched off is not made again
// from the same words. A failure, or no table yet, never fails the note.
async function rulesFromNote(supabase: RouteSupabase, userId: string, applicationId: string, text: string): Promise<SavedRule[]> {
  const today = dayKey(Date.now(), DEFAULT_TIMEZONE);
  const drafts = readCooldowns(text, today).filter((d) => d.sure && d.value !== null);
  if (drafts.length === 0) return [];
  const { data: row, error: rowError } = await supabase.from("applications").select("company_name").eq("id", applicationId).eq("user_id", userId).maybeSingle();
  const company = typeof row?.company_name === "string" ? row.company_name.trim().slice(0, 200) : "";
  if (rowError || !company || !companyKey(company)) return [];
  const { data: stored, error: readError } = await supabase.from("company_rules").select("company_name, rule_type, value, anchor_date, source_text, dismissed_at").eq("user_id", userId).limit(2000);
  if (readError) {
    if (!isMissingTable(readError)) console.error("company rules read error:", readError.code ?? "unknown");
    return [];
  }
  const known = (stored ?? []).map(normalizeRule).filter((r): r is CompanyRule => r !== null);
  if (known.filter((r) => !r.dismissed_at).length >= MAX_ACTIVE_RULES) return [];
  const created: SavedRule[] = [];
  for (const d of drafts) {
    const value = d.value as string;
    const rule: SavedRule = { company_name: company, rule_type: d.rule_type, value };
    if (ruleExists([...known, ...created], { ...rule, anchor_date: d.anchor_date, source_text: d.source_text }, { rows: [], auto: true })) continue;
    const { error } = await supabase.from("company_rules").insert({
      user_id: userId,
      company_key: companyKey(company),
      ...rule,
      anchor_date: d.anchor_date,
      source_text: d.source_text.slice(0, 500),
      source: "notes",
      application_id: applicationId,
    });
    if (error) {
      console.error("company rule insert error:", error.code ?? "unknown");
      break;
    }
    created.push({ ...rule, anchor_date: d.anchor_date, source_text: d.source_text } as SavedRule);
  }
  return created.map(({ company_name, rule_type, value }) => ({ company_name, rule_type, value }));
}

// Adds one stamped line on top of the notes in one UPDATE (the RPC of migration
// 20261104120000): the caller never sends the old text, so it can never send a short
// copy. Refuses rather than cut past the cap. Answers the notes and their version.
// The same line again within ten minutes (lib/notesWrite isRecentDuplicate) is a retry's
// repeat: nothing is written and the answer says `skipped: "duplicate_note"`, with the notes
// and version of that one read. Two identical appends in the same instant can both pass this
// read; an Idempotency-Key is what makes a retry exactly-once.
async function appendNote(supabase: RouteSupabase, userId: string, id: string, line: string): Promise<NextResponse | { notes: string; updated_at: string | null; skipped?: typeof DUPLICATE_NOTE }> {
  const now = Date.now();
  const { data: current, error: currentError } = await supabase.from("applications").select("notes, updated_at").eq("id", id).eq("user_id", userId).maybeSingle();
  if (currentError) {
    console.error("applications append read error:", currentError.code ?? "unknown");
    return NextResponse.json({ error: "Could not add that note" }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (isRecentDuplicate(current.notes as string | null, line, now)) {
    return { notes: (current.notes as string | null) ?? "", updated_at: typeof current.updated_at === "string" ? current.updated_at : null, skipped: DUPLICATE_NOTE };
  }
  const stamped = stampNoteLine(line, now);
  const { data, error } = await supabase.rpc("append_application_note", { p_id: id, p_line: stamped, p_max: MAX_NOTES });
  if (error?.code === "PGRST202") return NextResponse.json({ error: ACTION_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
  if (error) {
    console.error("applications append error:", error.code ?? "unknown");
    return NextResponse.json({ error: "Could not add that note" }, { status: 500 });
  }
  if (typeof data !== "string") {
    // Not the caller's row, or no room: tell the two apart without touching anything.
    const { data: row, error: rowError } = await supabase.from("applications").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
    if (rowError) {
      console.error("applications append lookup error:", rowError.code ?? "unknown");
      return NextResponse.json({ error: "Could not add that note" }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return NextResponse.json({ error: `These notes are full (max ${MAX_NOTES} characters). Nothing was changed.`, errorType: "notes_full" }, { status: 400 });
  }
  // The version that goes with these notes, for a page that edits them next: only when the
  // read still shows exactly them (another write in between would make the pair a lie).
  const { data: after } = await supabase.from("applications").select("notes, updated_at").eq("id", id).eq("user_id", userId).maybeSingle();
  const pairOk = typeof after?.notes === "string" && after.notes === data;
  return { notes: data, updated_at: pairOk && typeof after?.updated_at === "string" ? after.updated_at : null };
}

// PATCH { id, append_note }: one dated line on top of the notes, in one UPDATE
// (migration 20261104120000), so it can never replace them or lose another writer's
// text. Past the tracker's cap it refuses rather than cut anything.
export async function PATCH(req: NextRequest) {
  return idempotent(req, PATH, jsonBodyOf(req), () => appendToApplication(req));
}

async function appendToApplication(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    if (body.id === undefined || body.id === null || body.id === "") {
      return NextResponse.json({ error: "No application specified" }, { status: 400 });
    }
    if (!isUuid(body.id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const cleaned = cleanNoteLine(body.append_note);
    if ("error" in cleaned) return NextResponse.json(cleaned, { status: 400 });
    const { line } = cleaned;

    const appended = await appendNote(supabase, userId, body.id, line);
    if (appended instanceof NextResponse) return appended;
    if (appended.skipped) return NextResponse.json({ ok: true, skipped: appended.skipped, notes: appended.notes, updated_at: appended.updated_at });
    const autoClose = confirmationAdded(null, line) ? await closeOnConfirmation(supabase, userId, body.id) : null;
    const companyRules = await rulesFromNote(supabase, userId, body.id, line);
    return NextResponse.json({ ok: true, notes: appended.notes, updated_at: appended.updated_at, ...(autoClose ? { autoClose } : {}), ...(companyRules.length ? { companyRules } : {}) });
  } catch (err) {
    console.error("applications PATCH error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not add that note" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  return idempotent(req, PATH, jsonBodyOf(req), () => updateApplication(req));
}

async function updateApplication(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    if (body.id === undefined || body.id === null || body.id === "") {
      return NextResponse.json({ error: "No application specified" }, { status: 400 });
    }
    if (!isUuid(body.id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const id = body.id;

    // "Run check" on /applications: the triage of the row's stored JD, now, with
    // the user's current answers and CV. No model call.
    if (body.runCheck === true) {
      const { data: existing, error: existingError } = await supabase
        .from("applications")
        .select("job_description, tailored_cv")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (existingError) {
        if (isMissingColumn(existingError)) return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
        console.error("applications lookup error:", existingError.message);
        return NextResponse.json({ error: "Could not check that application" }, { status: 500 });
      }
      if (!existing) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const jd = typeof existing.job_description === "string" ? existing.job_description.trim() : "";
      if (!jd) return NextResponse.json({ error: "Add the job description first.", errorType: "needs_jd" }, { status: 400 });
      const stored = existing.tailored_cv;
      const snapshot = withTriage(stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : null, await triageForUser(supabase, userId, jd));
      const { error: writeError } = await supabase.from("applications").update({ tailored_cv: snapshot }).eq("id", id).eq("user_id", userId);
      if (writeError) {
        console.error("applications check error:", writeError.message);
        return NextResponse.json({ error: "Could not check that application" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, gates: snapshot?.gates ?? null });
    }

    // Undo of Move to Closed: restored from what the close stored, never from the request.
    if (body.undo_close === true) {
      const { data: row, error: readError } = await supabase.from("applications").select(UNDO_READ).eq("id", id).eq("user_id", userId).maybeSingle();
      if (readError) {
        if (isMissingColumn(readError)) return NextResponse.json({ error: UNDO_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
        console.error("applications undo lookup error:", readError.code ?? "unknown");
        return NextResponse.json({ error: "Could not undo that" }, { status: 500 });
      }
      if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const stored = row as unknown as { notes: string | null; followup_date: string | null; undo_snapshot: unknown };
      const snapshot = normalizeUndoSnapshot(stored.undo_snapshot);
      if (!snapshot || !undoIsLive(snapshot, Date.now())) return NextResponse.json({ error: UNDO_EXPIRED, errorType: "undo_expired" }, { status: 409 });
      // Only the close this snapshot belongs to: any later write has cleared it (the trigger).
      const { data: restored, error: writeError } = await supabase.from("applications").update(undoWrite(snapshot, stored)).eq("id", id).eq("user_id", userId).eq("undo_snapshot->>at", snapshot.at).select(UNDO_ANSWER).maybeSingle();
      if (writeError) {
        console.error("applications undo error:", writeError.code ?? "unknown");
        return NextResponse.json({ error: "Could not undo that" }, { status: 500 });
      }
      if (!restored) return NextResponse.json({ error: UNDO_EXPIRED, errorType: "undo_expired" }, { status: 409 });
      const answer = restored as unknown as Record<string, unknown>;
      return NextResponse.json({ ok: true, restored: { ...answer, status: apiStatus(answer.status) } });
    }

    // The notes (lib/notesWrite): append_note needs no read and can't lose text; a whole
    // replacement needs the version the caller read (if_updated_at), or nothing in this
    // write lands. Decided before anything is read or written.
    const notesWrite = decideNotesWrite(body);
    if ("refuse" in notesWrite) return NextResponse.json(notesWrite.refuse.body, { status: notesWrite.refuse.status });

    const validated = validateEditable(body, true);
    if ("error" in validated) {
      return NextResponse.json(validated, { status: 400 });
    }
    const { fields } = validated;
    const otherChanges = Object.keys(fields).length > 0 || "formatStyle" in body;

    // A replace: the version the caller read must still be the row's. The write below is
    // conditional on it too, so a writer that slips in between is caught there.
    let guardVersion: string | null = null;
    if (notesWrite.mode === "replace") {
      const { data: stored, error: storedError } = await supabase.from("applications").select("updated_at").eq("id", id).eq("user_id", userId).maybeSingle();
      if (storedError) {
        console.error("applications version read error:", storedError.code ?? "unknown");
        return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
      }
      if (!stored) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      if (!sameVersion(stored.updated_at, notesWrite.ifUpdatedAt)) {
        const refusal = staleRefusal();
        return NextResponse.json(refusal.body, { status: refusal.status });
      }
      guardVersion = stored.updated_at as string;
    }

    // An append alone is one UPDATE in the database: nothing else to read or check.
    if (notesWrite.mode === "append" && !otherChanges) {
      const appended = await appendNote(supabase, userId, id, notesWrite.line);
      if (appended instanceof NextResponse) return appended;
      if (appended.skipped) return NextResponse.json({ ok: true, skipped: appended.skipped, notes: appended.notes, updated_at: appended.updated_at });
      const autoClose = confirmationAdded(null, notesWrite.line) ? await closeOnConfirmation(supabase, userId, id) : null;
      const companyRules = await rulesFromNote(supabase, userId, id, notesWrite.line);
      return NextResponse.json({ ok: true, notes: appended.notes, updated_at: appended.updated_at, ...(autoClose ? { autoClose } : {}), ...(companyRules.length ? { companyRules } : {}) });
    }
    // The version of the notes the server composes from, when it writes them itself (a
    // follow-up cleared, a Reopen's report): its write is conditional on it, like a replace.
    let composedFrom: string | null = null;
    // The rule (lib/closing): a row that reached screening ends only on the user's own word,
    // and only the Move to Closed dialog says so. A sweep uses the pending-outcome route.
    const confirmed = body.confirmed_by_user === true;
    let reportNotes: string | null | undefined;
    let reportLeftOut: string | undefined;
    if (fields.status !== undefined || CLOSE_KEYS.some((k) => k in fields)) {
      let current: ClosingCurrent | null = null;
      if (fields.status !== undefined) {
        for (const columns of CLOSING_LADDER) {
          const read = await supabase.from("applications").select(columns).eq("id", id).eq("user_id", userId).maybeSingle();
          if (read.error && isMissingColumn(read.error) && columns !== CLOSING_LADDER.at(-1)) continue;
          if (read.error) {
            console.error("applications lookup error:", read.error.message);
            return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
          }
          if (!read.data) return NextResponse.json({ error: "Application not found" }, { status: 404 });
          current = read.data as unknown as ClosingCurrent;
          break;
        }
      }
      const decision = decideClosingWrite(current, fields, { confirmed, confirmedMoveBack: body.confirmed_move_back === true, confirmedReopen: body.confirmed_reopen === true }, new Date().toISOString());
      if ("refuse" in decision) {
        const { status, ...refusal } = decision.refuse;
        return NextResponse.json({ ...refusal, ...(refusal.errorType === "needs_confirmation" ? { pendingOutcomeUrl: `/api/applications/${id}/pending-outcome` } : {}) }, { status });
      }
      // An open status on a closed row, or a step back on a live one, without the user's word:
      // this row may not even be the right one, so nothing in this write lands. The banner asks,
      // quoting what it reported, and the row takes those words only if the user says yes.
      if ("ask" in decision) {
        // A sweep that appends its line is quoted the way one that replaced the notes was.
        const appendedNote = notesWrite.mode === "append" && !decision.ask.note ? reportedNote(current?.notes, notesWrite.line) : undefined;
        const ask: PendingOutcome = appendedNote ? { ...decision.ask, note: appendedNote } : decision.ask;
        const merged = mergePendingOutcome(current?.pending_outcome, ask);
        if (!merged.ignored) {
          const { error: askError } = await supabase.from("applications").update({ pending_outcome: merged.value }).eq("id", id).eq("user_id", userId);
          if (askError) {
            if (isMissingColumn(askError)) return NextResponse.json({ error: CLOSED_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
            console.error("applications question error:", askError.code ?? "unknown");
            return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
          }
        }
        const message = merged.ignored ? (merged.value.dismissed || merged.value.outcome === ask.outcome ? REPORT_DISMISSED : REPORT_HELD) : ask.outcome === "reopen" ? REOPEN_RECORDED : MOVE_BACK_RECORDED;
        return NextResponse.json({ ok: true, applied: false, message, status: apiStatus(current?.status), pending_outcome: merged.value, ...(merged.ignored ? { ignored: message === REPORT_HELD ? "pending" : "dismissed" } : {}) }, { status: 202 });
      }
      // Object.assign can't take a key away: a null the rule refused to honour must not reach the write.
      if (!("pending_outcome" in decision.fields)) delete fields.pending_outcome;
      if (!("notes" in fields)) {
        const asked = normalizePendingOutcome(current?.pending_outcome);
        if (decision.fields.notes !== undefined) {
          reportNotes = decision.fields.notes;
          composedFrom ??= (current as { updated_at?: string | null } | null)?.updated_at ?? null;
        }
        else if (asked && !isEnding(fields.status) && reportTaken(asked, fields.status) && asked.note && !asked.dismissed && decision.fields.pending_outcome !== undefined) reportLeftOut = `Your notes are full, so this was not added to them: "${asked.note}"`;
      }
      Object.assign(fields, decision.fields);
    }
    // The format-style tag of a hand-added row (lib/formatStyles): null or
    // "unknown" clears it, a style id sets it; merged into the row's
    // tailored_cv below. A tailored row keeps the style it was made with.
    const stylePatch: FormatStyleId | null | undefined = !("formatStyle" in body)
      ? undefined
      : body.formatStyle == null || body.formatStyle === "" || body.formatStyle === "unknown"
        ? null
        : isFormatStyleId(body.formatStyle)
          ? body.formatStyle
          : undefined;
    if ("formatStyle" in body && stylePatch === undefined) {
      return NextResponse.json({ error: "Pick a valid format style." }, { status: 400 });
    }
    if (Object.keys(fields).length === 0 && stylePatch === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    // A new job description gets a new triage (withTriage above), merged into
    // the stored snapshot like the style tag.
    const jdChanged = "job_description" in fields;
    let snapshotPatch: Record<string, unknown> | null | undefined;
    if (stylePatch !== undefined || jdChanged) {
      const { data: existing, error: existingError } = await supabase
        .from("applications")
        .select("source, tailored_cv")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      // Without the snapshot column a JD edit still saves, untriaged; only the
      // style tag has nowhere else to go.
      const snapshotMissing = !!existingError && isMissingColumn(existingError);
      if (existingError && !(snapshotMissing && stylePatch === undefined)) {
        if (snapshotMissing) {
          return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
        }
        console.error("applications lookup error:", existingError.message);
        return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
      }
      if (!snapshotMissing) {
        if (!existing) {
          return NextResponse.json({ error: "Application not found" }, { status: 404 });
        }
        if (stylePatch !== undefined && existing.source === "tailored") {
          return NextResponse.json({ error: "A tailored row keeps the style it was made with." }, { status: 400 });
        }
        const stored = existing.tailored_cv;
        let snapshot: Record<string, unknown> | null =
          stored && typeof stored === "object" && !Array.isArray(stored) ? { ...(stored as Record<string, unknown>) } : {};
        if (stylePatch !== undefined) {
          if (stylePatch) snapshot.formatStyle = stylePatch;
          else delete snapshot.formatStyle;
        }
        if (jdChanged) {
          const jd = fields.job_description ?? "";
          snapshot = withTriage(snapshot, jd ? await triageForUser(supabase, userId, jd) : null) ?? {};
        }
        snapshotPatch = Object.keys(snapshot).length > 0 ? snapshot : null;
      }
    }

    // The date rule spans two columns; when the patch carries only one of
    // them, compare against what's stored. Closing the row (Rejected /
    // Withdrawn) also needs what's stored: an open follow-up is cleared and
    // the old date written into the notes (lib/tracker).
    const closing = fields.status !== undefined && clearsFollowup(fields.status);
    let dateApplied = fields.date_applied;
    let followup = "followup_date" in fields ? (fields.followup_date ?? null) : undefined;
    let followupCleared: { followup_date: null; notes: string | null } | undefined;
    // The date rule (lib/applicationFields resolveSentDate) reads the row whenever the status
    // or the date changes: only a Ready to submit row may have no date applied.
    const datesMatter = "status" in fields || "date_applied" in fields;
    let dateDefaulted: string | undefined;
    if (dateApplied === undefined || followup === undefined || closing || datesMatter) {
      const { data: existing, error: existingError } = await supabase
        .from("applications")
        .select("status, date_applied, followup_date, notes, updated_at")
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
      if (datesMatter) {
        const sent = resolveSentDate({
          status: fields.status ?? existing.status,
          stored: (existing.date_applied as string | null) ?? null,
          patch: "date_applied" in fields ? fields.date_applied : undefined,
          today: londonToday(),
        });
        if ("error" in sent) return NextResponse.json({ error: sent.error }, { status: 400 });
        if (sent.set) {
          fields.date_applied = sent.set;
          dateApplied = sent.set;
          dateDefaulted = sent.set;
        }
      }
      // undefined, not null: a date the body cleared stays cleared.
      if (dateApplied === undefined) dateApplied = (existing.date_applied as string | null) ?? null;
      if (followup === undefined) followup = (existing.followup_date as string | null) ?? null;
      const stored = (existing.followup_date as string | null) ?? null;
      if (closing && stored && !("followup_date" in fields)) {
        const today = new Date().toISOString().slice(0, 10);
        const notes = appendNoteLine(
          "notes" in fields ? fields.notes : (existing.notes as string | null),
          followupClearedNote(stored, fields.status as string, today)
        );
        if (!("notes" in fields)) composedFrom ??= (existing.updated_at as string | null) ?? null;
        fields.followup_date = null;
        fields.notes = notes.slice(0, MAX_NOTES) || null;
        followup = null;
        followupCleared = { followup_date: null, notes: fields.notes };
      }
      // A confirmed close that adds a line ("Log outcome", Chunk 26): the line joins this one
      // write, on the version just read. Appended after it, the line would be the "next change"
      // that clears the Undo this close stores (the trigger of migration 20261105120000), so a
      // rejection logged on the wrong row could not be undone, and its line would stay there.
      if (notesWrite.mode === "append" && fields.undo_snapshot && !("notes" in fields) && typeof existing.updated_at === "string") {
        composedFrom ??= existing.updated_at;
        fields.notes = (existing.notes as string | null) || null;
      }
    }
    if (followupTooEarly(dateApplied, followup)) {
      return NextResponse.json({ error: FOLLOWUP_ERROR }, { status: 400 });
    }

    // The notes before this save: only text this edit adds can close anything
    // (lib/autoClose). A failed read just means nothing closes.
    let notesBefore: string | null | undefined;
    if ("notes" in fields && confirmationIn(fields.notes as string | null)) {
      const { data: prior, error: priorError } = await supabase.from("applications").select("notes").eq("id", id).eq("user_id", userId).maybeSingle();
      if (priorError) console.error("applications notes read error:", priorError.code ?? "unknown");
      else notesBefore = (prior?.notes as string | null | undefined) ?? null;
    }

    // Notes the server composed from a read are written on that read's version, so an append
    // landing in between is never overwritten: the write matches nothing and says so.
    const serverGuard = !guardVersion && composedFrom !== null && "notes" in fields;
    if (serverGuard) guardVersion = composedFrom;

    // The caller's line goes on top of everything this write puts in the notes. When the server
    // wrote them (above), it joins that one guarded write; otherwise the database prepends it
    // after the write. Either way the room is checked now, after the server's own lines, and a
    // write with no room for its line lands nothing.
    let appendInWrite = false;
    // The same line within ten minutes is a retry's repeat (lib/notesWrite): the rest of the
    // write lands, the line does not, and the answer says so.
    let noteSkipped = false;
    if (notesWrite.mode === "append") {
      const now = Date.now();
      const stamped = stampNoteLine(notesWrite.line, now);
      const full = () => NextResponse.json({ error: `These notes are full (max ${MAX_NOTES.toLocaleString("en-GB")} characters). Nothing was changed.`, errorType: "notes_full" }, { status: 400 });
      if ("notes" in fields && isRecentDuplicate(fields.notes as string | null, notesWrite.line, now)) {
        noteSkipped = true;
      } else if ("notes" in fields) {
        const merged = fields.notes ? `${stamped}\n${fields.notes}` : stamped;
        if (merged.length > MAX_NOTES) return full();
        fields.notes = merged;
        appendInWrite = true;
        // Undo of this close takes its line back too (lib/closing undoWrite).
        if (fields.undo_snapshot) fields.undo_snapshot = { ...fields.undo_snapshot, note: stamped };
        if (followupCleared) followupCleared = { ...followupCleared, notes: merged };
        if (reportNotes !== undefined) reportNotes = merged;
      } else {
        const { data: stored, error: storedError } = await supabase.from("applications").select("notes").eq("id", id).eq("user_id", userId).maybeSingle();
        if (storedError) {
          console.error("applications notes read error:", storedError.code ?? "unknown");
          return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
        }
        if (!stored) return NextResponse.json({ error: "Application not found" }, { status: 404 });
        if (isRecentDuplicate(stored.notes as string | null, notesWrite.line, now)) noteSkipped = true;
        else {
          const room = MAX_NOTES - (typeof stored.notes === "string" && stored.notes ? stored.notes.length + 1 : 0);
          if (stamped.length > room) return full();
        }
      }
    }

    // Scoped by id as well as RLS: belt and braces on a write. RLS hides
    // another user's row rather than erroring, so an empty result means
    // "not yours or not there".
    const update: Record<string, unknown> = { ...fields, ...(snapshotPatch !== undefined ? { tailored_cv: snapshotPatch } : {}) };
    // Every attempt carries the replace's version: a row that moved on matches nothing.
    const write = (patch: Record<string, unknown>) => {
      const query = supabase.from("applications").update(patch).eq("id", id).eq("user_id", userId);
      return (guardVersion ? query.eq("updated_at", guardVersion) : query).select("id, updated_at");
    };
    let { data: updated, error: updateError } = await write(update);

    // No closing columns yet (migration 20261104130000): clearing a column that is not there
    // is nothing, and the user's own close still moves the status, saying what it could not keep.
    let closeWarning = reportLeftOut;
    if (updateError && isMissingColumn(updateError) && "undo_snapshot" in update) {
      delete update.undo_snapshot;
      closeWarning = UNDO_MIGRATION_HINT;
      ({ data: updated, error: updateError } = await write(update));
    }
    if (updateError && isMissingColumn(updateError) && CLOSE_KEYS.some((k) => k in update)) {
      const onlyClearing = CLOSE_KEYS.every((k) => update[k] == null);
      if (onlyClearing || (confirmed && isEnding(fields.status))) {
        for (const k of CLOSE_KEYS) delete update[k];
        if (!onlyClearing) closeWarning = CLOSED_SAVED_WITHOUT;
        if (Object.keys(update).length === 0) {
          updated = [{ id, updated_at: null }];
          updateError = null;
        } else {
          ({ data: updated, error: updateError } = await write(update));
        }
      }
    }

    const oldUpdateLabel = isStatusCheckViolation(updateError) && fields.status ? oldStatusLabel(fields.status) : null;
    if (oldUpdateLabel) {
      ({ data: updated, error: updateError } = await write({ ...update, status: oldUpdateLabel }));
    }

    if (updateError) {
      if (isStatusCheckViolation(updateError) && fields.status) {
        return NextResponse.json({ error: STATUS_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isMissingColumn(updateError) && CLOSE_KEYS.some((k) => k in fields)) {
        return NextResponse.json({ error: CLOSED_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isMissingColumn(updateError) && "outcome_reason" in fields) {
        return NextResponse.json({ error: OUTCOME_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isMissingColumn(updateError) && ("last_contact_from" in fields || "last_contact_at" in fields)) {
        return NextResponse.json({ error: CONTACT_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isMissingColumn(updateError) && REFERRAL_KEYS.some((k) => k in fields)) {
        return NextResponse.json({ error: REFERRAL_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isMissingColumn(updateError) && DEADLINE_KEYS.some((k) => k in fields)) {
        return NextResponse.json({ error: DEADLINE_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      if (isNotNullViolation(updateError) && fields.date_applied === null) {
        return NextResponse.json({ error: DATE_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      }
      console.error("applications update error:", updateError.message);
      return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      // Matched nothing: gone, or (for a replace) changed since its version was checked.
      if (guardVersion) {
        const { data: still } = await supabase.from("applications").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
        if (still) {
          const refusal = staleRefusal();
          const message = serverGuard ? "This row's notes changed while it was being saved, so nothing was saved. Send it again." : refusal.body.message;
          return NextResponse.json({ ...refusal.body, message }, { status: refusal.status });
        }
      }
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    let updatedAt = typeof updated[0]?.updated_at === "string" ? updated[0].updated_at : null;
    // The append, now the rest has landed (its room was checked before).
    let appendedNotes: string | undefined;
    let noteWarning: string | undefined;
    if (notesWrite.mode === "append" && appendInWrite) appendedNotes = fields.notes as string;
    else if (notesWrite.mode === "append" && !noteSkipped) {
      const appended = await appendNote(supabase, userId, id, notesWrite.line);
      if (appended instanceof NextResponse) noteWarning = "Saved, but the note could not be added: another note filled the notes first. Add it again.";
      else if (appended.skipped) noteSkipped = true;
      else {
        appendedNotes = appended.notes;
        updatedAt = appended.updated_at;
      }
    }
    // A JD edit answers with the row's gates as stored, so the sheet can show
    // the new triage without a reload.
    const gates = jdChanged && snapshotPatch !== undefined ? (snapshotPatch?.gates ?? null) : undefined;
    const autoClose =
      (notesBefore !== undefined && confirmationAdded(notesBefore, fields.notes as string | null)) || (appendedNotes !== undefined && confirmationAdded(null, notesWrite.mode === "append" ? notesWrite.line : ""))
        ? await closeOnConfirmation(supabase, userId, id)
        : null;
    // What the company said about applying again, in the line this write appended.
    // Not for a line written with a confirmed close ("Log outcome"): Undo takes that close and its
    // line back, but could not take back a rule, so a rejection logged on the wrong application
    // would leave its company blocked. The Notes panel offers the rule from the line instead.
    const companyRules = appendedNotes !== undefined && notesWrite.mode === "append" && !fields.undo_snapshot ? await rulesFromNote(supabase, userId, id, notesWrite.line) : [];
    const warning = [closeWarning, noteWarning].filter(Boolean).join(" ");
    return NextResponse.json({
      ok: true,
      ...(updatedAt ? { updated_at: updatedAt } : {}),
      ...(appendedNotes !== undefined ? { notes: appendedNotes } : {}),
      ...(noteSkipped ? { skipped: DUPLICATE_NOTE } : {}),
      ...(dateDefaulted ? { date_applied: dateDefaulted } : {}),
      ...(reportNotes !== undefined ? { reportNotes } : {}),
      ...(warning ? { warning } : {}),
      ...(followupCleared ? { followupCleared } : {}),
      ...(gates !== undefined ? { gates } : {}),
      ...(autoClose ? { autoClose } : {}),
      ...(companyRules.length ? { companyRules } : {}),
    });
  } catch (err) {
    console.error("applications PUT error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that application" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "No application specified" }, { status: 400 });
    if (!isUuid(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    // The CV and cover letter files uploaded for this application (lib/sentCv), read
    // before the row goes so they can be removed after. A missing column means no file.
    let before: Record<string, unknown> | null = null;
    for (const columns of ["sent_cv, sent_cover_letter", "sent_cv"]) {
      const read = await supabase.from("applications").select(columns).eq("id", id).eq("user_id", userId).maybeSingle();
      if (read.error && isMissingColumn(read.error)) continue;
      before = (read.data as Record<string, unknown> | null) ?? null;
      break;
    }
    const files = [normalizeSentCv(before?.sent_cv), normalizeSentCv(before?.sent_cover_letter)].filter((f) => f && ownsPath(f.path, userId, id));

    const { error: deleteError } = await supabase
      .from("applications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("applications delete error:", deleteError.message);
      return NextResponse.json({ error: "Could not delete that application" }, { status: 500 });
    }
    // Best effort: a leftover would sit in the user's own private folder.
    if (files.length) {
      const { error: removeError } = await supabase.storage.from(SENT_CV_BUCKET).remove(files.map((f) => f!.path));
      if (removeError) console.warn("applications delete: sent files not removed:", removeError.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("applications DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete that application" }, { status: 500 });
  }
}
