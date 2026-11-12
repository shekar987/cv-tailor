// One-call application logging (12 Nov 2026, Chunk 22): the rules behind
// POST /api/applications/log, which creates a tracker row with the CV and cover letter
// files that were sent, in one multipart request. Relative imports, so it runs under
// node:test (tests/applicationLog).
//
// On 11 Nov six applications took three calls each (POST the row, PUT the JD, POST the
// CV) and the CV step was nearly missed. A retried log is the risk of one call, so the
// same company and role logged inside LOG_DUPLICATE_DAYS is refused (409) with the row
// it matched, unless the caller sends force=1. The match is strict, like the company
// rules' (lib/companyRules sameCompany / sameRole): the whole name and the whole title,
// so "Wise" is not "Wise Owl Consulting" and "Software Engineer" is not "Software
// Engineer in Test"; a place after the title ("- London") is not part of it.
import { sameCompany, sameRole } from "./companyRules.ts";
import { STATUS_LABELS, normalizeStatus } from "./tracker.ts";
import { formatDate } from "./formatDate.ts";

export const LOG_DUPLICATE_DAYS = 90;
// Who logged a row sent through this endpoint when it doesn't say (the "Logged by" badge):
// nothing but a script calls it.
export const LOG_DEFAULT_LOGGED_BY = "assistant";

// The text fields the form may carry; anything else is refused, so a typo
// ("company" for "company_name") is an error rather than a silently empty field.
export const LOG_TEXT_FIELDS = [
  "company_name",
  "role",
  "status",
  "date_applied",
  "followup_date",
  "salary",
  "source",
  "job_description",
  "append_note",
  "logged_by",
  "applied_from_email",
  "next_deadline",
  "deadline_note",
  "force",
] as const;
export const LOG_FILE_FIELDS = ["cv", "cover_letter"] as const;
export type LogFileField = (typeof LOG_FILE_FIELDS)[number];

export type FormEntry = { name: string; value: string } | { name: string; file: { name: string; size: number; sha256: string } };

/** The form's text fields as a body, or why the form is wrong. Files are checked by the route. */
export function readLogForm(entries: readonly FormEntry[]): { body: Record<string, string>; files: LogFileField[] } | { error: string } {
  const body: Record<string, string> = {};
  const files: LogFileField[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) return { error: `"${e.name.slice(0, 40)}" was sent twice.` };
    seen.add(e.name);
    const isFileField = (LOG_FILE_FIELDS as readonly string[]).includes(e.name);
    if ("file" in e) {
      if (!isFileField) return { error: `"${e.name.slice(0, 40)}" is not a file field: send files as cv and cover_letter.` };
      files.push(e.name as LogFileField);
      continue;
    }
    if (isFileField) return { error: `${e.name} must be a file (PDF, Word or text), not text.` };
    if (!(LOG_TEXT_FIELDS as readonly string[]).includes(e.name)) {
      return { error: `Unknown field "${e.name.slice(0, 40)}". Fields: ${LOG_TEXT_FIELDS.join(", ")}; files: cv, cover_letter.` };
    }
    body[e.name] = e.value;
  }
  return { body, files };
}

/** force=1 (or true / yes): log even when the same company and role was logged recently. */
export function readForce(value: unknown): boolean {
  return typeof value === "string" && /^(1|true|yes)$/i.test(value.trim());
}

/** How the row was made: by hand (the default) or a cold email. A tailored row comes from /app with its CV. */
export function readLogSource(value: unknown): { source: "manual" | "cold-email" } | { error: string } {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text || text === "manual") return { source: "manual" };
  if (text === "cold-email" || text === "cold_email") return { source: "cold-email" };
  if (text === "tailored") return { error: "A tailored row is saved from /app (Applied), with the CV it was tailored into. Log this one as manual." };
  return { error: `source must be "manual" or "cold-email" (where you applied belongs in append_note).` };
}

export type LoggedRow = { id: string; company_name: string; role: string; status: string; date_applied: string | null; created_at?: string | null; sent_cv_name?: string | null };

const DAY_MS = 86_400_000;
function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms / DAY_MS : null;
}

/** The first day of the window, for the database read: rows dated on or after it (and undated rows). */
export function windowStart(reference: string, days: number = LOG_DUPLICATE_DAYS): string {
  const n = dayNumber(reference);
  return n === null ? reference : new Date((n - days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The row this log would repeat: the same company and role, applied (else created) within
 * `days` of the new row's date (else today). The nearest in time wins.
 */
export function findRecentDuplicate<T extends LoggedRow>(
  rows: readonly T[],
  draft: { company_name: string; role: string; date_applied: string | null },
  today: string,
  days: number = LOG_DUPLICATE_DAYS
): T | null {
  const ref = dayNumber(draft.date_applied ?? today);
  if (ref === null) return null;
  let best: { row: T; gap: number } | null = null;
  for (const r of rows) {
    if (!sameCompany(r.company_name, draft.company_name) || !sameRole(r.role, draft.role)) continue;
    const when = dayNumber(r.date_applied ?? r.created_at ?? "");
    if (when === null) continue;
    const gap = Math.abs(when - ref);
    if (gap > days) continue;
    if (!best || gap < best.gap) best = { row: r, gap };
  }
  return best?.row ?? null;
}

/** The 409's sentence: which row it matched and how to log anyway. */
export function duplicateMessage(row: LoggedRow): string {
  const status = normalizeStatus(row.status);
  const label = status ? STATUS_LABELS[status] : row.status;
  const when = row.date_applied ? `applied ${formatDate(row.date_applied)}` : row.created_at ? `logged ${formatDate(row.created_at)}` : "logged before";
  return `Already in your tracker: ${row.company_name} — ${row.role}, ${when} (${label}). Nothing was saved. If this is a new application, send force=1 to log it again.`;
}

/**
 * What the Idempotency-Key fingerprint reads of a log form: the text fields, and each file
 * by name, size and the hash of its bytes, in a fixed order. A rebuilt FormData gets a new
 * multipart boundary, so the raw body is never compared.
 */
export function logFormFingerprint(entries: readonly FormEntry[]): string {
  const parts = entries
    .map((e) => ("file" in e ? `${e.name}=file:${e.file.name}:${e.file.size}:${e.file.sha256}` : `${e.name}=${e.value}`))
    .sort();
  return JSON.stringify(parts);
}
