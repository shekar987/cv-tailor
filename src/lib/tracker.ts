// The application tracker's shared rules (30 Sep audit, Phase 4). One copy of
// the status list for the sheet, the API, the CSV export and the insights —
// six hand-copied lists had already drifted in wording — plus the small
// deterministic decisions the sheet and /app's Applied button both make:
// which statuses count as submitted, when a follow-up is due, when a status
// change clears it, what a duplicate row is, and the "Send anyway?" reasons.
// Imports only ./companyMatch.ts so node:test can run it (tests/tracker.test.ts).

import { companyNamesMatch } from "./companyMatch.ts";

// "saved" is a row the user has prepared but not yet sent (shown as "Ready to
// submit"): it sits in the tracker so nothing is lost, but it is not an
// application yet — the insights, the follow-up chip and the "applied" counts
// leave it out. "accepted" is shown as "Won".
// Order matters: the sheet sorts status in funnel order and the chips follow it.
export const STATUSES = ["saved", "applied", "screening", "interview", "assessment", "offer", "accepted", "rejected", "withdrawn", "ghosted"] as const;
export type Status = (typeof STATUSES)[number];
export const READY_TO_SUBMIT: Status = "saved";

export const STATUS_LABELS: Record<Status, string> = {
  saved: "Ready to submit",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  accepted: "Won",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
};

// Stored rows may still hold the old labels ("Applied", "Ready to submit"):
// migration 20261103130000 rewrites them after the deploy, and the owner's sweeps still
// write them through the API. Every read inside the app goes through here.
const OLD_LABELS: Record<string, Status> = { "ready to submit": "saved" };

export function normalizeStatus(value: unknown): Status | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if ((STATUSES as readonly string[]).includes(key)) return key as Status;
  return OLD_LABELS[key] ?? null;
}

// What /api/applications answers with, whichever spelling the row is stored in. The
// owner's sweeps read and write these exact strings, so this list is a contract: the
// first six never change, whatever the database holds. Pages convert to the keys on load.
export const API_STATUS: Record<Status, string> = {
  saved: "Ready to submit",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
};

export function apiStatus(value: unknown): string {
  const status = normalizeStatus(value);
  return status ? API_STATUS[status] : typeof value === "string" ? value : "";
}

export function isStatus(value: unknown): value is Status {
  return normalizeStatus(value) !== null;
}

export function statusLabel(value: unknown): string {
  const status = normalizeStatus(value);
  return status ? STATUS_LABELS[status] : typeof value === "string" ? value : "";
}

// The label a database still on the old CHECK accepts; null for a status it has
// no label for. Also what a filter on a stored column must match beside the key.
const OLD_STATUS_LABELS: Partial<Record<Status, string>> = {
  saved: "Ready to submit",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
export function oldStatusLabel(status: Status): string | null {
  return OLD_STATUS_LABELS[status] ?? null;
}
export function storedStatusValues(status: Status): string[] {
  const old = oldStatusLabel(status);
  return old ? [status, old] : [status];
}

// Submitted = an application the user actually sent. Everything but the
// not-yet-sent row.
export function isSubmitted(status: string): boolean {
  return normalizeStatus(status) !== READY_TO_SUBMIT;
}

// The one rule for the plan and the stage tabs: an application is active only
// at one of these statuses. Anything else never reaches the plan, and its events
// are hidden, not deleted, so moving the row back brings them back.
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set<Status>(["screening", "interview", "assessment", "offer"]);
export function isActiveStatus(status: unknown): boolean {
  const s = normalizeStatus(status);
  return !!s && ACTIVE_STATUSES.has(s);
}

// A row's stage history after a status change: what the database trigger writes
// (migration 20261103120000), for a page that keeps the row in memory. One ending at a
// time; a move back drops later stages; an ending keeps the path that led to it.
const STAGE_RANK: Partial<Record<Status, number>> = { saved: 0, applied: 1, screening: 2, interview: 3, assessment: 3, offer: 4, accepted: 5 };
const ENDINGS: ReadonlySet<string> = new Set<Status>(["rejected", "withdrawn", "ghosted"]);
export function stagesAfterMove(stages: readonly string[] | null | undefined, status: unknown): string[] {
  const stage = normalizeStatus(status);
  const known = (stages ?? []).map(normalizeStatus).filter((s): s is Status => !!s);
  if (!stage) return known;
  const kept = known.filter((s) => {
    if (ENDINGS.has(s) || s === stage) return false;
    return ENDINGS.has(stage) || (STAGE_RANK[s] ?? 9) <= (STAGE_RANK[stage] ?? 9);
  });
  return [...kept, stage];
}

// The tabs with date columns. Won holds offers too, so an offer is celebrated from
// the day it lands.
export const STAGE_TABS: readonly Status[] = ["screening", "interview", "assessment", "offer", "rejected", "accepted"];
export function isStageTab(value: unknown): value is Status {
  return (STAGE_TABS as readonly unknown[]).includes(value);
}

/** A tab holds a row by its CURRENT status only. */
export function inStageTab(status: unknown, tab: Status): boolean {
  const s = normalizeStatus(status);
  return tab === "accepted" ? s === "accepted" || s === "offer" : s === tab;
}

/** With "Include past stages" on, also a row that has been through this stage. */
export function inStageTabOrPast(row: { status: unknown; stages_reached?: readonly string[] | null }, tab: Status): boolean {
  if (inStageTab(row.status, tab)) return true;
  return (row.stages_reached ?? []).some((s) => inStageTab(s, tab));
}

/** The stored values a tab's filter matches, old labels included. */
export function stageTabValues(tab: Status): string[] {
  return tab === "accepted" ? [...storedStatusValues("accepted"), ...storedStatusValues("offer")] : storedStatusValues(tab);
}

// Past the screen. Rejected is the other outcome; Applied is still pending.
export const PROGRESSED: ReadonlySet<string> = new Set<Status>(["screening", "interview", "assessment", "offer", "accepted"]);
export function hasProgressed(status: unknown): boolean {
  const s = normalizeStatus(status);
  return !!s && PROGRESSED.has(s);
}

// An outcome with no progress: a rejection, or a silence the user has called Ghosted.
export function endedWithoutProgress(status: unknown): boolean {
  const s = normalizeStatus(status);
  return s === "rejected" || s === "ghosted";
}

// A follow-up is "due" while the application is still moving — a date in the
// past on a Rejected row is history, and a row that was never sent has nothing
// to follow up.
export const LIVE_STATUSES: ReadonlySet<string> = new Set<Status>(["applied", "screening", "interview", "assessment"]);

export function isFollowupDue(row: { followup_date: string | null; status: string }, today: string): boolean {
  return !!row.followup_date && row.followup_date <= today && LIVE_STATUSES.has(normalizeStatus(row.status) ?? "");
}

// A row marked Rejected, Withdrawn, Ghosted or Won has ended: an open follow-up
// date would only keep it in the "due" chip. The date is cleared and recorded in
// the notes so nothing is lost.
export const CLOSED_STATUSES: ReadonlySet<string> = new Set<Status>(["rejected", "withdrawn", "ghosted", "accepted"]);

export function clearsFollowup(status: string): boolean {
  return CLOSED_STATUSES.has(normalizeStatus(status) ?? "");
}

export function followupClearedNote(followup: string, status: string, today: string): string {
  return `Follow-up ${followup} cleared when marked ${statusLabel(status)} on ${today}.`;
}

/** Takes back the line followupClearedNote added, for an undo. Every other line stays. */
export function removeFollowupClearedNote(notes: string | null | undefined, followup: string): string {
  const lines = (notes ?? "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith(`Follow-up ${followup} cleared when marked `)) {
      lines.splice(i, 1);
      break;
    }
  }
  return lines.join("\n").trimEnd();
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

// A live conversation with no record of what was applied to or sent: the row
// in Screening or Interview you will want to read back before the call. A
// tailored row carries its CV in the snapshot; a hand-added one needs the file.
export const ATTACHMENT_STATUSES: ReadonlySet<string> = new Set<Status>(["screening", "interview", "assessment"]);
export type RowFlagFields = {
  status: string;
  source?: string;
  has_job_description?: boolean;
  sent_cv_name?: string | null;
  triage_verdict?: "apply" | "review" | "skip";
  triage_reasons?: string[];
};
export function missingAttachments(row: RowFlagFields): ("Missing JD" | "Missing CV")[] {
  if (!ATTACHMENT_STATUSES.has(normalizeStatus(row.status) ?? "")) return [];
  const out: ("Missing JD" | "Missing CV")[] = [];
  if (!row.has_job_description) out.push("Missing JD");
  if (row.source !== "tailored" && !row.sent_cv_name) out.push("Missing CV");
  return out;
}

// What the sheet says about a row's triage. A row made outside /app was never
// checked, so it says so and offers the check; a tailored row went through the
// pre-check and only speaks up when its stored read found something.
export type RowCheck =
  | { kind: "checked"; verdict: "apply" | "review" | "skip"; reasons: string[] }
  | { kind: "run" }
  | { kind: "add_jd" };
export function rowCheck(row: RowFlagFields): RowCheck | null {
  const manual = row.source !== "tailored";
  if (row.triage_verdict && (manual || row.triage_verdict !== "apply")) {
    return { kind: "checked", verdict: row.triage_verdict, reasons: row.triage_reasons ?? [] };
  }
  if (!manual || row.triage_verdict) return null;
  return row.has_job_description ? { kind: "run" } : { kind: "add_jd" };
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
    const status = d.status ? ` (${statusLabel(d.status)})` : "";
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
  if (row.status && CLOSED_STATUSES.has(normalizeStatus(row.status) ?? "")) return false;
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
