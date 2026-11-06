// What the Applications page shows and counts (4 Nov 2026, Chunk 13). Pure, so
// node:test can run it (tests/applicationStage).
//
// The stored status lags the work: SalesApe's take-home and QuantumLoopAI's test were
// both stored as Interview, so the Assessment tab said 0. So the page derives a stage: an
// open test on a row is what the row is waiting on. It is display only: the stored status
// is never rewritten here (the sweeps read and write it), and the row's menu offers the
// one-click update instead. An application that reached an offer or ended keeps its own
// stage, whatever is still open on it, so every row counts once and the tabs add up.
import { EVENT_KIND_LABELS, describeTiming, displayZone, eventMs, type EventKind, type PlanEvent } from "./plan.ts";
import { DEFAULT_TIMEZONE, HOUR_MS, addDays, dayKey, formatWhen, zonedTimeToMs } from "./planTime.ts";
import { referralAsks, type ReferralRow } from "./referrals.ts";
import { STATUS_LABELS, isFollowupDueThisWeek, missingAttachments, normalizeStatus, type RowFlagFields, type Status } from "./tracker.ts";

export type StageKey = Status | "take_home" | "video" | "work_trial";

export const STAGE_LABELS: Record<StageKey, string> = {
  ...STATUS_LABELS,
  take_home: "Take-home",
  video: "Video",
  work_trial: "Work trial",
};

// Which comes first when two tests fall due together, so a row always reads the same.
const TEST_KINDS: readonly string[] = ["take_home", "assessment", "video", "work_trial"];
const OPEN: ReadonlySet<string> = new Set(["scheduled", "to_book"]);
// A row at these stages can be overtaken by an open test. An offer or an ending cannot.
const OVERTAKEN: ReadonlySet<Status> = new Set<Status>(["saved", "applied", "screening", "interview", "assessment"]);

type StageEvent = Pick<PlanEvent, "kind" | "status" | "starts_at" | "due_at">;

/** The open test a row's stage comes from, if one has overtaken its stored status. */
export function stageEvent<E extends StageEvent>(status: unknown, events: readonly E[] = []): E | null {
  const stored = normalizeStatus(status) ?? "applied";
  if (!OVERTAKEN.has(stored)) return null;
  const tests = events
    .filter((e) => OPEN.has(e.status) && TEST_KINDS.includes(e.kind))
    .sort((a, b) => (eventMs(a) ?? Infinity) - (eventMs(b) ?? Infinity) || TEST_KINDS.indexOf(a.kind) - TEST_KINDS.indexOf(b.kind));
  return tests[0] ?? null;
}

/** The stage a row shows: its soonest open test, else its stored status. */
export function deriveStage(status: unknown, events: readonly StageEvent[] = []): StageKey {
  const stored = normalizeStatus(status) ?? "applied";
  const test = stageEvent(stored, events);
  return test ? (test.kind as StageKey) : stored;
}

// ── Tabs ────────────────────────────────────────────────────────────────────

export type TabKey = "to_submit" | "applied" | "screening" | "interview" | "assessment" | "offer" | "won" | "closed";
export const TAB_ORDER: readonly TabKey[] = ["to_submit", "applied", "screening", "interview", "assessment", "offer", "won", "closed"];
export const TAB_LABELS: Record<TabKey, string> = {
  to_submit: "To submit",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  won: "Won",
  closed: "Closed",
};
// These three are tabs only while they hold something.
const WHEN_FULL: ReadonlySet<TabKey> = new Set<TabKey>(["assessment", "offer", "won"]);

export function tabOfStage(stage: StageKey): TabKey {
  switch (stage) {
    case "saved": return "to_submit";
    case "applied": return "applied";
    case "screening": return "screening";
    case "interview": return "interview";
    case "assessment":
    case "take_home":
    case "video":
    case "work_trial": return "assessment";
    case "offer": return "offer";
    case "accepted": return "won";
    default: return "closed";
  }
}

type TabRow = { id: string; status: unknown };

export function eventsByApplication<E extends { application_id: string | null }>(events: readonly E[]): Map<string, E[]> {
  const out = new Map<string, E[]>();
  for (const e of events) {
    if (!e.application_id) continue;
    const list = out.get(e.application_id);
    if (list) list.push(e);
    else out.set(e.application_id, [e]);
  }
  return out;
}

export function tabCounts(rows: readonly TabRow[], byApp: ReadonlyMap<string, readonly StageEvent[]>): Record<TabKey, number> {
  const counts = Object.fromEntries(TAB_ORDER.map((t) => [t, 0])) as Record<TabKey, number>;
  for (const r of rows) counts[tabOfStage(deriveStage(r.status, byApp.get(r.id)))] += 1;
  return counts;
}

/** The tabs to draw: the five always, the rest only with something in them, and the one open now. */
export function visibleTabs(counts: Record<TabKey, number>, current?: TabKey | null): TabKey[] {
  return TAB_ORDER.filter((t) => !WHEN_FULL.has(t) || counts[t] > 0 || t === current);
}

/**
 * A row that has been through this tab, for "Include past stages". The history keeps endings, so
 * a row rejected and then reopened has one on record, and it is not Closed: that reads the status.
 */
export function reachedTab(stages: readonly string[] | null | undefined, tab: TabKey): boolean {
  if (tab === "closed") return false;
  return (stages ?? []).some((s) => {
    const stage = normalizeStatus(s);
    return !!stage && tabOfStage(stage) === tab;
  });
}

/** The status a new row starts at on this tab, or it would vanish from view on save. */
export function statusForNewRow(tab: TabKey | "all"): Status {
  switch (tab) {
    case "to_submit": return "saved";
    case "screening": return "screening";
    case "interview": return "interview";
    case "assessment": return "assessment";
    case "offer": return "offer";
    case "won": return "accepted";
    default: return "applied";
  }
}

/** The tab a page opens on: Interview when it holds anything, else the furthest stage that does. */
export function defaultTab(counts: Record<TabKey, number>): TabKey {
  for (const tab of ["interview", "assessment", "offer", "screening", "applied", "to_submit", "won", "closed"] as const) {
    if (counts[tab] > 0) return tab;
  }
  return "applied";
}

/** The tab a link's status opens: the pipeline links by status. */
export function tabForStatus(status: unknown): TabKey | null {
  const stored = normalizeStatus(status);
  return stored ? tabOfStage(stored) : null;
}

/**
 * Rows whose STORED status is this tab but which count elsewhere, because an open test
 * has overtaken them. The sheet's old numbers stay reachable: 3 here + this = the 8 stored.
 */
export function countedElsewhere(rows: readonly TabRow[], byApp: ReadonlyMap<string, readonly StageEvent[]>, tab: TabKey): number {
  return rows.filter((r) => {
    const stored = normalizeStatus(r.status);
    return !!stored && tabOfStage(stored) === tab && tabOfStage(deriveStage(stored, byApp.get(r.id))) !== tab;
  }).length;
}

/** The stored status a row could be moved to, to match what it shows; null when it already does. */
export function statusToMatch(status: unknown, stage: StageKey): Status | null {
  const stored = normalizeStatus(status);
  if (!stored || tabOfStage(stored) === tabOfStage(stage)) return null;
  return tabOfStage(stage) === "assessment" ? "assessment" : null;
}

// ── Next step ───────────────────────────────────────────────────────────────

export type Urgency = "red" | "amber" | "none";
const AMBER_WITHIN_MS = 72 * HOUR_MS;

/** The first instant after the end of tomorrow, where the user is. */
export function dueSoonCutoff(now: number, tz: string = DEFAULT_TIMEZONE): number {
  return zonedTimeToMs(addDays(dayKey(now, tz), 2), "00:00", tz);
}

export function isDueSoon(event: Pick<PlanEvent, "starts_at" | "due_at">, now: number, tz: string = DEFAULT_TIMEZONE): boolean {
  const at = eventMs(event);
  return at !== null && at < dueSoonCutoff(now, tz);
}

export function urgencyOf(event: Pick<PlanEvent, "starts_at" | "due_at">, now: number, tz: string = DEFAULT_TIMEZONE): Urgency {
  const at = eventMs(event);
  if (at === null) return "none";
  if (at < dueSoonCutoff(now, tz)) return "red";
  return at - now < AMBER_WITHIN_MS ? "amber" : "none";
}

export type NextStep = {
  event: PlanEvent;
  /** When, or null for an item with no date yet. */
  when: string | null;
  /** "Interview call · in 14h": what it is and how long is left. */
  line: string;
  /** The two halves of the line: a long name truncates, the time left never does. */
  name: string;
  left: string;
  urgency: Urgency;
  /** A separate deadline on the row, only when it says something the first line does not. */
  deadline: string | null;
};

const nameOf = (e: PlanEvent) => e.title.trim() || EVENT_KIND_LABELS[e.kind];

/**
 * What a row is waiting on: its earliest dated item, so something overdue is never hidden
 * behind a later one, and Mark done reaches it. Two items due together read as one
 * ("Criteria test + Hireflix"), and a deadline is printed only when it differs from the
 * time already shown.
 */
export function nextStepFor(events: readonly PlanEvent[], now: number, tz: string = DEFAULT_TIMEZONE): NextStep | null {
  const open = events.filter((e) => e.application_id && OPEN.has(e.status));
  if (open.length === 0) return null;
  const sorted = [...open].sort((a, b) => (eventMs(a) ?? Infinity) - (eventMs(b) ?? Infinity));
  const event = sorted[0];
  const at = eventMs(event);
  if (at === null) return { event, when: null, line: nameOf(event), name: nameOf(event), left: "", urgency: "none", deadline: null };
  const together = open.filter((e) => eventMs(e) === at);
  const name = together.map(nameOf).join(" + ");
  const timing = describeTiming(event, now, tz);
  const when = timing?.when ?? formatWhen(at, displayZone(event, tz), event.date_only);
  // A date-only deadline reads in its own zone: 9 Nov in New York is not 10 Nov in London.
  const other = sorted.find((e) => e.due_at && eventMs(e) !== at) ?? null;
  const otherAt = other ? eventMs(other) : null;
  const deadline = other && otherAt !== null ? formatWhen(otherAt, displayZone(other, tz), other.date_only) : null;
  const left = timing?.left ?? "";
  return { event, when, line: left ? `${name} · ${left}` : name, name, left, urgency: urgencyOf(event, now, tz), deadline: deadline === when ? null : deadline };
}

/** The tile beside the next step. Red is always the warning, so urgency is never colour alone. */
export function nextStepIcon(kind: EventKind, urgency: Urgency): "alert" | "users" | "phone" | "clipboard" | "video" | "clock" {
  if (urgency === "red") return "alert";
  if (kind === "interview" || kind === "networking") return "users";
  if (kind === "screening_call") return "phone";
  if (kind === "video") return "video";
  if (kind === "assessment" || kind === "take_home" || kind === "work_trial" || kind === "screening_questions") return "clipboard";
  return "clock";
}

// ── The one button on a row ─────────────────────────────────────────────────

export type PrimaryAction = { kind: "prep" } | { kind: "test" } | { kind: "record" } | { kind: "submit" };

export function primaryAction(stage: StageKey): PrimaryAction | null {
  if (stage === "interview") return { kind: "prep" };
  if (stage === "assessment" || stage === "take_home" || stage === "work_trial") return { kind: "test" };
  if (stage === "video") return { kind: "record" };
  if (stage === "saved") return { kind: "submit" };
  return null;
}

// ── The attention strip ─────────────────────────────────────────────────────

type AttentionRow = RowFlagFields & { id: string; followup_date: string | null; notes_not_submitted?: boolean };

export function isStatusToFix(row: Pick<AttentionRow, "status" | "notes_not_submitted">): boolean {
  return normalizeStatus(row.status) === "applied" && row.notes_not_submitted === true;
}

export function isDataToFix(row: AttentionRow): boolean {
  return isStatusToFix(row) || missingAttachments(row).length > 0;
}

export type AttentionCounts = { dueSoon: number; dueSoonRows: number; followups: number; statusToFix: number; attachmentsToFix: number; dataToFix: number };

export function attentionCounts(
  rows: readonly AttentionRow[],
  events: readonly (Pick<PlanEvent, "application_id" | "status" | "starts_at" | "due_at">)[],
  today: string,
  now: number,
  tz: string = DEFAULT_TIMEZONE
): AttentionCounts {
  const ids = new Set(rows.map((r) => r.id));
  // A networking call has no row to filter to; it stays on the Action Centre. Two items
  // due together on one row read as one in its Next step, so they count as one here.
  const soon = events.filter((e) => e.application_id && ids.has(e.application_id) && OPEN.has(e.status) && isDueSoon(e, now, tz));
  const dueSoon = new Set(soon.map((e) => `${e.application_id}|${eventMs(e)}`)).size;
  const statusToFix = rows.filter(isStatusToFix).length;
  const attachmentsToFix = rows.filter((r) => missingAttachments(r).length > 0).length;
  return {
    dueSoon,
    dueSoonRows: new Set(soon.map((e) => e.application_id)).size,
    // This week's (lib/tracker isFollowupDueThisWeek), never every date that has passed.
    followups: rows.filter((r) => isFollowupDueThisWeek({ followup_date: r.followup_date, status: r.status }, today)).length,
    statusToFix,
    attachmentsToFix,
    dataToFix: rows.filter(isDataToFix).length,
  };
}

// ── Referral and role lines ─────────────────────────────────────────────────

const REQ_RES = [
  /\breq(?:uisition)?(?:\s*id)?[\s:#.]*([A-Za-z]*\d{3,}[A-Za-z0-9-]*)/i,
  /\b((?:RQ|REF|JR|R)\d{3,}[A-Za-z0-9]*)\b/,
  /#(\d{3,})\b/,
  /\((\d{4,})\)/,
];

/** A requisition number the row names, in its own field or in the role's text. */
export function reqIdOf(row: { role: string; req_id?: string | null }): string | null {
  const own = row.req_id?.replace(/^#/, "").trim();
  if (own) return own;
  for (const re of REQ_RES) {
    const m = re.exec(row.role);
    if (m) return m[1];
  }
  return null;
}

/** The job title alone: what comes before the first comma, bracket or dash. */
export function shortRole(role: string): string {
  return role.split(/,|\s\(|\s[-–—]\s/)[0].trim() || role.trim();
}

/** Role line under the company: the Req ID is written once, wherever it was. */
export function roleLine(row: { role: string; req_id?: string | null }): string {
  const req = row.req_id?.replace(/^#/, "").trim();
  return req && !row.role.toLowerCase().includes(req.toLowerCase()) ? `${row.role} · Req ${req}` : row.role;
}

export type ReferralCard = { id: string; title: string; since: string; more: number };

export function referralCard(rows: readonly ReferralRow[]): ReferralCard | null {
  const asks = referralAsks(rows);
  if (asks.length === 0) return null;
  const oldest = asks[0];
  const req = reqIdOf(oldest);
  return { id: oldest.id, title: `${oldest.company_name} · ${shortRole(oldest.role)}${req ? ` (${req})` : ""}`, since: oldest.date_applied, more: asks.length - 1 };
}
