// Reading the tracker's rows, and the shape the sheet receives them in
// (2 Nov 2026). Imports only ./tracker.ts by relative path, so it runs under
// node:test (tests/applicationRows).
//
// PostgREST answers at most 1000 rows per request whatever .limit() asks for —
// a `.limit(2000)` on insights silently returned 1000 — so anything that needs
// every row reads through readApplicationPages().
//
// The list response is what /applications, /app and /interviews load on every
// visit, so it carries only what the sheet draws. On the owner's 1,016 rows
// (2 Nov) the JD averaged 811 bytes, notes 398 and the rest 690 with its empty
// keys, 434 without: dropping the JD alone left 2.2 MB at the 2,000-row cap. So
// the JD becomes a flag, notes a preview, and null keys are not sent. Full
// text comes from the detail read (GET /api/applications?id=).
import { reachedScreening } from "./closing.ts";
import { FOLLOWUP_DUE_STATUSES } from "./followupsDue.ts";
import { apiStatus, normalizeStatus, notesSayNotSubmitted, storedStatusValues, type Status } from "./tracker.ts";

export const MAX_APPLICATIONS = 2000;
// PostgREST's own per-request ceiling.
export const LIST_PAGE_SIZE = 1000;
// Longer than the sheet's Notes cell shows, so the ellipsis stays CSS's.
export const NOTES_PREVIEW_CHARS = 120;

type ReadError = { code?: string; message: string };
type PageResult = { data: unknown; error: ReadError | null };
// The part of a PostgREST builder the read uses; a route casts its filtered
// builder to this.
export type OrderableQuery = {
  order(column: string, options: { ascending: boolean }): OrderableQuery;
  range(from: number, to: number): PromiseLike<PageResult>;
};

/**
 * Every row a query matches, newest first, up to MAX_APPLICATIONS. `freshQuery`
 * builds the filtered query again for each page (a builder is used once). An
 * error on any page returns the error and no rows: a partial read must not
 * pass for the whole tracker.
 */
export async function readApplicationPages<Row = Record<string, unknown>>(
  freshQuery: () => OrderableQuery
): Promise<{ rows: Row[]; error: null } | { rows: null; error: ReadError }> {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_APPLICATIONS; from += LIST_PAGE_SIZE) {
    const res = await freshQuery()
      .order("date_applied", { ascending: false })
      .order("created_at", { ascending: false })
      // created_at is shared by rows inserted together; without a unique last
      // key a row could repeat or vanish across a page boundary.
      .order("id", { ascending: true })
      .range(from, from + LIST_PAGE_SIZE - 1);
    if (res.error) return { rows: null, error: res.error };
    const page = (res.data as Row[] | null) ?? [];
    rows.push(...page);
    if (page.length < LIST_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

export type NotesListFields = {
  notes_preview: string | undefined;
  // The preview is cut: the full text must be loaded before it can be edited.
  notes_more: true | undefined;
  // lib/tracker notesSayNotSubmitted over the FULL text, which the sheet's
  // "not submitted" review can no longer read for itself.
  notes_not_submitted: true | undefined;
};

/** What the list says about a row's notes. Every key is present, so a client can spread it over a row to clear old values. */
export function notesListFields(notes: unknown): NotesListFields {
  const text = typeof notes === "string" ? notes.trim() : "";
  return {
    notes_preview: text ? text.slice(0, NOTES_PREVIEW_CHARS) : undefined,
    notes_more: text.length > NOTES_PREVIEW_CHARS ? true : undefined,
    notes_not_submitted: notesSayNotSubmitted(text) ? true : undefined,
  };
}

// What lib/knockouts gateLine needs for the sheet's Gate dot: the read, the
// counts and the one sentence it quotes (the first hard fail, else the first
// soft one). The other items and gates.triage (with its sentences) stay in the
// detail read, for the panels.
function listGates(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const g = value as Record<string, unknown>;
  if (typeof g.read !== "string") return undefined;
  const items = Array.isArray(g.items) ? (g.items as { verdict?: unknown }[]) : [];
  const first = (verdict: string) => items.find((i) => i && i.verdict === verdict);
  const quoted = first("hard") ?? first("soft");
  return { read: g.read, hard: g.hard, soft: g.soft, unknown: g.unknown, ...(quoted ? { items: [quoted] } : {}) };
}

/**
 * The triage the sheet draws, from stored gates: the verdict and up to two
 * reasons, no sentences (the JD panel reads those from the detail read). Every
 * key is present, so a client can spread it over a row to clear old values.
 */
export function listTriageFields(gates: unknown): { triage_verdict: "apply" | "review" | "skip" | undefined; triage_reasons: string[] | undefined } {
  const t = gates && typeof gates === "object" ? (gates as { triage?: { verdict?: unknown; reasons?: unknown } }).triage : undefined;
  const verdict = t?.verdict === "apply" || t?.verdict === "review" || t?.verdict === "skip" ? t.verdict : undefined;
  const reasons = verdict && verdict !== "apply" && Array.isArray(t?.reasons) ? t.reasons.filter((r): r is string => typeof r === "string").slice(0, 2) : [];
  return { triage_verdict: verdict, triage_reasons: reasons.length ? reasons : undefined };
}

// Replaced below, or read by no page from the list; all are in the detail read.
const NOT_IN_LIST = new Set(["job_description", "notes", "gates", "updated_at", "tailor_session_id"]);

/** One row of GET /api/applications' list: no JD, a notes preview, no null keys. */
export function toListRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || NOT_IN_LIST.has(key)) continue;
    out[key] = value;
  }
  // The API's spelling, whichever one is stored (lib/tracker API_STATUS).
  if (typeof row.status === "string") out.status = apiStatus(row.status);
  // A Ready to submit row may have no date applied (Chunk 22): the key stays, null, as the
  // sweeps have always found it present.
  if ("date_applied" in row && (row.date_applied === null || row.date_applied === undefined)) out.date_applied = null;
  // Only a row that got shortlisted needs it, for the Live section's order: every row's would cost 40 KB.
  // Whole minutes, never the row's updated_at: that is the version a notes replace must send
  // (lib/notesWrite), and it must come from a read that returned the full notes. A list row
  // carries only a preview, and a preview sent back with a valid version is the 10 Nov wipe.
  if (typeof row.updated_at === "string" && reachedScreening({ status: row.status, stages_reached: row.stages_reached as string[] | null })) {
    const ms = Date.parse(row.updated_at);
    if (Number.isFinite(ms)) out.updated_minute = Math.floor(ms / 60_000);
  }
  if (typeof row.job_description === "string" && row.job_description.trim()) out.has_job_description = true;
  for (const [key, value] of Object.entries(notesListFields(row.notes))) {
    if (value !== undefined) out[key] = value;
  }
  const gates = listGates(row.gates);
  if (gates) out.gates = gates;
  for (const [key, value] of Object.entries(listTriageFields(row.gates))) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// ── One page of the list (6 Nov 2026, Chunk 19) ────────────────────────────
// GET /api/applications?stage=&limit=&cursor= answers one page in the list's
// order, without the notes preview, so /applications paints its first rows
// from ~50 small rows instead of every row (578 KB for 1,127 on 6 Nov). A GET
// with none of those parameters, or with ?all=1, is the full list exactly as
// before: the owner's sweeps read it, and the page loads it alongside.

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

// A stage tab, or one status (either spelling). The page re-derives the tab
// from each row's open events (lib/applicationStage deriveStage); this filter
// reads the stored status.
const TAB_STATUSES: Record<string, Status[]> = {
  to_submit: ["saved"],
  applied: ["applied"],
  screening: ["screening"],
  interview: ["interview"],
  assessment: ["assessment"],
  offer: ["offer"],
  won: ["accepted"],
  closed: ["rejected", "withdrawn", "ghosted"],
};

export function stageStatuses(stage: string): Status[] | null {
  const key = stage.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (TAB_STATUSES[key]) return TAB_STATUSES[key];
  const status = normalizeStatus(stage);
  return status ? [status] : null;
}

/** Every stored spelling of those statuses, for an `.in("status", …)` filter. */
export function storedValuesFor(statuses: readonly Status[]): string[] {
  return [...new Set(statuses.flatMap((s) => storedStatusValues(s)))];
}

// `d` is "" for a row with no date applied (a Ready to submit row, since 12 Nov 2026, Chunk 22).
export type ListCursor = { d: string; c: string; i: string };
const CURSOR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const CURSOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The position after `row`, in the list's order (date_applied desc, created_at desc, id asc).
 * Postgres sorts a missing date applied FIRST in a descending order, so the undated rows
 * (Ready to submit only) open the list; their cursor carries an empty date.
 */
export function encodeCursor(row: { date_applied?: unknown; created_at?: unknown; id?: unknown }): string | null {
  const d = row.date_applied === null || row.date_applied === undefined ? "" : row.date_applied;
  const cursor = { d, c: row.created_at, i: row.id };
  if (typeof cursor.d !== "string" || typeof cursor.c !== "string" || typeof cursor.i !== "string") return null;
  // Plain text (the page imports this file, and a browser has no Buffer); a "|" never occurs in a part.
  return [cursor.d, cursor.c, cursor.i].join("|");
}

/** A cursor the caller sent, checked to the character: it ends up inside a PostgREST filter. */
export function decodeCursor(value: string): ListCursor | null {
  try {
    const [d, c, i, extra] = value.split("|");
    if (extra !== undefined) return null;
    if (typeof d !== "string" || (d !== "" && !CURSOR_DATE_RE.test(d))) return null;
    if (typeof c !== "string" || !CURSOR_TS_RE.test(c)) return null;
    if (typeof i !== "string" || !CURSOR_ID_RE.test(i)) return null;
    return { d, c, i };
  } catch {
    return null;
  }
}

/** The rows after the cursor, as one PostgREST `or` filter (values quoted: a timestamp carries ':' '+' '.'). */
export function afterCursor(c: ListCursor): string {
  const ts = `"${c.c}"`;
  // Inside the undated block: the rest of it, then every dated row (they all come after it).
  if (c.d === "") return `and(date_applied.is.null,created_at.lt.${ts}),and(date_applied.is.null,created_at.eq.${ts},id.gt.${c.i}),date_applied.not.is.null`;
  // A dated row: the undated block came before it, so it is never matched here.
  const d = `"${c.d}"`;
  return `date_applied.lt.${d},and(date_applied.eq.${d},created_at.lt.${ts}),and(date_applied.eq.${d},created_at.eq.${ts},id.gt.${c.i})`;
}

export type ListMode =
  | { mode: "all" }
  | { mode: "page"; statuses: Status[] | null; limit: number; cursor: ListCursor | null }
  | { mode: "error"; error: string };

/** Which list the query string asks for. Nothing, or ?all=1, is the full list. */
export function readListMode(params: URLSearchParams): ListMode {
  if (params.get("all") === "1") return { mode: "all" };
  // An empty value asks for nothing: only a stage, limit or cursor with something in it is a page.
  const value = (k: string) => {
    const v = params.get(k);
    return v !== null && v.trim() !== "" ? v.trim() : null;
  };
  const stage = value("stage"), limitText = value("limit"), cursorText = value("cursor");
  if (stage === null && limitText === null && cursorText === null) return { mode: "all" };
  let statuses: Status[] | null = null;
  if (stage !== null) {
    statuses = stageStatuses(stage);
    if (!statuses) return { mode: "error", error: `Unknown stage "${stage.slice(0, 40)}".` };
  }
  let limit = PAGE_LIMIT_DEFAULT;
  if (limitText !== null) {
    const n = Number(limitText);
    if (!Number.isInteger(n) || n < 1) return { mode: "error", error: "limit must be a whole number from 1." };
    limit = Math.min(n, PAGE_LIMIT_MAX);
  }
  let cursor: ListCursor | null = null;
  if (cursorText !== null) {
    cursor = decodeCursor(cursorText);
    if (!cursor) return { mode: "error", error: "That cursor is not one this list gave out." };
  }
  return { mode: "page", statuses, limit, cursor };
}

/**
 * A row of one page: the list row without the notes preview. Any row with notes says
 * notes_more, so the page knows its notes are not known yet: the Notes box stays locked
 * until the detail read brings the full text (a preview-less row read as "no notes" and a
 * Save there wiped them — the 6 Nov review).
 */
export function toPageRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = toListRow(row);
  delete out.notes_preview;
  if (typeof row.notes === "string" && row.notes.trim()) out.notes_more = true;
  else delete out.notes_more;
  return out;
}

// ── The light list for automations (12 Nov 2026, Chunk 22) ─────────────────
// GET /api/applications?lite=1: seven small fields per row in ONE select, filtered in
// the database. On 11 Nov a sweep's few full-list reads (~1,190 rows each) froze its
// browser tab past the 45 s CDP limit three times; the full list stays as it was for
// the page and for the sweeps that read it.
//
// No notes and no version: `updated_at_minute` is the row's updated_at cut to the
// minute, so it can never be sent back as if_updated_at (lib/notesWrite): a version
// must come from the read that returned the full notes (the 10 Nov wipe).

export const LITE_COLUMNS = "id, company_name, role, status, date_applied, followup_date, updated_at";
export const LITE_LIMIT_DEFAULT = 200;
export const LITE_LIMIT_MAX = MAX_APPLICATIONS;
export const LITE_Q_MAX = 100;
// What due_by keeps (12 Nov 2026, Chunk 23): the rows lib/followupsDue counts, the page's
// "Follow-ups due today" counter. Sent and live (never a Ready to submit row, which was
// never sent; never a closed one), and no ending a sweep reported waiting on the row.
// Until Chunk 23 it was every status but Rejected, Withdrawn and Ghosted.
export const LITE_DUE_STATUSES: readonly Status[] = FOLLOWUP_DUE_STATUSES;
const PENDING_ENDINGS: readonly Status[] = ["rejected", "withdrawn", "ghosted"];

/**
 * The PostgREST `or` filter that leaves out a row with an ending waiting on it
 * (lib/followupsDue hasPendingEnding): no pending outcome, one the user dismissed, or one
 * that is not an ending (a question). Every stored spelling of the endings.
 */
export function liteDuePendingFilter(): string {
  return `pending_outcome.is.null,pending_outcome->>dismissed.eq.true,pending_outcome->>outcome.is.null,pending_outcome->>outcome.not.in.${storedInList(PENDING_ENDINGS)}`;
}

export type LiteQuery = { q: string | null; since: string | null; statuses: Status[] | null; dueBy: string | null; limit: number };

const LITE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function liteDate(value: string): boolean {
  if (!LITE_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The lite list's filters, every one checked before it reaches a query. */
export function readLiteQuery(params: URLSearchParams): { query: LiteQuery } | { error: string } {
  const value = (k: string) => {
    const v = params.get(k);
    return v !== null && v.trim() !== "" ? v.trim() : null;
  };
  const q = value("q")?.replace(/\s+/g, " ") ?? null;
  if (q !== null && q.length > LITE_Q_MAX) return { error: `q is too long (max ${LITE_Q_MAX} characters).` };
  const since = value("since");
  if (since !== null && !liteDate(since)) return { error: "since must be a date (YYYY-MM-DD)." };
  const dueBy = value("due_by");
  if (dueBy !== null && !liteDate(dueBy)) return { error: "due_by must be a date (YYYY-MM-DD)." };
  let statuses: Status[] | null = null;
  const statusText = value("status");
  if (statusText !== null) {
    const parts = statusText.split(",").map((s) => s.trim()).filter(Boolean);
    const read = parts.map((s) => ({ s, status: normalizeStatus(s) }));
    const unknown = read.find((r) => !r.status);
    if (unknown) return { error: `Unknown status "${unknown.s.slice(0, 40)}".` };
    statuses = [...new Set(read.map((r) => r.status as Status))];
    if (statuses.length === 0) statuses = null;
  }
  let limit = LITE_LIMIT_DEFAULT;
  const limitText = value("limit");
  if (limitText !== null) {
    const n = Number(limitText);
    if (!Number.isInteger(n) || n < 1) return { error: "limit must be a whole number from 1." };
    limit = Math.min(n, LITE_LIMIT_MAX);
  }
  return { query: { q, since, statuses, dueBy, limit } };
}

/**
 * company_name or role contains `q`, ignoring case, as one PostgREST `or` filter. The text is
 * escaped twice: for LIKE (\ % _ are literal) and for PostgREST's quoted value (\ "), so a
 * comma, bracket or quote in a company's name is just a character. A `*` stays PostgREST's
 * wildcard: it has no escape there.
 */
export function liteSearchFilter(q: string): string {
  const like = `*${q.replace(/[\\%_]/g, (m) => `\\${m}`)}*`;
  const quoted = `"${like.replace(/[\\"]/g, (m) => `\\${m}`)}"`;
  return `company_name.ilike.${quoted},role.ilike.${quoted}`;
}

/** A PostgREST `in` list of every stored spelling of these statuses, quoted. */
export function storedInList(statuses: readonly Status[]): string {
  return `(${storedValuesFor(statuses).map((v) => `"${v}"`).join(",")})`;
}

/** The row's updated_at cut to the minute ("2026-11-12T14:05:00Z"): when it last changed, never a version. */
export function minuteOf(updatedAt: unknown): string | null {
  if (typeof updatedAt !== "string") return null;
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString().replace(".000Z", "Z");
}

export type LiteRow = {
  id: string;
  company_name: string;
  role: string;
  status: string;
  date_applied: string | null;
  followup_date: string | null;
  updated_at_minute: string | null;
};

/** One row of the lite list: every key present (null when empty), the status in the API's spelling. */
export function toLiteRow(row: Record<string, unknown>): LiteRow {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const date = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: text(row.id),
    company_name: text(row.company_name),
    role: text(row.role),
    status: apiStatus(row.status),
    date_applied: date(row.date_applied),
    followup_date: date(row.followup_date),
    updated_at_minute: minuteOf(row.updated_at),
  };
}
