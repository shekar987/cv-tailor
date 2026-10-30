// The application tracker's shared rules (30 Sep audit, Phase 4). One copy of
// the status list for the sheet, the API, the CSV export and the insights —
// six hand-copied lists had already drifted in wording — plus the small
// deterministic decisions the sheet and /app's Applied button both make:
// which statuses count as submitted, when a follow-up is due, when a status
// change clears it, what a duplicate row is, and the "Send anyway?" reasons.
// Imports only ./companyMatch.ts so node:test can run it (tests/tracker.test.ts).

import { companyNamesMatch } from "./companyMatch.ts";

// "Ready to submit" is a row the user has prepared but not yet sent: it sits
// in the tracker so nothing is lost, but it is not an application yet — the
// insights, the follow-up chip and the "applied" counts leave it out.
// Order matters: the sheet sorts status in funnel order and the chips follow it.
export const STATUSES = ["Ready to submit", "Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"] as const;
export type Status = (typeof STATUSES)[number];
export const READY_TO_SUBMIT: Status = "Ready to submit";

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

// Submitted = an application the user actually sent. Everything but the
// not-yet-sent row.
export function isSubmitted(status: string): boolean {
  return status !== READY_TO_SUBMIT;
}

// Past the screen. Rejected is the other outcome; Applied is still pending.
export const PROGRESSED: ReadonlySet<string> = new Set(["Screening", "Interview", "Offer"]);

// A follow-up is "due" while the application is still moving — a date in the
// past on a Rejected row is history, and a row that was never sent has nothing
// to follow up.
export const LIVE_STATUSES: ReadonlySet<string> = new Set(["Applied", "Screening", "Interview"]);

export function isFollowupDue(row: { followup_date: string | null; status: string }, today: string): boolean {
  return !!row.followup_date && row.followup_date <= today && LIVE_STATUSES.has(row.status);
}

// Marking a row Rejected or Withdrawn ends it: an open follow-up date would
// only keep it in the "due" chip. The date is cleared and recorded in the
// notes so nothing is lost.
export const CLOSED_STATUSES: ReadonlySet<string> = new Set(["Rejected", "Withdrawn"]);

export function clearsFollowup(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

export function followupClearedNote(followup: string, status: string, today: string): string {
  return `Follow-up ${followup} cleared when marked ${status} on ${today}.`;
}

// Appends a line to free-text notes, never duplicating an identical line.
export function appendNoteLine(notes: string | null | undefined, line: string): string {
  const current = (notes ?? "").trimEnd();
  if (current.split(/\r?\n/).some((l) => l.trim() === line)) return current;
  return current ? `${current}\n${line}` : line;
}

// A role title as a comparison key: case, brackets ("(Remote)", "(12-month
// FTC)"), punctuation, "&" and spacing are noise; the words are what matters.
// Seniority words stay — "Senior Engineer" and "Engineer" are different jobs.
export function normalizeRole(role: string | null | undefined): string {
  return (role || "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type DuplicateCandidate = { id?: string; company_name: string; role: string; date_applied?: string; status?: string };

// The row this company + role already has, if any — the same company by
// lib/companyMatch's rule and the same role by normalizeRole. The newest
// (by date applied) wins when several match. `excludeId` skips the row being
// edited.
export function findDuplicateApplication<T extends DuplicateCandidate>(
  rows: readonly T[],
  draft: { company_name: string; role: string },
  excludeId?: string
): T | null {
  const role = normalizeRole(draft.role);
  if (!role || !draft.company_name.trim()) return null;
  const matches = rows.filter(
    (r) => r.id !== excludeId && companyNamesMatch(r.company_name, draft.company_name) && normalizeRole(r.role) === role
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => (b.date_applied ?? "").localeCompare(a.date_applied ?? ""))[0];
}

// A role longer than this is usually a title plus extras ("Software Engineer
// - London - Hybrid - £45k"), which breaks the by-role insights and the
// duplicate check. Warn, never block: some titles really are long.
export const ROLE_WARN_CHARS = 80;

export function roleTooLong(role: string | null | undefined): boolean {
  return (role ?? "").trim().length > ROLE_WARN_CHARS;
}

// Notes that say the application was never sent. Used to offer moving such
// rows to "Ready to submit" — the user confirms the list; nothing moves alone.
const NOT_SUBMITTED_RE =
  /\b(?:not|never|haven'?t|hasn'?t|didn'?t|did not|have not|has not)\s+(?:yet\s+|actually\s+|been\s+)?(?:submit(?:ted)?|sen[dt]|appl(?:y|ied))\b|\bunsubmitted\b|\bnot yet (?:submitted|sent|applied)\b/i;

export function notesSayNotSubmitted(notes: string | null | undefined): boolean {
  return !!notes && NOT_SUBMITTED_RE.test(notes);
}

// The sheet shows this many rows at a time. Search, filters and the CSV
// export always cover the whole set; only the painted rows are paged.
export const PAGE_SIZE = 50;

export function pageSlice<T>(items: readonly T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: current, pages, from: items.length ? start + 1 : 0, to: start + slice.length };
}

// Why /app's Applied button asks "Send anyway?" before saving: a weak search
// visibility, an eligibility read of long shot / likely auto-rejected, or a
// row the tracker already holds for this company and role. Each reason is a
// plain sentence; none blocks.
export type SendConfirmInput = {
  band?: "weak" | "borderline" | "ready" | null;
  read?: "apply" | "long_shot" | "skip" | null;
  duplicate?: DuplicateCandidate | null;
};

export function sendConfirmReasons(input: SendConfirmInput): string[] {
  const reasons: string[] = [];
  if (input.band === "weak") reasons.push("The search-visibility score is weak: fewer than half of the role's terms are in this CV.");
  if (input.read === "skip") reasons.push("The eligibility read was \"likely auto-rejected\": the posting screens on a condition this profile does not meet.");
  else if (input.read === "long_shot") reasons.push("The eligibility read was \"long shot\": one of the posting's conditions is a stretch for this profile.");
  if (input.duplicate) {
    const d = input.duplicate;
    const when = d.date_applied ? ` on ${d.date_applied}` : "";
    const status = d.status ? ` (${d.status})` : "";
    reasons.push(`You already have ${d.company_name} — ${d.role}${when}${status} in the tracker.`);
  }
  return reasons;
}

// ── Reply owed (30 Oct 2026) ─────────────────────────────────────────────────
// Who spoke last on an application, and when (applications.last_contact_from
// / last_contact_at, migration 20261030120000). When it was THEM and more
// than a day ago, a reply is owed: the sheet marks the row and puts it first.
// The 29–30 Oct sweep found a contact who had answered on 26 Sep and had not
// been replied to for a month. A closed row (Rejected / Withdrawn) owes none.

export const LAST_CONTACT_FROM = ["me", "them"] as const;
export type LastContactFrom = (typeof LAST_CONTACT_FROM)[number];
export const REPLY_OWED_AFTER_MS = 24 * 60 * 60 * 1000;
// A clock a little ahead of the server's is not "the future".
const CONTACT_CLOCK_SKEW_MS = 60 * 60 * 1000;

export function isLastContactFrom(value: unknown): value is LastContactFrom {
  return typeof value === "string" && (LAST_CONTACT_FROM as readonly string[]).includes(value);
}

export type ContactFields = { last_contact_from?: string | null; last_contact_at?: string | null; status?: string };

export function isReplyOwed(row: ContactFields, now: Date | number = Date.now()): boolean {
  if (row.last_contact_from !== "them" || !row.last_contact_at) return false;
  if (row.status && CLOSED_STATUSES.has(row.status)) return false;
  const at = Date.parse(row.last_contact_at);
  if (!Number.isFinite(at)) return false;
  return (typeof now === "number" ? now : now.getTime()) - at > REPLY_OWED_AFTER_MS;
}

/** The rows that owe a reply first, everything else after; each group keeps its order. */
export function replyOwedFirst<T extends ContactFields>(rows: readonly T[], now: Date | number = Date.now()): T[] {
  const owed: T[] = [];
  const rest: T[] = [];
  for (const row of rows) (isReplyOwed(row, now) ? owed : rest).push(row);
  return [...owed, ...rest];
}

/**
 * A last-contact time from a request: a date (YYYY-MM-DD, read as midnight
 * UTC) or a full ISO timestamp, not in the future — as an ISO string. Empty
 * or null clears it (null); anything else is invalid (undefined).
 */
export function parseContactAt(value: unknown, now: Date | number = Date.now()): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return undefined;
  const at = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s.replace(" ", "T"));
  if (!Number.isFinite(at)) return undefined;
  if (at > (typeof now === "number" ? now : now.getTime()) + CONTACT_CLOCK_SKEW_MS) return undefined;
  return new Date(at).toISOString();
}
