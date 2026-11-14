// The "Today (n)" section on /applications (14 Nov 2026, Chunk 27).
//
// On a phone the red "Do these today" strip and five stacked cards pushed the search box
// and the list a full screen down. They now sit in one section, folded on a phone and open
// on a wider screen. Folding must never hide a deadline, so the folded header carries the
// count and one line saying what is due soonest.
//
// Relative .ts imports only, so it runs under node:test (tests/todaySection).
import { dueTodaySentence, type DueTodayCount } from "./followupsDue.ts";

/** What the section needs from an item of the 48-hour list (lib/deadlines DueItem). */
export type TodayItem = { id: string; kind: "deadline" | "followup" | "event"; company_name: string; action: string; when: string };

/**
 * The number beside "Today": everything in the 48-hour list, plus the follow-ups due today
 * that the list does not already hold. A follow-up on a screened application is in both, and
 * is counted once.
 */
export function todayCount(radar: readonly Pick<TodayItem, "id" | "kind">[], dueTodayIds: Iterable<string>): number {
  const listed = new Set(radar.filter((item) => item.kind === "followup").map((item) => item.id));
  let extra = 0;
  for (const id of new Set(dueTodayIds)) if (!listed.has(id)) extra++;
  return radar.length + extra;
}

/** An item's words with its company in front, as the red strip prints them. */
export function todayItemLine(item: Pick<TodayItem, "company_name" | "action">): string {
  return item.action.includes(item.company_name) ? item.action : `${item.company_name}: ${item.action}`;
}

/**
 * The one line under the folded header: the soonest thing due (the list is sorted soonest
 * first), else the follow-ups due, else that nothing is due.
 */
export function todayHint(radar: readonly Pick<TodayItem, "company_name" | "action" | "when">[], dueToday: Pick<DueTodayCount, "total" | "today" | "earlier"> & { oldest?: string | null }): string {
  const first = radar[0];
  if (first) return `Soonest: ${first.when} · ${todayItemLine(first)}`;
  if (dueToday.total > 0) return `${dueTodaySentence(dueToday)}.`;
  return "Nothing is due today.";
}

/** The fold: the user's own choice once they make one; else folded on a phone, open on a wider screen. */
export function todayOpen(choice: boolean | null, phone: boolean): boolean {
  return choice ?? !phone;
}
