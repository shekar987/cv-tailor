// Follow-up cadence and the two safe clean-ups (Chunk JH-1, 19 Nov 2026): when the next
// follow-up falls due, and which stale ATS-only rows may be OFFERED for a one-click bulk
// close. Nothing here writes or closes anything — every function returns a candidate or a
// date; the user confirms the bulk action, and the undo is the route's.
//
// The never-auto-close rule is the point: an application at screening, interview or
// assessment, or one where a human has replied, is a live conversation and is never a
// close candidate, whatever its dates. canAutoClose() is the single guard both offers run
// through, so the rule cannot be forgotten in one of them.
//
// A close here sets status "ghosted" (shown as "No reply") with close_reason "ghosted" —
// no new status, no migration (FIX NOTE, 22 Nov).
//
// Relative .ts imports only, so it runs under node:test (tests/cadence).
import { daysBetween } from "./planTime.ts";
import { normalizeStatus, type Status } from "./tracker.ts";

// Follow up a week after applying, then fortnightly, then monthly. The points are what
// "after 3 follow-ups" counts against: three follow-ups have passed once T+21 is reached.
export const CADENCE_DAYS = [7, 14, 21, 30] as const;
export const CLOSE_AFTER_FOLLOWUPS = 3; // the T+21 point: three follow-ups, no reply
export const CLOSE_AFTER_DAYS = CADENCE_DAYS[CLOSE_AFTER_FOLLOWUPS - 1]; // 21
export const ARCHIVE_AFTER_DAYS = 45;

// A live conversation: never auto-closed, never archived, whatever the dates say.
const LIVE_STAGES: ReadonlySet<Status> = new Set<Status>(["screening", "interview", "assessment", "offer"]);

export type CadenceRow = {
  status: unknown;
  date_applied?: string | null;
  last_contact_from?: "me" | "them" | null;
  contact_email?: string | null;
  referrer_name?: string | null;
  referral?: boolean | null;
  referral_status?: string | null;
  source?: string | null;
};

/** True only for a row safe to close with no human in the loop: Applied, no reply, no stage reached. */
export function canAutoClose(row: CadenceRow): boolean {
  const status = normalizeStatus(row.status);
  if (!status || status !== "applied") return false; // only a plain Applied row
  if (LIVE_STAGES.has(status)) return false; // belt and braces; "applied" is not in the set
  if (row.last_contact_from === "them") return false; // a human replied
  return true;
}

/** An ATS-only application: a plain submit with no named contact, referrer or referral. */
export function isAtsOnly(row: CadenceRow): boolean {
  if (row.last_contact_from === "them") return false;
  if (row.contact_email && row.contact_email.trim()) return false;
  if (row.referrer_name && row.referrer_name.trim()) return false;
  if (row.referral === true || (row.referral_status && row.referral_status.trim())) return false;
  return true;
}

/** Whole days since the row was applied, or null when it carries no applied date. */
export function daysSinceApplied(row: Pick<CadenceRow, "date_applied">, today: string): number | null {
  const applied = row.date_applied;
  if (!applied || !/^\d{4}-\d{2}-\d{2}$/.test(applied)) return null;
  const days = daysBetween(applied, today);
  return days < 0 ? null : days;
}

/**
 * How many of the cadence follow-ups should have been sent by now (0–4), from the days
 * since applying. T+7 is the first, T+30 the fourth. Null applied date → 0.
 */
export function cadenceStep(row: Pick<CadenceRow, "date_applied">, today: string): number {
  const days = daysSinceApplied(row, today);
  if (days === null) return 0;
  let step = 0;
  for (const point of CADENCE_DAYS) if (days >= point) step++;
  return step;
}

/** The next cadence date a row is owed as YYYY-MM-DD, or null once T+30 has passed. */
export function nextCadenceDate(row: Pick<CadenceRow, "date_applied">, today: string): string | null {
  const applied = row.date_applied;
  if (!applied || !/^\d{4}-\d{2}-\d{2}$/.test(applied)) return null;
  const days = daysSinceApplied(row, today);
  if (days === null) return null;
  const next = CADENCE_DAYS.find((point) => days < point);
  if (next === undefined) return null;
  const base = Date.parse(`${applied}T00:00:00Z`);
  return new Date(base + next * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A row to OFFER for "Close as No response": an ATS-only Applied row past its third
 * follow-up with no reply. Returns false for anything the never-auto-close guard holds.
 */
export function offerCloseNoResponse(row: CadenceRow, today: string): boolean {
  if (!canAutoClose(row) || !isAtsOnly(row)) return false;
  return cadenceStep(row, today) >= CLOSE_AFTER_FOLLOWUPS;
}

/**
 * A row to OFFER for "Archived – no response": older than 45 days with no contact at all.
 * Same guard; a live or human-replied row is never archived.
 */
export function offerArchive(row: CadenceRow, today: string): boolean {
  if (!canAutoClose(row) || !isAtsOnly(row)) return false;
  const days = daysSinceApplied(row, today);
  return days !== null && days > ARCHIVE_AFTER_DAYS;
}

/** The ids of every row an offer applies to, for the bulk confirm. */
export function closeNoResponseCandidates<T extends CadenceRow & { id: string }>(rows: readonly T[], today: string): T[] {
  return rows.filter((r) => offerCloseNoResponse(r, today));
}
export function archiveCandidates<T extends CadenceRow & { id: string }>(rows: readonly T[], today: string): T[] {
  return rows.filter((r) => offerArchive(r, today));
}

// What the bulk close writes (the route's own PUT reads these): "No reply" and a stamped
// reason. The undo sets the status back to Applied.
export const CLOSE_NO_RESPONSE_STATUS = "Ghosted"; // lib/tracker API spelling → "ghosted"
export const CLOSE_NO_RESPONSE_REASON = "ghosted";
export function closeNoResponseNote(today: string): string {
  return `Closed as No response on ${today}: no reply after the follow-up cadence.`;
}
export function archiveNote(today: string): string {
  return `Archived as No response on ${today}: ${ARCHIVE_AFTER_DAYS}+ days with no contact.`;
}
