// Closing an application (4 Nov 2026, Chunk 15): the Screening page is the user's proof a CV
// got shortlisted, so a row that reached that far never leaves without their say. A sweep that
// detects a rejection records it as pending; only the user's own confirmation moves the row.
// Pure, so node:test can run it (tests/closing).
import { MIN_DECIDED } from "./insights.ts";
import { STATUS_LABELS, isSubmitted, normalizeStatus, type Status } from "./tracker.ts";

// ── The rule ────────────────────────────────────────────────────────────────

export const CONFIRMATION_MESSAGE = "Needs the user's confirmation; set pending_outcome instead.";

const ENDINGS: readonly Status[] = ["rejected", "withdrawn", "ghosted"];
const REACHED_SCREENING: readonly Status[] = ["screening", "assessment", "interview", "offer", "accepted"];
const REACHED_INTERVIEW: readonly Status[] = ["interview", "offer", "accepted"];

type StageFields = { status?: unknown; stages_reached?: readonly unknown[] | null };

function stagesOf(row: StageFields): Status[] {
  const stages = (row.stages_reached ?? []).map(normalizeStatus);
  const current = normalizeStatus(row.status);
  return [...stages, current].filter((s): s is Status => !!s);
}

export function isEnding(status: unknown): boolean {
  const s = normalizeStatus(status);
  return !!s && ENDINGS.includes(s);
}

export function reachedScreening(row: StageFields): boolean {
  return stagesOf(row).some((s) => REACHED_SCREENING.includes(s));
}

export function reachedInterview(row: StageFields): boolean {
  return stagesOf(row).some((s) => REACHED_INTERVIEW.includes(s));
}

/** A row that got shortlisted moves to an ending only on the user's own word. */
export function needsConfirmation(row: StageFields, nextStatus: unknown, confirmed: boolean): boolean {
  // Writing the status a row already has moves nothing: a sweep's notes update still lands.
  if (normalizeStatus(row.status) === normalizeStatus(nextStatus)) return false;
  return !confirmed && isEnding(nextStatus) && reachedScreening(row);
}

// ── How far it got ──────────────────────────────────────────────────────────

export type HighestStage = "screening" | "assessment" | "interview" | "offer";
const HIGHEST_ORDER: readonly HighestStage[] = ["screening", "assessment", "interview", "offer"];
export const HIGHEST_STAGE_LABELS: Record<HighestStage, string> = { screening: "Screening", assessment: "Assessment", interview: "Interview", offer: "Offer" };

/** The furthest it got: screening < assessment < interview < offer. Won counts as an offer. */
export function highestStage(row: StageFields): HighestStage | null {
  let at = -1;
  for (const s of stagesOf(row)) {
    const stage = s === "accepted" ? "offer" : s;
    at = Math.max(at, HIGHEST_ORDER.indexOf(stage as HighestStage));
  }
  return at < 0 ? null : HIGHEST_ORDER[at];
}

type ChipEvent = { kind: string; stage_label?: string | null };
const TEST_KINDS: ReadonlySet<string> = new Set(["assessment", "take_home", "work_trial", "screening_questions"]);

/** The chip on a closed row, more exact where an event says so: a video, a final round. */
export function progressChip(row: StageFields, events: readonly ChipEvent[] = []): string {
  const stage = highestStage(row);
  if (stage === "offer") return "Offer";
  if (stage === "interview") return events.some((e) => e.kind === "interview" && /\bfinal\b/i.test(e.stage_label ?? "")) ? "Final" : "Interview";
  if (stage === "assessment" || events.some((e) => e.kind === "video" || TEST_KINDS.has(e.kind))) {
    return events.some((e) => e.kind === "video") ? "Video" : "Test";
  }
  return "Screening call";
}

// ── A move to Closed ────────────────────────────────────────────────────────

export const CLOSE_REASONS = ["rejected", "withdrawn", "ghosted", "declined_by_me", "role_closed"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
  declined_by_me: "Declined by me",
  role_closed: "Role closed",
};
export const MAX_LESSON_CHARS = 140;
export const LESSON_PLACEHOLDER = "What stopped it? e.g. wanted 3+ yrs";

export function isCloseReason(value: unknown): value is CloseReason {
  return (CLOSE_REASONS as readonly unknown[]).includes(value);
}

/**
 * The status a reason stores. Declining an offer and a role that closed say nothing about how
 * the CV did, so they sit with Withdrawn, which the insights leave out of their rates.
 */
export function statusForReason(reason: CloseReason): Status {
  return reason === "rejected" || reason === "ghosted" ? reason : "withdrawn";
}

export function reasonForStatus(status: unknown): CloseReason {
  const s = normalizeStatus(status);
  return s === "rejected" || s === "ghosted" ? s : "withdrawn";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** A closing date as stored: midday UTC, so the day never shifts with where it is read. */
export function closedAtFromDate(date: string): string | null {
  return isRealDate(date) ? `${date}T12:00:00.000Z` : null;
}

// ── A detected outcome, not yet the user's word ─────────────────────────────

export type PendingOutcome = { outcome: Status; date: string; source: string; dismissed?: boolean };
const MAX_SOURCE_CHARS = 40;

/** A stored or sent value re-bounded: an ending, a real date, a short source. Anything else is no outcome. */
export function normalizePendingOutcome(value: unknown): PendingOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const outcome = normalizeStatus(o.outcome);
  if (!outcome || !ENDINGS.includes(outcome)) return null;
  if (typeof o.date !== "string" || !isRealDate(o.date)) return null;
  const source = typeof o.source === "string" ? o.source.trim().slice(0, MAX_SOURCE_CHARS) : "";
  return { outcome, date: o.date, source, ...(o.dismissed === true ? { dismissed: true } : {}) };
}

/** What the banner shows: dismissed means the user said it isn't true. */
export function activePending(value: unknown): PendingOutcome | null {
  const p = normalizePendingOutcome(value);
  return p && !p.dismissed ? p : null;
}

/**
 * What an automation's report does to what is stored. The same outcome the user already
 * dismissed stays dismissed, or every sweep would bring back what they said wasn't true.
 */
export function mergePendingOutcome(stored: unknown, incoming: PendingOutcome): { value: PendingOutcome; ignored: boolean } {
  const before = normalizePendingOutcome(stored);
  if (before?.dismissed && before.outcome === incoming.outcome && before.date === incoming.date) return { value: before, ignored: true };
  return { value: incoming, ignored: false };
}

const SOURCE_NAMES: Record<string, string> = { gmail: "Gmail", sweep: "a sweep", aiapply: "AIApply" };

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Rejected on 2 Nov (from Gmail)." */
export function pendingLine(p: PendingOutcome): string {
  const source = p.source ? ` (from ${SOURCE_NAMES[p.source.toLowerCase()] ?? p.source})` : "";
  return `${STATUS_LABELS[p.outcome]} on ${shortDate(p.date)}${source}.`;
}

// ── What the Closed section and the Wins table say ──────────────────────────

type ClosedFields = StageFields & { closed_at?: string | null; close_reason?: string | null };

export function isClosed(row: Pick<ClosedFields, "closed_at">): boolean {
  return !!row.closed_at;
}

/** "Rejected 2 Nov", "Withdrawn 21 Oct"; "Live" while the row is open. */
export function resultLine(row: ClosedFields): string {
  const ended = isEnding(row.status);
  if (!isClosed(row) && !ended) return "Live";
  const label = isCloseReason(row.close_reason) ? CLOSE_REASON_LABELS[row.close_reason] : STATUS_LABELS[normalizeStatus(row.status) ?? "rejected"];
  return row.closed_at ? `${label} ${shortDate(row.closed_at.slice(0, 10))}` : label;
}

// ── The one-off backfill ────────────────────────────────────────────────────

/** A row already ended that got shortlisted is Closed, dated when it last changed. Others: nothing. */
export function backfillPatch(row: ClosedFields & { updated_at?: string | null }): { closed_at: string; close_reason: CloseReason } | null {
  if (row.closed_at || !isEnding(row.status) || !reachedScreening(row) || !row.updated_at) return null;
  return { closed_at: row.updated_at, close_reason: reasonForStatus(row.status) };
}

// ── The summary line ────────────────────────────────────────────────────────

export type StageTab = "screening" | "interview";

/** n counts every row that ever got here, from all time and all statuses. */
export function stageSummary(rows: readonly ClosedFields[], tab: StageTab, live: number): { reached: number; live: number; closed: number; text: string } {
  const reached = rows.filter(tab === "screening" ? reachedScreening : reachedInterview);
  const closed = reached.filter(isClosed).length;
  const lead = tab === "screening" ? `Your CV reached screening ${reached.length} ${reached.length === 1 ? "time" : "times"}` : `Reached interview ${reached.length} ${reached.length === 1 ? "time" : "times"}`;
  return { reached: reached.length, live, closed, text: `${lead} · ${live} live · ${closed} closed` };
}

/** The Closed section: most recently closed first. */
export function closedRows<R extends ClosedFields>(rows: readonly R[], tab: StageTab): R[] {
  const reached = tab === "screening" ? reachedScreening : reachedInterview;
  return rows.filter((r) => isClosed(r) && reached(r)).sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
}

/** Live order: the next event due first, then a pending outcome, then the last update. */
export function liveOrder<R extends { pending_outcome?: unknown; updated_at?: string | null }>(a: R, b: R, nextEventMs: (row: R) => number): number {
  const an = nextEventMs(a);
  const bn = nextEventMs(b);
  if (an !== bn) return an - bn;
  const ap = activePending(a.pending_outcome) ? 0 : 1;
  const bp = activePending(b.pending_outcome) ? 0 : 1;
  return ap - bp || (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
}

// ── Wins ────────────────────────────────────────────────────────────────────

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export type FunnelStep = { key: "applied" | "screening" | "interview" | "offer"; label: string; count: number; fromPrevious: number | null };

/** Applied → Reached screening → Reached interview → Offer, by stages_reached, all time. */
export function winsFunnel(rows: readonly StageFields[]): FunnelStep[] {
  const submitted = rows.filter((r) => stagesOf(r).some((s) => s !== "saved"));
  const screening = rows.filter(reachedScreening);
  const interview = rows.filter(reachedInterview);
  const offer = rows.filter((r) => stagesOf(r).some((s) => s === "offer" || s === "accepted"));
  return [
    { key: "applied", label: "Applied", count: submitted.length, fromPrevious: null },
    { key: "screening", label: "Reached screening", count: screening.length, fromPrevious: pct(screening.length, submitted.length) },
    { key: "interview", label: "Reached interview", count: interview.length, fromPrevious: pct(interview.length, screening.length) },
    { key: "offer", label: "Offer", count: offer.length, fromPrevious: pct(offer.length, interview.length) },
  ];
}

type SourceFields = { source?: string | null; referral?: boolean | null; company_name?: string; role?: string | null };

/** A referral first, because it is the reason a row moved; then how the row was made. */
export function sourceOf(row: SourceFields): string {
  if (row.referral) return "Referral";
  if (/aiapply/i.test(`${row.company_name ?? ""} ${row.role ?? ""}`)) return "AIApply";
  return row.source === "tailored" ? "Tailored here" : "Added by hand";
}

export type Conversion = { label: string; submitted: number; reached: number; rate: number | null };

/**
 * Reached screening out of submitted, per group. A rate shows only once a group holds
 * MIN_DECIDED applications, the tracker's rule: "1 of 2" is a count, not a 50% that means anything.
 */
export function conversionBy<R extends StageFields>(rows: readonly R[], labelOf: (row: R) => string): Conversion[] {
  const groups = new Map<string, { submitted: number; reached: number }>();
  for (const row of rows) {
    if (!isSubmitted(normalizeStatus(row.status) ?? "applied")) continue;
    const label = labelOf(row);
    const g = groups.get(label) ?? { submitted: 0, reached: 0 };
    g.submitted += 1;
    if (reachedScreening(row)) g.reached += 1;
    groups.set(label, g);
  }
  return [...groups.entries()]
    .map(([label, g]) => ({ label, ...g, rate: g.submitted >= MIN_DECIDED ? pct(g.reached, g.submitted) : null }))
    .sort((a, b) => b.reached - a.reached || b.submitted - a.submitted || a.label.localeCompare(b.label));
}
