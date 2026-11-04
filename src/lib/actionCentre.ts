// The Action Centre's rules (4 Nov 2026, Chunk 12), pure so node:test can run them
// (tests/actionCentre). It lists what the user still has to do, which is wider than
// the plan: an assessment invite on a row still marked Applied is exactly the thing
// that gets missed, so only an application that has ended hides its events.
//
// Snoozing never moves the employer's date. It only takes a card out of the main
// list for a day, the real deadline stays printed on it, and it comes back by itself
// inside the last 24 hours, so a snooze can never carry a deadline past its date.
import { eventMs, type PlanEvent } from "./plan.ts";
import { DAY_MS, HOUR_MS } from "./planTime.ts";
import { normalizeStatus, type Status } from "./tracker.ts";

export const RED_WITHIN_MS = 24 * HOUR_MS;
export const AMBER_WITHIN_MS = 72 * HOUR_MS;
export const SNOOZE_MS = DAY_MS;

export type Urgency = "red" | "amber" | "green" | "none";

/** Always shown beside the colour, so the state is never colour alone. */
export const URGENCY_LABELS: Record<Urgency, string> = {
  red: "Under 24 hours",
  amber: "Under 3 days",
  green: "More than 3 days",
  none: "No date yet",
};

const ENDED: ReadonlySet<Status> = new Set<Status>(["rejected", "withdrawn", "ghosted", "accepted"]);
const OPEN: ReadonlySet<string> = new Set(["scheduled", "to_book"]);

type ActionEvent = Pick<PlanEvent, "starts_at" | "due_at"> & { snoozed_until?: string | null };

export function urgencyOf(event: Pick<PlanEvent, "starts_at" | "due_at">, now: number): Urgency {
  const at = eventMs(event);
  if (at === null) return "none";
  const left = at - now;
  if (left < RED_WITHIN_MS) return "red";
  return left < AMBER_WITHIN_MS ? "amber" : "green";
}

/**
 * What is still to do: an open event on an application that has not ended, or on
 * none (a networking call). A row deleted out from under its event is dropped.
 */
export function actionableEvents<E extends Pick<PlanEvent, "application_id" | "status">>(
  events: readonly E[],
  applications: readonly { id: string; status: string }[]
): E[] {
  const live = new Set(
    applications.filter((a) => {
      const status = normalizeStatus(a.status);
      return !status || !ENDED.has(status);
    }).map((a) => a.id)
  );
  return events.filter((e) => OPEN.has(e.status) && (e.application_id === null || live.has(e.application_id)));
}

export function isSnoozed(event: ActionEvent, now: number): boolean {
  const until = Date.parse(event.snoozed_until ?? "");
  return Number.isFinite(until) && until > now && urgencyOf(event, now) !== "red";
}

/** Until when a snooze runs, or null when this one may not be snoozed: it is due within 24 hours. */
export function snoozeUntil(event: Pick<PlanEvent, "starts_at" | "due_at">, now: number): number | null {
  return urgencyOf(event, now) === "red" ? null : now + SNOOZE_MS;
}

function byDeadline<E extends Pick<PlanEvent, "starts_at" | "due_at" | "title">>(a: E, b: E): number {
  const at = eventMs(a);
  const bt = eventMs(b);
  if (at === null && bt === null) return a.title.localeCompare(b.title);
  if (at === null) return 1;
  if (bt === null) return -1;
  return at - bt || a.title.localeCompare(b.title);
}

/** Deadline order, past ones first and undated last; snoozed cards in their own list. */
export function sortActions<E extends ActionEvent & Pick<PlanEvent, "title">>(events: readonly E[], now: number): { due: E[]; snoozed: E[] } {
  const sorted = [...events].sort(byDeadline);
  return { due: sorted.filter((e) => !isSnoozed(e, now)), snoozed: sorted.filter((e) => isSnoozed(e, now)) };
}

// ── Reading a pasted email ──────────────────────────────────────────────────

/** The kind a pasted email most plainly describes; the form lets the user change it. */
export function guessEventKind(text: string): "assessment" | "video" | "interview" | "work_trial" | "screening_questions" | "deadline" {
  if (/\bwork[- ]trial\b/i.test(text)) return "work_trial";
  if (/\bscreening questions?\b|\bquestionnaire\b/i.test(text)) return "screening_questions";
  if (/\bhireflix\b|\bhirevue\b|\bsonru\b|\bone[- ]way\b|\bvideo (?:interview|assessment)\b/i.test(text)) return "video";
  if (/\bhackerrank\b|\bcodility\b|\bcoderbyte\b|\bcodesignal\b|\bassessment\b|\bonline test\b|\bcoding test\b|\bcriteria\b/i.test(text)) return "assessment";
  if (/\binterview\b|\bscreening call\b|\bintro(?:ductory)? call\b/i.test(text)) return "interview";
  return "deadline";
}

const LINK_RE = /https?:\/\/[^\s<>()[\]{}"'“”]+/gi;
const NOT_THE_LINK = /unsubscribe|privacy|preferences|linkedin\.com\/(?:in|company)|facebook\.com|twitter\.com|instagram\.com/i;

/** The first address in a pasted email that is not its footer. */
export function firstLink(text: string): string | null {
  for (const m of text.matchAll(LINK_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (!NOT_THE_LINK.test(url)) return url;
  }
  return null;
}
