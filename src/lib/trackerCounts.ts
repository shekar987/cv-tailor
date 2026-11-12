// The tracker's counts (6 Nov 2026, Chunk 19): what GET /api/applications/counts
// answers and what /applications draws, from one place, so the tiles read the
// same number whether they came from the server (first paint) or the full list.
//
// "Follow-ups due" became "due this week". The old tile counted every live row
// whose follow-up date had passed, 240 on 6 Nov, most of them cadences that
// had run out weeks before: a number no one can act on. This week is Monday to
// Sunday of the week that holds `today`, earlier days included (a follow-up
// due on Monday is still this week's on Thursday).
//
// Relative .ts imports only, so it runs under node:test.
import { tabCounts, eventsByApplication, type TabKey } from "./applicationStage.ts";
import { actionableEvents } from "./actionCentre.ts";
import { isFollowupDueThisWeek, weekOf } from "./tracker.ts";
import { followupsDueToday, type DueTodayCount } from "./followupsDue.ts";
import type { PlanEvent } from "./plan.ts";

export { isFollowupDueThisWeek, weekOf };

export function followupsDueThisWeek(rows: readonly { followup_date: string | null | undefined; status: unknown }[], today: string): number {
  return rows.filter((r) => isFollowupDueThisWeek(r, today)).length;
}

export type TrackerCounts = {
  counts: Record<TabKey, number>;
  total: number;
  followups_due_this_week: number;
  /** "Follow-ups due today" (Chunk 23, lib/followupsDue): today or earlier, sent, live, no ending waiting. */
  followups_due_today: DueTodayCount;
  week: { from: string; to: string };
};

/**
 * The counts the page's tabs and tiles show, over every row: the derived stage
 * per row (an open test on an Applied row counts under Assessment), from the
 * same open events the page reads (lib/actionCentre actionableEvents).
 */
export function trackerCounts(
  rows: readonly { id: string; status: unknown; followup_date?: string | null; pending_outcome?: unknown }[],
  openEvents: readonly Pick<PlanEvent, "application_id" | "status" | "kind" | "starts_at" | "due_at">[],
  today: string
): TrackerCounts {
  const live = actionableEvents(openEvents as PlanEvent[], rows.map((r) => ({ id: r.id, status: String(r.status ?? "") })));
  return {
    counts: tabCounts(rows, eventsByApplication(live)),
    total: rows.length,
    followups_due_this_week: followupsDueThisWeek(rows.map((r) => ({ followup_date: r.followup_date ?? null, status: r.status })), today),
    followups_due_today: followupsDueToday(rows.map((r) => ({ followup_date: r.followup_date ?? null, status: r.status, pending_outcome: r.pending_outcome })), today),
    week: weekOf(today),
  };
}
