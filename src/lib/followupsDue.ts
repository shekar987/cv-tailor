// "Follow-ups due today" (12 Nov 2026, Chunk 23): ONE rule for the /applications
// counter, GET /api/applications/counts and the lite list's due_by, so the page and
// the morning sweep count the same rows.
//
// A row is due when its follow-up date is today or earlier, it was sent and is still
// live (Applied, Screening, Interview, Assessment: lib/tracker isFollowupDue, never a
// Ready to submit row, which was never sent), and no ending is waiting on it. That
// last part is the "later Rejected email": a sweep that reads a rejection for a row
// that reached screening records it as a pending outcome (lib/closing) instead of
// moving the status, so until the user confirms it the row still reads as Screening,
// with its follow-up date. Notes are not read for rejection words: on 12 Nov every
// notes match among the owner's due rows was a false one ("… decided not to …").
//
// On the owner's tracker on 12 Nov: 356 sent, live rows with a follow-up date of today
// or earlier; 291 of them Applied rows all dated Monday 9 Nov. The count is honest; the
// block of dates is what makes it large.
//
// Relative .ts imports only, so it runs under node:test.
import { activePending, isEnding } from "./closing.ts";
import { formatDate } from "./formatDate.ts";
import { LIVE_STATUSES, isFollowupDue, type Status } from "./tracker.ts";

/** The statuses a follow-up can be due on: sent and still live. */
export const FOLLOWUP_DUE_STATUSES: readonly Status[] = [...LIVE_STATUSES] as Status[];

/** An ending (rejected, withdrawn, ghosted) a sweep reported and the user has not answered. */
export function hasPendingEnding(pending: unknown): boolean {
  const p = activePending(pending);
  return !!p && isEnding(p.outcome);
}

export type DueRow = { followup_date: string | null | undefined; status: unknown; pending_outcome?: unknown };

/** Is this row's follow-up due today (today or earlier)? `today` is YYYY-MM-DD. */
export function isFollowupDueToday(row: DueRow, today: string): boolean {
  if (!row.followup_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.followup_date)) return false;
  if (!isFollowupDue({ followup_date: row.followup_date, status: String(row.status ?? "") }, today)) return false;
  return !hasPendingEnding(row.pending_outcome);
}

export type DueTodayCount = {
  /** Every row due today or earlier: the counter's number. */
  total: number;
  /** Of those, the ones dated today. */
  today: number;
  /** Of those, the ones dated before today. */
  earlier: number;
  /** The earliest follow-up date among the overdue ones (YYYY-MM-DD), or null when none is overdue. */
  oldest: string | null;
};

export function followupsDueToday(rows: readonly DueRow[], today: string): DueTodayCount {
  let total = 0;
  let exact = 0;
  let oldest: string | null = null;
  for (const r of rows) {
    if (!isFollowupDueToday(r, today)) continue;
    total++;
    if (r.followup_date === today) exact++;
    else if (!oldest || r.followup_date! < oldest) oldest = r.followup_date!;
  }
  return { total, today: exact, earlier: total - exact, oldest };
}

/**
 * The card's words under its number (14 Nov 2026, Chunk 27). "1 Follow-ups due today" over
 * "0 dated today · 1 overdue" read as a contradiction: nothing was due today, one was late.
 * So the label says which it is, in the singular for one, with the date the late one was due:
 * "1" + "Follow-up overdue (due 9 Nov)". `oldest` may be missing (a count from an older
 * server answer): the date is then left out, never guessed.
 */
export function dueTodayLabel(count: Pick<DueTodayCount, "total" | "today" | "earlier"> & { oldest?: string | null }): string {
  const day = count.oldest ? formatDate(count.oldest, { year: false }) : "";
  if (count.earlier <= 0) return count.today === 1 ? "Follow-up due today" : "Follow-ups due today";
  if (count.today <= 0) {
    if (count.earlier === 1) return `Follow-up overdue${day ? ` (due ${day})` : ""}`;
    return `Follow-ups overdue${day ? ` (oldest due ${day})` : ""}`;
  }
  return `Follow-ups due: ${count.today} today, ${count.earlier} overdue${day ? ` (${count.earlier === 1 ? "due" : "oldest due"} ${day})` : ""}`;
}

/** The same as one sentence with its number: "1 follow-up overdue (due 9 Nov)". */
export function dueTodaySentence(count: Pick<DueTodayCount, "total" | "today" | "earlier"> & { oldest?: string | null }): string {
  const label = dueTodayLabel(count);
  return `${count.total} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
