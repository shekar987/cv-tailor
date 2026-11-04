// The "What's next" plan (3 Nov 2026): pure rules, imports only ./tracker.ts and
// ./planTime.ts so node:test can run them (tests/plan). The route (/api/plan), the
// page (/app/next) and the tracker's stage tabs all read through here, so one rule
// decides what is live.
import { isActiveStatus, normalizeStatus, type Status } from "./tracker.ts";
import {
  DEFAULT_TIMEZONE, MINUTE_MS,
  addDays, clockTime, countdown, dayKey, daysBetween, formatWhen, isClockTime, isDayKey, isValidTimeZone, longDay, mondayOf, span, weekdayOf, zonedTimeToMs,
} from "./planTime.ts";

export const EVENT_KINDS = ["screening_call", "interview", "assessment", "take_home", "deadline", "follow_up", "offer_deadline", "networking"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  screening_call: "Screening call",
  interview: "Interview",
  assessment: "Assessment",
  take_home: "Take-home",
  deadline: "Deadline",
  follow_up: "Follow-up",
  offer_deadline: "Offer deadline",
  networking: "Networking",
};
export const EVENT_STATUSES = ["scheduled", "to_book", "done", "cancelled", "missed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_SOURCES = ["manual", "gmail", "calendar"] as const;

export type Slot = { starts_at: string; ends_at: string | null };

export type PlanEvent = {
  id: string;
  application_id: string | null;
  kind: EventKind;
  title: string;
  stage_label?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  due_at?: string | null;
  date_only?: boolean;
  timezone?: string;
  location_or_link?: string | null;
  contact_name?: string | null;
  prep_notes?: string | null;
  offered_slots?: Slot[];
  status: EventStatus;
  source?: string;
};

export type PlanApplication = {
  id: string;
  company_name: string;
  role: string;
  status: string;
  date_applied?: string | null;
  followup_date?: string | null;
  last_contact_at?: string | null;
  last_contact_from?: string | null;
  stages_reached?: string[] | null;
  outcome_reason?: string | null;
  prep_generated_at?: string | null;
};

export type AvailabilityWindow = {
  id: string;
  weekday?: number | null;
  date?: string | null;
  start_time: string;
  end_time: string;
  timezone?: string;
  kind: "free" | "busy";
  label?: string | null;
};

// ── What is live ────────────────────────────────────────────────────────────

const OPEN_EVENT: ReadonlySet<string> = new Set<EventStatus>(["scheduled", "to_book"]);

/**
 * THE rule: an event is on the plan only while it is open and its application
 * is active. A rejected, withdrawn, ghosted or won application's events are
 * hidden, never deleted, so moving the row back brings them back. A networking
 * call belongs to no application and is always shown.
 */
export function activeEvents<E extends Pick<PlanEvent, "application_id" | "status">>(events: readonly E[], applications: readonly Pick<PlanApplication, "id" | "status">[]): E[] {
  const active = new Set(applications.filter((a) => isActiveStatus(a.status)).map((a) => a.id));
  return events.filter((e) => OPEN_EVENT.has(e.status) && (e.application_id === null || active.has(e.application_id)));
}

export function activeApplications<A extends Pick<PlanApplication, "status">>(applications: readonly A[]): A[] {
  return applications.filter((a) => isActiveStatus(a.status));
}

// ── Priority ────────────────────────────────────────────────────────────────

/** When an event happens or falls due, or null when nothing is fixed. */
export function eventMs(e: Pick<PlanEvent, "starts_at" | "due_at">): number | null {
  const at = Date.parse(e.starts_at ?? e.due_at ?? "");
  return Number.isFinite(at) ? at : null;
}

export function isDeadline(e: Pick<PlanEvent, "starts_at" | "due_at">): boolean {
  return !e.starts_at && !!e.due_at;
}

// A date-only deadline belongs to the day it was given in, wherever it is read: at
// 23:59 in its own zone, it must not read as the next day from further east.
export function displayZone(e: Pick<PlanEvent, "date_only" | "timezone">, tz: string): string {
  return e.date_only ? e.timezone ?? tz : tz;
}

const DEFAULT_MINUTES: Partial<Record<EventKind, number>> = { screening_call: 30, networking: 30, follow_up: 15 };

// A call with no stated end still takes time; deadlines take none.
export function eventEndMs(e: Pick<PlanEvent, "starts_at" | "ends_at" | "kind">): number | null {
  const start = Date.parse(e.starts_at ?? "");
  if (!Number.isFinite(start)) return null;
  const end = Date.parse(e.ends_at ?? "");
  return Number.isFinite(end) ? end : start + (DEFAULT_MINUTES[e.kind] ?? 60) * MINUTE_MS;
}

/** Offer > final interview > interview > assessment / take-home > screening > networking > follow-up. */
export function stageWeight(e: Pick<PlanEvent, "kind" | "stage_label">, applicationStatus?: string | null): number {
  if (e.kind === "offer_deadline" || normalizeStatus(applicationStatus) === "offer") return 100;
  if (e.kind === "interview") return /\bfinal\b/i.test(e.stage_label ?? "") ? 90 : 80;
  if (e.kind === "assessment" || e.kind === "take_home" || e.kind === "deadline") return 60;
  if (e.kind === "screening_call") return 40;
  if (e.kind === "networking") return 30;
  return 20;
}

export type Timing = { when: string; left: string; state: "upcoming" | "now" | "overdue" };

/**
 * The one description of when an event is, for the card, the hero, the screen
 * reader's line and the stage tabs: a call under way is happening now, a call that
 * has ended asks for its outcome, and a date with no time counts in days.
 */
export function describeTiming(e: PlanEvent, now: number, tz: string): Timing | null {
  const at = eventMs(e);
  if (at === null) return null;
  const zone = displayZone(e, tz);
  const when = formatWhen(at, zone, e.date_only);
  if (e.date_only) {
    const overdue = dayKey(at, zone) < dayKey(now, zone);
    return { when, left: countdown(at, now, { dateOnly: true, tz: zone }), state: overdue ? "overdue" : "upcoming" };
  }
  if (e.starts_at) {
    const end = eventEndMs(e) ?? at;
    if (at <= now && now <= end) return { when, left: "happening now", state: "now" };
    if (end < now) return { when, left: `ended ${span(now - end)} ago: ${e.application_id ? "set the outcome" : "mark it done"}`, state: "overdue" };
    return { when, left: countdown(at, now, { tz: zone }), state: "upcoming" };
  }
  return { when, left: countdown(at, now, { due: true, tz: zone }), state: at < now ? "overdue" : "upcoming" };
}

const OVERDUE_BASE = 5000;
const SOON_BASE = 3000;
// Just under anything in the next 24 hours: an unanswered slot offer loses the
// interview, but it does not outrank a call that is about to start.
const TO_BOOK_SCORE = 2900;

/** Higher comes first. Pure: the same event and clock always give the same score. */
export function priorityScore(e: PlanEvent, applicationStatus: string | null | undefined, now: number): number {
  const weight = stageWeight(e, applicationStatus);
  if (e.status === "to_book") return TO_BOOK_SCORE + weight / 10;
  const at = eventMs(e);
  if (at === null) return weight;
  const hours = (at - now) / (60 * MINUTE_MS);
  if (hours < 0) return OVERDUE_BASE + Math.min(-hours, 500) + weight;
  if (hours < 24) return SOON_BASE + (24 - hours) * 10 + weight;
  return Math.max(0, 2000 - hours) + weight;
}

// ── The plan ────────────────────────────────────────────────────────────────

export const PLAN_GROUPS = ["overdue", "today", "tomorrow", "this_week", "next_week", "later"] as const;
export type PlanGroupKey = (typeof PLAN_GROUPS)[number];
export const PLAN_GROUP_LABELS: Record<PlanGroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  next_week: "Next week",
  later: "Later",
};

export type PlanItem = { event: PlanEvent; application: PlanApplication | null; score: number; at: number | null };
// "contact": days since a recorded contact. "applied": none is recorded, so the
// count is from the date applied and must not be worded as contact.
export type WaitingItem = { application: PlanApplication; daysSinceContact: number | null; basis: "contact" | "applied"; nudge: 7 | 14 | 21 | null };
export type PlanSection = { key: PlanGroupKey | "needs_booking"; label: string; items: PlanItem[] };
export type Plan = {
  groups: { key: PlanGroupKey; label: string; items: PlanItem[] }[];
  needsBooking: PlanItem[];
  // What the page draws, top to bottom: an unanswered slot offer sits straight after
  // today, because it can lose the interview.
  sections: PlanSection[];
  // They spoke last, so the next move is the user's: never "waiting on them".
  replyOwed: WaitingItem[];
  waiting: WaitingItem[];
  nextUp: PlanItem | null;
  // Every item in the order the page draws it, and the keyboard walks it.
  ordered: PlanItem[];
};

function groupOf(e: PlanEvent, at: number, now: number, tz: string): PlanGroupKey {
  const zone = displayZone(e, tz);
  const today = dayKey(now, zone);
  const day = dayKey(at, zone);
  const overdue = e.date_only ? day < today : (e.starts_at ? eventEndMs(e) ?? at : at) < now;
  if (overdue) return "overdue";
  if (day <= today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  const nextMonday = addDays(mondayOf(today), 7);
  if (day < nextMonday) return "this_week";
  if (day < addDays(nextMonday, 7)) return "next_week";
  return "later";
}

/** Whole days since the last recorded contact, else since the date applied (see WaitingItem's basis). */
export function daysSinceContact(a: Pick<PlanApplication, "last_contact_at" | "date_applied">, now: number, tz: string): number | null {
  const stamp = a.last_contact_at ? Date.parse(a.last_contact_at) : Date.parse(`${a.date_applied ?? ""}T12:00:00Z`);
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, daysBetween(dayKey(stamp, tz), dayKey(now, tz)));
}

export function followUpNudge(days: number | null): 7 | 14 | 21 | null {
  if (days === null) return null;
  if (days >= 21) return 21;
  if (days >= 14) return 14;
  if (days >= 7) return 7;
  return null;
}

export function buildPlan(input: { events: readonly PlanEvent[]; applications: readonly PlanApplication[]; now: number; tz?: string }): Plan {
  const { events, applications, now } = input;
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  const byId = new Map(applications.map((a) => [a.id, a]));
  const live = activeEvents(events, applications);
  const items: PlanItem[] = live.map((event) => {
    const application = event.application_id ? byId.get(event.application_id) ?? null : null;
    return { event, application, score: priorityScore(event, application?.status, now), at: eventMs(event) };
  });
  const byScore = (a: PlanItem, b: PlanItem) => b.score - a.score || (a.at ?? 0) - (b.at ?? 0) || a.event.id.localeCompare(b.event.id);

  const buckets = new Map<PlanGroupKey, PlanItem[]>(PLAN_GROUPS.map((k) => [k, []]));
  const needsBooking: PlanItem[] = [];
  for (const item of items) {
    // A to_book event with a time still needs booking: the time is one offer.
    if (item.event.status === "to_book" || item.at === null) needsBooking.push(item);
    else buckets.get(groupOf(item.event, item.at, now, tz))!.push(item);
  }
  needsBooking.sort(byScore);
  for (const list of buckets.values()) list.sort(byScore);
  const groups = PLAN_GROUPS.map((key) => ({ key, label: PLAN_GROUP_LABELS[key], items: buckets.get(key)! })).filter((g) => g.items.length > 0);

  const busy = new Set(live.map((e) => e.application_id));
  const quiet = activeApplications(applications)
    .filter((a) => !busy.has(a.id))
    .map((application) => {
      const days = daysSinceContact(application, now, tz);
      return { application, daysSinceContact: days, basis: application.last_contact_at ? ("contact" as const) : ("applied" as const), nudge: followUpNudge(days) };
    })
    .sort((a, b) => (b.daysSinceContact ?? -1) - (a.daysSinceContact ?? -1) || a.application.company_name.localeCompare(b.application.company_name));

  const replyOwed = quiet.filter((w) => w.application.last_contact_from === "them").map((w) => ({ ...w, nudge: null }));
  const waiting = quiet.filter((w) => w.application.last_contact_from !== "them");

  const sections: PlanSection[] = [...groups];
  if (needsBooking.length > 0) {
    const after = Math.max(sections.findIndex((g) => g.key === "today"), sections.findIndex((g) => g.key === "overdue"));
    sections.splice(after + 1, 0, { key: "needs_booking", label: "Needs booking", items: needsBooking });
  }
  const ordered = sections.flatMap((s) => s.items);
  const nextUp = [...items].filter((i) => i.event.status === "scheduled" && i.at !== null && (eventEndMs(i.event) ?? i.at) >= now).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0] ?? null;
  return { groups, needsBooking, sections, replyOwed, waiting, nextUp, ordered };
}

// ── Conflicts ───────────────────────────────────────────────────────────────

export const CONFLICT_BUFFER_MINUTES = 30;
type Interval = { start: number; end: number };

/** A window's real interval on one day, in its own zone, so a weekly 09:00 stays 09:00 across a clock change. */
export function windowOnDay(w: AvailabilityWindow, day: string): Interval | null {
  if (w.date ? w.date !== day : w.weekday !== weekdayOf(day)) return null;
  const tz = w.timezone ?? DEFAULT_TIMEZONE;
  const start = zonedTimeToMs(day, w.start_time, tz);
  const end = zonedTimeToMs(day, w.end_time, tz);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

export type Conflict = {
  kind: "overlap" | "too_close" | "busy";
  a: PlanEvent;
  b?: PlanEvent;
  window?: AvailabilityWindow;
  // The minutes between them; 0 when they overlap.
  gapMinutes: number;
};

function gapBetween(a: Interval, b: Interval): number {
  return Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end)) / MINUTE_MS;
}

function intervalOf(e: PlanEvent): Interval | null {
  const start = Date.parse(e.starts_at ?? "");
  const end = eventEndMs(e);
  return Number.isFinite(start) && end !== null ? { start, end } : null;
}

function windowsTouching(interval: Interval, windows: readonly AvailabilityWindow[], kind: "free" | "busy", tz: string, bufferMs: number): { window: AvailabilityWindow; at: Interval }[] {
  const out: { window: AvailabilityWindow; at: Interval }[] = [];
  const first = dayKey(interval.start - bufferMs, tz);
  const last = dayKey(interval.end + bufferMs, tz);
  for (let day = addDays(first, -1); day <= addDays(last, 1); day = addDays(day, 1)) {
    for (const window of windows) {
      if (window.kind !== kind) continue;
      const at = windowOnDay(window, day);
      if (at && at.start < interval.end + bufferMs && interval.start < at.end + bufferMs) out.push({ window, at });
    }
  }
  return out;
}

/**
 * What clashes with an event: another event at the same time or inside the
 * 30-minute buffer, or a busy window (a shift, a lecture). Deadlines have no
 * time to clash. Booked slots only: a to_book event's times are offers.
 */
export function conflictsFor(event: PlanEvent, others: readonly PlanEvent[], windows: readonly AvailabilityWindow[], opts: { bufferMinutes?: number; tz?: string } = {}): Conflict[] {
  const interval = event.status === "to_book" ? null : intervalOf(event);
  if (!interval) return [];
  const bufferMs = (opts.bufferMinutes ?? CONFLICT_BUFFER_MINUTES) * MINUTE_MS;
  const out: Conflict[] = [];
  for (const other of others) {
    if (other.id === event.id || other.status !== "scheduled") continue;
    const at = intervalOf(other);
    if (!at) continue;
    if (at.start < interval.end + bufferMs && interval.start < at.end + bufferMs) {
      const gapMinutes = gapBetween(interval, at);
      const overlaps = at.start < interval.end && interval.start < at.end;
      out.push({ kind: overlaps ? "overlap" : "too_close", a: event, b: other, gapMinutes: overlaps ? 0 : gapMinutes });
    }
  }
  for (const { window, at } of windowsTouching(interval, windows, "busy", opts.tz ?? DEFAULT_TIMEZONE, bufferMs)) {
    out.push({ kind: "busy", a: event, window, gapMinutes: gapBetween(interval, at) });
  }
  return out;
}

/** Every clash on the plan, each pair once. */
export function findConflicts(events: readonly PlanEvent[], windows: readonly AvailabilityWindow[], opts: { bufferMinutes?: number; tz?: string } = {}): Conflict[] {
  const scheduled = events.filter((e) => e.status === "scheduled");
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const event of scheduled) {
    for (const c of conflictsFor(event, scheduled, windows, opts)) {
      const key = c.b ? [c.a.id, c.b.id].sort().join("|") : `${c.a.id}|w:${c.window?.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

// ── Booking helper ──────────────────────────────────────────────────────────

export const DEFAULT_FREE_START = "09:00";
export const DEFAULT_FREE_END = "17:30";

// endGiven: false when the employer offered a start only, so `end` is an assumption
// for the clash check and must not be stored as if they had said it.
export type SuggestedSlot = { start: number; end: number; offered: boolean; endGiven: boolean };

function subtract(intervals: Interval[], block: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of intervals) {
    if (block.end <= i.start || block.start >= i.end) { out.push(i); continue; }
    if (block.start > i.start) out.push({ start: i.start, end: block.start });
    if (block.end < i.end) out.push({ start: block.end, end: i.end });
  }
  return out;
}

/**
 * Up to `count` free times for a slot offer. When the employer offered slots,
 * only those that are free. Otherwise the user's free windows, minus busy
 * windows and booked events with the buffer around each; with no free windows at
 * all, weekdays 09:00 to 17:30, and `usedDefaultHours` says so. At most one
 * suggestion a day until every day has had one, so a reply offers real choice.
 */
export function suggestSlots(input: {
  windows: readonly AvailabilityWindow[];
  events: readonly PlanEvent[];
  now: number;
  tz?: string;
  days?: number;
  durationMinutes?: number;
  count?: number;
  bufferMinutes?: number;
  offered?: readonly Slot[];
}): { slots: SuggestedSlot[]; usedDefaultHours: boolean } {
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  const durationMs = (input.durationMinutes ?? 30) * MINUTE_MS;
  const bufferMs = (input.bufferMinutes ?? CONFLICT_BUFFER_MINUTES) * MINUTE_MS;
  const count = Math.min(Math.max(1, input.count ?? 5), 5);
  const busyWindows = input.windows.filter((w) => w.kind === "busy");
  const booked = input.events.filter((e) => e.status === "scheduled").map(intervalOf).filter((i): i is Interval => !!i);
  const blocked = (slot: Interval) =>
    booked.some((b) => b.start < slot.end + bufferMs && slot.start < b.end + bufferMs) ||
    windowsTouching(slot, busyWindows, "busy", tz, bufferMs).length > 0;

  if (input.offered && input.offered.length > 0) {
    const slots: SuggestedSlot[] = [];
    for (const offer of input.offered) {
      const start = Date.parse(offer.starts_at);
      if (!Number.isFinite(start) || start <= input.now) continue;
      const parsedEnd = Date.parse(offer.ends_at ?? "");
      const end = Number.isFinite(parsedEnd) ? parsedEnd : start + durationMs;
      if (!blocked({ start, end })) slots.push({ start, end, offered: true, endGiven: Number.isFinite(parsedEnd) });
    }
    return { slots: slots.sort((a, b) => a.start - b.start).slice(0, count), usedDefaultHours: false };
  }

  const today = dayKey(input.now, tz);
  const searchDays = Array.from({ length: input.days ?? 14 }, (_, i) => addDays(today, i));
  // A one-off free window that has passed says nothing about the days being offered.
  const freeWindows = input.windows.filter((w) => w.kind === "free" && searchDays.some((day) => windowOnDay(w, day)));
  const usedDefaultHours = freeWindows.length === 0;
  const free: { day: string; at: Interval }[] = [];
  for (const day of searchDays) {
    let open: Interval[] = [];
    if (usedDefaultHours) {
      if (weekdayOf(day) <= 5) open = [{ start: zonedTimeToMs(day, DEFAULT_FREE_START, tz), end: zonedTimeToMs(day, DEFAULT_FREE_END, tz) }];
    } else {
      open = freeWindows.map((w) => windowOnDay(w, day)).filter((x): x is Interval => !!x);
    }
    const blocks: Interval[] = [
      { start: 0, end: input.now + bufferMs },
      ...booked.map((b) => ({ start: b.start - bufferMs, end: b.end + bufferMs })),
      ...busyWindows.map((w) => windowOnDay(w, day)).filter((x): x is Interval => !!x).map((b) => ({ start: b.start - bufferMs, end: b.end + bufferMs })),
    ];
    for (const block of blocks) open = subtract(open, block);
    for (const at of open.filter((o) => o.end - o.start >= durationMs).sort((a, b) => a.start - b.start)) free.push({ day, at });
  }

  // Each day's first free stretch, then the next ones.
  const picked: typeof free = [];
  const usedDays = new Set<string>();
  for (const f of free) {
    if (picked.length < count && !usedDays.has(f.day)) { picked.push(f); usedDays.add(f.day); }
  }
  for (const f of free) {
    if (picked.length < count && !picked.includes(f)) picked.push(f);
  }
  return {
    slots: picked.sort((a, b) => a.at.start - b.at.start).map((f) => ({ start: f.at.start, end: f.at.end, offered: false, endGiven: true })),
    usedDefaultHours,
  };
}

/** A reply in British English the user can paste. Names each slot in full. */
export function bookingReply(slots: readonly SuggestedSlot[], tz: string = DEFAULT_TIMEZONE): string {
  if (slots.length === 0) return "";
  const zone = tz === DEFAULT_TIMEZONE ? "UK time" : tz;
  const describe = (s: SuggestedSlot) => {
    const day = longDay(dayKey(s.start, tz));
    return s.offered ? `${day} at ${clockTime(s.start, tz)}` : `${day} from ${clockTime(s.start, tz)} to ${clockTime(s.end, tz)}`;
  };
  if (slots.length === 1) return `Thank you for getting in touch. I'm available on ${describe(slots[0])} (${zone}). Please let me know if that suits you.\n\nKind regards,`;
  const lines = slots.map((s) => `- ${describe(s)}`).join("\n");
  return `Thank you for getting in touch. I'm available at any of these times (${zone}):\n\n${lines}\n\nPlease let me know which suits you best.\n\nKind regards,`;
}

/** A polite request for feedback after a rejection. No claims; the user sends it. */
export function feedbackRequest(company: string, role: string): string {
  const what = role ? `the ${role} role` : "the role";
  return `Thank you for letting me know about ${what}${company ? ` at ${company}` : ""}. If you have a moment, I would welcome any brief feedback on my application, so I can improve for future roles.\n\nKind regards,`;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export const FUNNEL_STEPS = ["applied", "screening", "interview", "assessment", "offer", "accepted"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const FUNNEL_LABELS: Record<FunnelStep | "rejected" | "ghosted", string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  accepted: "Won",
  rejected: "Rejected",
  ghosted: "Ghosted",
};
// A rate over fewer than this many says nothing (the tracker's ≥8-per-group rule).
export const FUNNEL_MIN_GROUP = 8;

export type FunnelNode = {
  key: FunnelStep;
  label: string;
  // Everyone who reached this step, past it or not.
  count: number;
  // Who is here now, and who ended here.
  here: number;
  rejected: number;
  ghosted: number;
  // Who has an outcome from this step: went further, or ended here.
  decided: number;
  // Of those decided, the share who went further; null under FUNNEL_MIN_GROUP
  // decided, or at the last step. Someone still here has not decided anything.
  furtherRate: number | null;
  tooFew: boolean;
};
export type FunnelLink = { from: FunnelStep; to: FunnelStep | "rejected" | "ghosted"; count: number };
export type Funnel = { nodes: FunnelNode[]; links: FunnelLink[]; rejected: number; ghosted: number; total: number; excluded: number };

type FunnelRow = Pick<PlanApplication, "status" | "stages_reached">;

// Interview and assessment come in either order, so they share a rank: a row keeps
// the order it went through them, and the map draws them side by side. Linking one to
// the other would invent a step, and could loop, which a Sankey cannot lay out.
const STEP_RANK: Record<FunnelStep, number> = { applied: 0, screening: 1, interview: 2, assessment: 2, offer: 3, accepted: 4 };

function pathOf(row: FunnelRow, status: Status): FunnelStep[] {
  const path: FunnelStep[] = ["applied"];
  const add = (s: Status | null) => {
    if (s && s in STEP_RANK && !path.includes(s as FunnelStep)) path.push(s as FunnelStep);
  };
  for (const s of row.stages_reached ?? []) add(normalizeStatus(s));
  add(status);
  return path.sort((a, b) => STEP_RANK[a] - STEP_RANK[b]);
}

/**
 * Applied → Screening → Interview → Assessment → Offer → Won, with who dropped
 * where. A row follows the stages it really reached (one can skip Screening).
 * Unsent and withdrawn rows are outside the funnel and counted as `excluded`.
 */
export function buildFunnel(rows: readonly FunnelRow[]): Funnel {
  const counts = new Map<FunnelStep, { count: number; here: number; rejected: number; ghosted: number; further: number }>(
    FUNNEL_STEPS.map((s) => [s, { count: 0, here: 0, rejected: 0, ghosted: 0, further: 0 }])
  );
  const links = new Map<string, FunnelLink>();
  const addLink = (from: FunnelStep, to: FunnelLink["to"]) => {
    const key = `${from}>${to}`;
    const link = links.get(key) ?? { from, to, count: 0 };
    link.count++;
    links.set(key, link);
  };
  let excluded = 0;
  let total = 0;
  let rejected = 0;
  let ghosted = 0;
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    if (!status || status === "saved" || status === "withdrawn") { excluded++; continue; }
    total++;
    const path = pathOf(row, status);
    path.forEach((step, i) => {
      const c = counts.get(step)!;
      c.count++;
      if (i < path.length - 1) c.further++;
      if (i === 0) return;
      let from = i - 1;
      while (STEP_RANK[path[from]] === STEP_RANK[step]) from--;
      addLink(path[from], step);
    });
    const last = counts.get(path[path.length - 1])!;
    if (status === "rejected") { last.rejected++; rejected++; addLink(path[path.length - 1], "rejected"); }
    else if (status === "ghosted") { last.ghosted++; ghosted++; addLink(path[path.length - 1], "ghosted"); }
    else counts.get(status as FunnelStep)!.here++;
  }
  const nodes: FunnelNode[] = FUNNEL_STEPS.map((key) => {
    const c = counts.get(key)!;
    const decided = c.further + c.rejected + c.ghosted;
    const tooFew = decided < FUNNEL_MIN_GROUP;
    return { key, label: FUNNEL_LABELS[key], count: c.count, here: c.here, rejected: c.rejected, ghosted: c.ghosted, decided, furtherRate: tooFew || key === "accepted" ? null : c.further / decided, tooFew };
  });
  return { nodes, links: [...links.values()], rejected, ghosted, total, excluded };
}

export type FunnelChartNode = { name: string; key: string; total: number };

/** A chart addresses a link by node index, and a zero link or an empty node breaks its layout. */
export function funnelChartData(funnel: Funnel): { nodes: FunnelChartNode[]; links: { source: number; target: number; value: number }[] } {
  const totals = new Map<string, number>();
  for (const n of funnel.nodes) totals.set(n.key, n.count);
  totals.set("rejected", funnel.rejected);
  totals.set("ghosted", funnel.ghosted);
  const links = funnel.links.filter((l) => l.count > 0);
  const used = [...totals.keys()].filter((key) => (totals.get(key) ?? 0) > 0 && links.some((l) => l.from === key || l.to === key));
  const index = new Map(used.map((key, i) => [key, i]));
  return {
    nodes: used.map((key) => ({ key, name: FUNNEL_LABELS[key as keyof typeof FUNNEL_LABELS], total: totals.get(key) ?? 0 })),
    links: links.map((l) => ({ source: index.get(l.from)!, target: index.get(l.to)!, value: l.count })),
  };
}

// ── Reading a request ───────────────────────────────────────────────────────

const MAX_TITLE = 200;
const MAX_STAGE = 100;
const MAX_LINK = 500;
const MAX_CONTACT = 200;
const MAX_PREP = 4000;
const MAX_SLOTS = 10;

function isoOrNull(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(ms).toISOString() : undefined;
}

function optionalText(body: Record<string, unknown>, key: string, max: number, out: Record<string, unknown>, label: string): string | null {
  if (!(key in body)) return null;
  const value = body[key];
  if (value !== null && typeof value !== "string") return `${label} must be text.`;
  const text = (value ?? "").toString().trim();
  if (text.length > max) return `${label} is too long (max ${max} characters).`;
  out[key] = text || null;
  return null;
}

/**
 * Validates an event from a request body into the columns to write. `partial`
 * for an update: only the keys sent are touched. user_id, source and the ids are
 * never read from here. A deadline with no time arrives as due_at plus date_only.
 */
export function readEventInput(body: Record<string, unknown>, partial: boolean): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {};
  if (!partial || "kind" in body) {
    if (!(EVENT_KINDS as readonly unknown[]).includes(body.kind)) return { error: "Pick a valid kind of event." };
    fields.kind = body.kind;
  }
  if (!partial || "title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "Give the event a title." };
    if (title.length > MAX_TITLE) return { error: `The title is too long (max ${MAX_TITLE} characters).` };
    fields.title = title;
  }
  if (!partial || "status" in body) {
    const status = body.status ?? "scheduled";
    if (!(EVENT_STATUSES as readonly unknown[]).includes(status)) return { error: "Pick a valid event status." };
    fields.status = status;
  }
  for (const key of ["starts_at", "ends_at", "due_at"] as const) {
    if (!(key in body)) continue;
    const value = isoOrNull(body[key]);
    if (value === undefined) return { error: `Enter a valid date and time for ${key.replace("_at", "").replace("_", " ")}.` };
    fields[key] = value;
  }
  if ("date_only" in body) fields.date_only = body.date_only === true;
  if ("timezone" in body) {
    if (!isValidTimeZone(body.timezone)) return { error: "Pick a valid time zone." };
    fields.timezone = body.timezone;
  }
  for (const [key, max, label] of [["stage_label", MAX_STAGE, "The stage"], ["location_or_link", MAX_LINK, "The link"], ["contact_name", MAX_CONTACT, "The contact"], ["prep_notes", MAX_PREP, "The prep notes"]] as const) {
    const problem = optionalText(body, key, max, fields, label);
    if (problem) return { error: problem };
  }
  if ("offered_slots" in body) {
    if (!Array.isArray(body.offered_slots) || body.offered_slots.length > MAX_SLOTS) return { error: `Offer up to ${MAX_SLOTS} slots.` };
    const slots: Slot[] = [];
    for (const raw of body.offered_slots as unknown[]) {
      const slot = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const start = isoOrNull(slot.starts_at);
      const end = isoOrNull(slot.ends_at ?? null);
      if (!start || end === undefined || (end && Date.parse(end) < Date.parse(start))) return { error: "Enter a valid date and time for each offered slot." };
      slots.push({ starts_at: start, ends_at: end });
    }
    fields.offered_slots = slots;
  }
  const starts = fields.starts_at as string | null | undefined;
  const ends = fields.ends_at as string | null | undefined;
  if (starts && ends && Date.parse(ends) < Date.parse(starts)) return { error: "The end time is before the start." };
  if (!partial && !starts && !fields.due_at && fields.status !== "to_book") return { error: "Give the event a date and time, or mark it as still to book." };
  return { fields };
}

/** Validates a free or busy window from a request body. */
export function readWindowInput(body: Record<string, unknown>): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {};
  if (body.kind !== "free" && body.kind !== "busy") return { error: "A window is free or busy." };
  fields.kind = body.kind;
  const hasDate = body.date !== undefined && body.date !== null && body.date !== "";
  const hasWeekday = body.weekday !== undefined && body.weekday !== null && body.weekday !== "";
  if (hasDate === hasWeekday) return { error: "Pick a date or a day of the week." };
  if (hasDate) {
    if (!isDayKey(body.date)) return { error: "Enter a valid date." };
    fields.date = body.date;
  } else {
    const weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: "Pick a valid day of the week." };
    fields.weekday = weekday;
  }
  if (!isClockTime(body.start_time) || !isClockTime(body.end_time)) return { error: "Enter a start and end time." };
  if (body.end_time <= body.start_time) return { error: "The end time must be after the start." };
  fields.start_time = body.start_time;
  fields.end_time = body.end_time;
  if ("timezone" in body) {
    if (!isValidTimeZone(body.timezone)) return { error: "Pick a valid time zone." };
    fields.timezone = body.timezone;
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length > 100) return { error: "The label is too long (max 100 characters)." };
  fields.label = label || null;
  return { fields };
}

// Days with a due or start time, for the calendar's dots.
export function eventDays(events: readonly PlanEvent[], tz: string = DEFAULT_TIMEZONE): Map<string, number> {
  const days = new Map<string, number>();
  for (const e of events) {
    const at = eventMs(e);
    if (at === null || e.status === "to_book") continue;
    const key = dayKey(at, displayZone(e, tz));
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  return days;
}

/**
 * For the stage tabs' columns: the next open event per application (the soonest ahead,
 * else the latest one past, which the plan still shows as overdue) and its earliest
 * open deadline, overdue included.
 */
export function nextEventByApplication(events: readonly PlanEvent[], now: number): Map<string, { next: PlanEvent | null; deadline: PlanEvent | null }> {
  const out = new Map<string, { next: PlanEvent | null; deadline: PlanEvent | null }>();
  const sorted = events
    .filter((e) => e.application_id && OPEN_EVENT.has(e.status))
    .sort((a, b) => (eventMs(a) ?? Infinity) - (eventMs(b) ?? Infinity));
  for (const e of sorted) {
    const entry = out.get(e.application_id!) ?? { next: null, deadline: null };
    const at = eventMs(e);
    const ahead = at === null || at >= now;
    const nextIsAhead = !!entry.next && (eventMs(entry.next) ?? Infinity) >= now;
    if (!nextIsAhead && (ahead || !entry.next || (eventMs(entry.next) ?? 0) <= (at ?? 0))) entry.next = e;
    if (!entry.deadline && e.due_at) entry.deadline = e;
    out.set(e.application_id!, entry);
  }
  return out;
}
