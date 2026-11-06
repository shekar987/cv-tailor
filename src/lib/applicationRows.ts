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
  // Only a row that got shortlisted needs it, for the Live section's order: every row's would cost 40 KB.
  if (typeof row.updated_at === "string" && reachedScreening({ status: row.status, stages_reached: row.stages_reached as string[] | null })) out.updated_at = row.updated_at;
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

export type ListCursor = { d: string; c: string; i: string };
const CURSOR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const CURSOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The position after `row`, in the list's order (date_applied desc, created_at desc, id asc). */
export function encodeCursor(row: { date_applied?: unknown; created_at?: unknown; id?: unknown }): string | null {
  const cursor = { d: row.date_applied, c: row.created_at, i: row.id };
  if (typeof cursor.d !== "string" || typeof cursor.c !== "string" || typeof cursor.i !== "string") return null;
  // Plain text (the page imports this file, and a browser has no Buffer); a "|" never occurs in a part.
  return [cursor.d, cursor.c, cursor.i].join("|");
}

/** A cursor the caller sent, checked to the character: it ends up inside a PostgREST filter. */
export function decodeCursor(value: string): ListCursor | null {
  try {
    const [d, c, i, extra] = value.split("|");
    if (extra !== undefined) return null;
    if (typeof d !== "string" || !CURSOR_DATE_RE.test(d)) return null;
    if (typeof c !== "string" || !CURSOR_TS_RE.test(c)) return null;
    if (typeof i !== "string" || !CURSOR_ID_RE.test(i)) return null;
    return { d, c, i };
  } catch {
    return null;
  }
}

/** The rows after the cursor, as one PostgREST `or` filter (values quoted: a timestamp carries ':' '+' '.'). */
export function afterCursor(c: ListCursor): string {
  const d = `"${c.d}"`, ts = `"${c.c}"`;
  return `date_applied.lt.${d},and(date_applied.eq.${d},created_at.lt.${ts}),and(date_applied.eq.${d},created_at.eq.${ts},id.gt.${c.i})`;
}

export type ListMode =
  | { mode: "all" }
  | { mode: "page"; statuses: Status[] | null; limit: number; cursor: ListCursor | null }
  | { mode: "error"; error: string };

/** Which list the query string asks for. Nothing, or ?all=1, is the full list. */
export function readListMode(params: URLSearchParams): ListMode {
  if (params.get("all") === "1") return { mode: "all" };
  const stage = params.get("stage"), limitText = params.get("limit"), cursorText = params.get("cursor");
  if (stage === null && limitText === null && cursorText === null) return { mode: "all" };
  let statuses: Status[] | null = null;
  if (stage !== null && stage.trim() !== "") {
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
  if (cursorText !== null && cursorText !== "") {
    cursor = decodeCursor(cursorText);
    if (!cursor) return { mode: "error", error: "That cursor is not one this list gave out." };
  }
  return { mode: "page", statuses, limit, cursor };
}

/** A row of one page: the list row without the notes preview (the flags stay). */
export function toPageRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = toListRow(row);
  delete out.notes_preview;
  delete out.notes_more;
  return out;
}
