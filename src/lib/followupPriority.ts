// Follow-up priority (Chunk JH-1, 19 Nov 2026): the order a long follow-up list is
// worked in, so the ones that matter — an interview, a screening, a human who replied —
// sit above the 300-odd ATS-only cadences a sweep leaves behind.
//
// The owner's dashboard on 18 Nov listed 390 follow-ups due (46 today, 344 overdue). A
// flat list that long hides the warm ones, so the follow-up view sorts by this score and
// shows the top 15 as "Today's follow-ups". The score never closes or moves anything; it
// only decides what is read first.
//
// Order (highest first), the chunk's own: a row past the screen (interview / screening /
// assessment) > a human replied > a named contact or referrer > a referral in flight >
// ATS-only. The weights are spread far apart so the order is exactly that precedence even
// when a row ticks several boxes, and a later tie breaks on the oldest follow-up date, so
// the most overdue of an equal band comes first.
//
// Relative .ts imports only, so it runs under node:test (tests/followupPriority).
import { isFollowupDueToday, type DueRow } from "./followupsDue.ts";
import { normalizeStatus, type Status } from "./tracker.ts";

/** A row has reached the screen or beyond: the follow-up is part of a live conversation. */
const PROGRESSED_STAGES: ReadonlySet<Status> = new Set<Status>(["screening", "interview", "assessment", "offer"]);

export type PriorityRow = DueRow & {
  status: unknown;
  last_contact_from?: "me" | "them" | null;
  contact_email?: string | null;
  referrer_name?: string | null;
  referral?: boolean | null;
  referral_status?: string | null;
  source?: string | null;
};

// The bands, spread so each outranks every combination of the ones below it.
const STAGE = 1000;
const HUMAN_REPLIED = 100;
const NAMED_CONTACT = 10;
const REFERRAL = 1;

/**
 * The priority of a follow-up. Additive bands: a progressed row with a reply scores
 * STAGE + HUMAN_REPLIED, but a progressed row alone still outranks any ATS-only row
 * however many lesser boxes it ticks. Higher is more important.
 */
export function followupPriority(row: PriorityRow): number {
  let score = 0;
  const status = normalizeStatus(row.status);
  if (status && PROGRESSED_STAGES.has(status)) score += STAGE;
  if (row.last_contact_from === "them") score += HUMAN_REPLIED;
  if ((row.contact_email && row.contact_email.trim()) || (row.referrer_name && row.referrer_name.trim())) score += NAMED_CONTACT;
  if (row.referral === true || (row.referral_status && row.referral_status.trim())) score += REFERRAL;
  return score;
}

export type RankedFollowup<T extends PriorityRow> = { row: T; priority: number };

/** Every row, by priority then by the oldest follow-up date first. Pure sort, no filter. */
export function byFollowupPriority<T extends PriorityRow>(rows: readonly T[]): RankedFollowup<T>[] {
  return rows
    .map((row) => ({ row, priority: followupPriority(row) }))
    .sort((a, b) => b.priority - a.priority || (a.row.followup_date ?? "9999").localeCompare(b.row.followup_date ?? "9999"));
}

export const TODAYS_FOLLOWUPS_LIMIT = 15;

export type TodaysFollowups<T extends PriorityRow> = {
  /** The top `limit` due-today rows, highest priority first. */
  items: RankedFollowup<T>[];
  /** How many are due today or earlier in all (the rest are below the fold). */
  total: number;
  /** total minus what is shown. */
  hidden: number;
};

/**
 * "Today's follow-ups": the rows due today or earlier (lib/followupsDue), ranked by
 * priority, capped at `limit`. `today` is YYYY-MM-DD. The cap is what stops a 344-strong
 * overdue backlog from burying the one interview follow-up that matters this morning.
 */
export function todaysFollowups<T extends PriorityRow>(rows: readonly T[], today: string, limit = TODAYS_FOLLOWUPS_LIMIT): TodaysFollowups<T> {
  const due = rows.filter((r) => isFollowupDueToday(r, today));
  const ranked = byFollowupPriority(due);
  return { items: ranked.slice(0, limit), total: ranked.length, hidden: Math.max(0, ranked.length - limit) };
}
