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
};

export function followupsDueToday(rows: readonly DueRow[], today: string): DueTodayCount {
  let total = 0;
  let exact = 0;
  for (const r of rows) {
    if (!isFollowupDueToday(r, today)) continue;
    total++;
    if (r.followup_date === today) exact++;
  }
  return { total, today: exact, earlier: total - exact };
}
