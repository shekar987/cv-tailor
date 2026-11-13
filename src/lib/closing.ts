// Closing an application (4 Nov 2026, Chunk 15): the Screening page is the user's proof a CV
// got shortlisted, so a row that reached that far never leaves without their say. A sweep that
// detects a rejection records it as pending; only the user's own confirmation moves the row.
// Pure, so node:test can run it (tests/closing).
import { MIN_DECIDED } from "./insights.ts";
import { MAX_NOTES_CHARS } from "./limits.ts";
import { STATUS_LABELS, appendNoteLine, normalizeStatus, removeFollowupClearedNote, type Status } from "./tracker.ts";
import { formatDate } from "./formatDate.ts";

// ── The rule ────────────────────────────────────────────────────────────────

export const CONFIRMATION_MESSAGE = "Needs the user's confirmation; set pending_outcome instead.";
export const MOVE_BACK_MESSAGE = "Needs the user's confirmation: this row reached screening.";
export const PENDING_VIA_PATCH = "Record a detected outcome with PATCH /api/applications/{id}/pending-outcome.";
export const REOPEN_RECORDED = "This row is closed, so nothing was written. It now shows a banner asking the user whether to reopen it.";
export const MOVE_BACK_RECORDED = "Moving this row back needs the user's word, so nothing was written. It now shows a banner asking them.";
export const REPORT_DISMISSED = "The user already said this report is not about this row, so nothing was written.";
export const REPORT_HELD = "This row is already asking the user about a detected outcome, so nothing was written.";
export const UNDO_EXPIRED = "That can no longer be undone.";

const ENDINGS: readonly Status[] = ["rejected", "withdrawn", "ghosted"];
const REACHED_SCREENING: readonly Status[] = ["screening", "assessment", "interview", "offer", "accepted"];
const REACHED_INTERVIEW: readonly Status[] = ["interview", "offer", "accepted"];
const BELOW_SCREENING: readonly Status[] = ["saved", "applied"];
// Interview and assessment come in either order, so neither is behind the other.
const LIVE_RANK: Partial<Record<Status, number>> = { screening: 1, assessment: 2, interview: 2, offer: 3, accepted: 4 };

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

/**
 * A move below screening. The history keeps the proof either way (it is append-only), but where
 * a shortlisted row stands is still the user's to say. Ready to submit to Applied is the one step
 * forward down there: a row moved back that far can be submitted again.
 */
export function isMoveBack(row: StageFields, nextStatus: unknown): boolean {
  const next = normalizeStatus(nextStatus);
  const now = normalizeStatus(row.status);
  if (!next || !BELOW_SCREENING.includes(next) || now === next || now === "saved") return false;
  return reachedScreening(row);
}

/** A step back among the live stages: Interview to Screening. Where a row stands is the user's to say. */
export function isStepBack(row: { status?: unknown }, nextStatus: unknown): boolean {
  const now = normalizeStatus(row.status);
  const next = normalizeStatus(nextStatus);
  const from = now ? LIVE_RANK[now] : undefined;
  const to = next ? LIVE_RANK[next] : undefined;
  return !!from && !!to && to < from;
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

type ChipEvent = { kind: string; stage_label?: string | null; title?: string | null; status?: string | null };
const TEST_KINDS: ReadonlySet<string> = new Set(["assessment", "take_home", "work_trial"]);

/** The chip on a closed row, more exact where an event says so: a video, a final round. */
export function progressChip(row: StageFields, events: readonly ChipEvent[] = []): string {
  const stage = highestStage(row);
  // What was cancelled or never booked says nothing about how far the row got.
  const held = events.filter((e) => e.status !== "cancelled" && e.status !== "to_book");
  if (stage === "offer") return "Offer";
  if (stage === "interview") return held.some((e) => e.kind === "interview" && /\bfinal\b(?!\s+year)/i.test(`${e.stage_label ?? ""} ${e.title ?? ""}`)) ? "Final" : "Interview";
  if (stage === "assessment" || held.some((e) => e.kind === "video" || TEST_KINDS.has(e.kind))) {
    return held.some((e) => e.kind === "video") ? "Video" : "Test";
  }
  return "Screening call";
}

// ── A move to Closed ────────────────────────────────────────────────────────

export const CLOSE_REASONS = ["rejected", "withdrawn", "ghosted", "declined_by_me", "role_closed"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "No reply",
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

// "reopen" and "move_back" are questions: an automation saw activity on a closed row, or would
// step a live row back. Company-name matching can hit the wrong row (93 of the owner's company
// names repeat), so it asks instead. note is what the report said, the user's only way to judge
// the match. earlier is the answered ending the question took the place of, kept so answering it
// does not bring that report back.
export type PendingOutcome = { outcome: Status | "reopen" | "move_back"; date: string; source: string; status?: Status; dismissed?: boolean; note?: string; earlier?: PendingOutcome };
const MAX_SOURCE_CHARS = 40;
const MAX_REPORT_NOTE_CHARS = 240;

export function isQuestion(value: unknown): boolean {
  const outcome = (value as { outcome?: unknown } | null | undefined)?.outcome;
  return outcome === "reopen" || outcome === "move_back";
}

/** A stored or sent value re-bounded: an ending or a question, a real date, a short source. Anything else is no outcome. */
export function normalizePendingOutcome(value: unknown): PendingOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const question = isQuestion(o);
  const outcome = question ? (o.outcome as "reopen" | "move_back") : normalizeStatus(o.outcome);
  if (!outcome || (!question && !ENDINGS.includes(outcome as Status))) return null;
  if (typeof o.date !== "string" || !isRealDate(o.date)) return null;
  const source = typeof o.source === "string" ? o.source.trim().slice(0, MAX_SOURCE_CHARS) : "";
  const target = question ? normalizeStatus(o.status) : null;
  // A move back asks for somewhere to go: without a live stage it asks nothing.
  if (outcome === "move_back" && (!target || isEnding(target))) return null;
  const note = question && typeof o.note === "string" ? o.note.trim().slice(0, MAX_REPORT_NOTE_CHARS) : "";
  // One level, and an ending never reads further, so a value written by hand can't recurse.
  const earlier = question && !isQuestion(o.earlier) ? normalizePendingOutcome(o.earlier) : null;
  return {
    outcome,
    date: o.date,
    source,
    ...(target && !isEnding(target) ? { status: target } : {}),
    ...(o.dismissed === true ? { dismissed: true } : {}),
    ...(note ? { note } : {}),
    ...(earlier ? { earlier: { ...earlier, dismissed: true } } : {}),
  };
}

/** The lines a sweep's notes add to what is stored: what the banner quotes, since the row takes none of it. */
export function reportedNote(stored: string | null | undefined, sent: unknown): string | undefined {
  if (typeof sent !== "string") return undefined;
  const known = new Set((stored ?? "").split(/\r?\n/).map((l) => l.trim()));
  const fresh = sent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !known.has(l));
  return fresh.length ? fresh.join(" · ").slice(0, MAX_REPORT_NOTE_CHARS) : undefined;
}

/** What the banner shows: dismissed means the user said it isn't true. */
export function activePending(value: unknown): PendingOutcome | null {
  const p = normalizePendingOutcome(value);
  return p && !p.dismissed ? p : null;
}

const STAGE_ORDER: readonly Status[] = ["saved", "applied", "screening", "assessment", "interview", "offer", "accepted"];
const DAY_MS = 86_400_000;
/** How long "Not true" holds against a question, so a real invite later still reaches the user. */
export const REOPEN_QUIET_DAYS = 14;

// A question is dated by whenever the sweep ran, so it is the same report for a while, unless it
// reaches further than the one dismissed: further on for a reopen, further back for a move back.
// A report that names no stage matches any.
function isSameReport(before: PendingOutcome, incoming: PendingOutcome): boolean {
  if (before.outcome !== incoming.outcome) return false;
  if (!isQuestion(incoming)) return before.date === incoming.date;
  if (Date.parse(incoming.date) - Date.parse(before.date) >= REOPEN_QUIET_DAYS * DAY_MS) return false;
  if (!before.status || !incoming.status) return true;
  const from = STAGE_ORDER.indexOf(before.status);
  const to = STAGE_ORDER.indexOf(incoming.status);
  return incoming.outcome === "reopen" ? to <= from : to >= from;
}

/**
 * What an automation's report does to what is stored. The same outcome the user already
 * dismissed stays dismissed, or every sweep would bring back what they said wasn't true. A
 * question keeps the answered ending it replaces, and a repeat keeps the words of the report
 * before it (a reopen also the furthest stage either one named). A rejection still waiting on a live row
 * outranks a question about its stage, and the sweep will ask again once it is answered.
 */
export function mergePendingOutcome(stored: unknown, incoming: PendingOutcome): { value: PendingOutcome; ignored: boolean } {
  const before = normalizePendingOutcome(stored);
  if (before?.dismissed && isSameReport(before, incoming)) return { value: before, ignored: true };
  if (before?.earlier && isSameReport(before.earlier, incoming)) return { value: before, ignored: true };
  if (!isQuestion(incoming) || !before) return { value: incoming, ignored: false };
  const asked = isQuestion(before);
  if (incoming.outcome === "move_back" && !asked && !before.dismissed) return { value: before, ignored: true };
  const earlier = asked ? before.earlier : { ...before, dismissed: true };
  const open = asked && !before.dismissed;
  const note = incoming.note ?? (open ? before.note : undefined);
  const higher = incoming.outcome === "reopen" && open && before.status && (!incoming.status || STAGE_ORDER.indexOf(incoming.status) < STAGE_ORDER.indexOf(before.status)) ? before.status : incoming.status;
  return { value: { ...incoming, ...(higher ? { status: higher } : {}), ...(note ? { note } : {}), ...(earlier ? { earlier } : {}) }, ignored: false };
}

/**
 * Whether "Not true" still answers what is stored. A sweep may have replaced what the page was
 * showing, and dismissing that unseen would bury a real rejection. A request naming nothing matches.
 */
export function dismissalMatches(stored: PendingOutcome, seen: { outcome?: unknown; date?: unknown }): boolean {
  if (!seen.outcome) return true;
  return seen.outcome === stored.outcome && (isQuestion(stored) || seen.date === stored.date);
}

/** "Not true". On a question the quiet window starts now: its date is only whenever the sweep last ran. */
export function dismissPending(stored: PendingOutcome, today: string): PendingOutcome {
  return { ...stored, dismissed: true, ...(isQuestion(stored) ? { date: today } : {}) };
}

const SOURCE_NAMES: Record<string, string> = { gmail: "Gmail", sweep: "a sweep", aiapply: "AIApply" };

function shortDate(date: string): string {
  return formatDate(date, { year: false });
}

/** "Rejected on 2 Nov (from Gmail)."; "New activity from Shell — Reopen?"; "New activity from Shell — Move back to Screening?" */
export function pendingLine(p: PendingOutcome, company = ""): string {
  if (p.outcome === "reopen") return `New activity from ${company} — Reopen?`;
  if (p.outcome === "move_back") return `New activity from ${company} — Move back to ${STATUS_LABELS[p.status as Status]}?`;
  const source = p.source ? ` (from ${SOURCE_NAMES[p.source.toLowerCase()] ?? p.source})` : "";
  return `${STATUS_LABELS[p.outcome]} on ${shortDate(p.date)}${source}.`;
}

/** The banner a row shows: an ending or a move back asks a live row, a reopen asks a closed one, and none asks the other. */
export function pendingBanner(row: { status?: unknown; closed_at?: string | null; pending_outcome?: unknown }): { kind: "close" | "reopen" | "move_back"; pending: PendingOutcome } | null {
  const pending = activePending(row.pending_outcome);
  if (!pending) return null;
  const closed = isClosed(row);
  if (pending.outcome === "reopen") return closed ? { kind: "reopen", pending } : null;
  if (pending.outcome === "move_back") return !closed && isStepBack(row, pending.status) ? { kind: "move_back", pending } : null;
  return closed ? null : { kind: "close", pending };
}

/** A row a sweep's question is waiting on. */
export function isAsking(row: { status?: unknown; closed_at?: string | null; pending_outcome?: unknown }): boolean {
  const kind = pendingBanner(row)?.kind;
  return kind === "reopen" || kind === "move_back";
}

/** Whether answering this question takes the report's words onto the row: only by doing what it asked. */
export function reportTaken(asked: PendingOutcome, status: unknown): boolean {
  return asked.outcome === "reopen" || (asked.outcome === "move_back" && normalizeStatus(status) === asked.status);
}

// ── Removing a stage picked by mistake ──────────────────────────────────────

const REMOVABLE: readonly Status[] = REACHED_SCREENING;

/** What a row's menu offers: a stage that counts, on its record, that it doesn't stand at now. */
export function removableStages(row: StageFields): Status[] {
  const now = normalizeStatus(row.status);
  const held = new Set((row.stages_reached ?? []).map(normalizeStatus));
  return REMOVABLE.filter((s) => s !== now && held.has(s));
}

export function removeStageLabel(stage: Status): string {
  return `Remove ${STATUS_LABELS[stage]}: picked by mistake`;
}

/** The dated line the row keeps, so a count never changes without saying why. */
export function removedStageNote(stage: Status, now: Date): string {
  const day = formatDate(now, { year: false });
  return `Removed '${stage}' on ${day} — picked by mistake`;
}

/** Where a Reopen lands: the stage the report asked for, unless the row already got further. */
export function reopenTarget(row: StageFields & { pending_outcome?: unknown }): Status {
  const pending = activePending(row.pending_outcome);
  const asked = pending?.outcome === "reopen" ? pending.status : undefined;
  const furthest = highestStage(row);
  if (!asked) return furthest ?? "applied";
  if (!furthest) return asked;
  return HIGHEST_ORDER.indexOf(asked === "accepted" ? "offer" : (asked as HighestStage)) >= HIGHEST_ORDER.indexOf(furthest) ? asked : furthest;
}

// ── What the Closed section and the Wins table say ──────────────────────────

type ClosedFields = StageFields & { closed_at?: string | null; close_reason?: string | null };

/** Closed by the dialog, or ended some other way: either way it is proof, and belongs in Closed. */
export function isClosed(row: { closed_at?: string | null; status?: unknown }): boolean {
  return !!row.closed_at || isEnding(row.status);
}

/** "Rejected 2 Nov", "Withdrawn 21 Oct"; "Live" while the row is open. */
export function resultLine(row: ClosedFields): string {
  const ended = isEnding(row.status);
  if (!isClosed(row) && !ended) return "Live";
  const label = isCloseReason(row.close_reason) ? CLOSE_REASON_LABELS[row.close_reason] : STATUS_LABELS[normalizeStatus(row.status) ?? "rejected"];
  return row.closed_at ? `${label} ${shortDate(row.closed_at.slice(0, 10))}` : label;
}

// ── What a write may do ─────────────────────────────────────────────────────

export type UndoSnapshot = {
  status: Status;
  closed_at: string | null;
  close_reason: CloseReason | null;
  lesson: string | null;
  pending_outcome: PendingOutcome | null;
  followup_date: string | null;
  at: string;
  // The stamped line this close put in the notes ("Log outcome", Chunk 26): Undo takes it back
  // with the close, or a rejection logged on the wrong row would stay in that row's notes.
  note?: string;
};
// A stamped appended note: its 17-character stamp and a space, then at most 500 characters.
const MAX_UNDO_NOTE_CHARS = 600;
export type ClosingWrite = { status?: Status; closed_at?: string | null; close_reason?: CloseReason | null; lesson?: string | null; pending_outcome?: PendingOutcome | null; undo_snapshot?: UndoSnapshot | null; notes?: string | null };
export type ClosingCurrent = StageFields & { pending_outcome?: unknown; closed_at?: string | null; close_reason?: unknown; lesson?: string | null; followup_date?: string | null; notes?: string | null };
export type ClosingRefusal = { status: 400 | 409; error: string; errorType?: "needs_confirmation" | "needs_move_back_confirmation" };

/** The toast's ten seconds, and a little for the click to arrive. */
export const UNDO_WINDOW_MS = 10_000;
const UNDO_GRACE_MS = 5_000;

export function normalizeUndoSnapshot(value: unknown): UndoSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const status = normalizeStatus(o.status);
  if (!status || typeof o.at !== "string") return null;
  return {
    status,
    closed_at: typeof o.closed_at === "string" ? o.closed_at : null,
    close_reason: isCloseReason(o.close_reason) ? o.close_reason : null,
    lesson: typeof o.lesson === "string" ? o.lesson : null,
    pending_outcome: normalizePendingOutcome(o.pending_outcome),
    followup_date: typeof o.followup_date === "string" ? o.followup_date : null,
    at: o.at,
    ...(typeof o.note === "string" && o.note.trim() && o.note.length <= MAX_UNDO_NOTE_CHARS && !/[\r\n]/.test(o.note) ? { note: o.note } : {}),
  };
}

/** Takes one whole line out of the notes, the first that is exactly it. Every other line stays as it is. */
function removeNoteLine(notes: string | null | undefined, line: string): string | null {
  const lines = (notes ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === line.trim());
  if (at < 0) return notes ?? null;
  lines.splice(at, 1);
  return lines.join("\n").trimEnd() || null;
}

export function undoIsLive(snapshot: UndoSnapshot, nowMs: number): boolean {
  const at = Date.parse(snapshot.at);
  return Number.isFinite(at) && nowMs - at <= UNDO_WINDOW_MS + UNDO_GRACE_MS;
}

/** What an Undo writes. The history stays as it is: the row just stands where it stood. */
export function undoWrite(snapshot: UndoSnapshot, current: { followup_date?: string | null; notes?: string | null }) {
  const followupBack = !!snapshot.followup_date && !current.followup_date;
  let notes = current.notes ?? null;
  if (followupBack) notes = removeFollowupClearedNote(notes, snapshot.followup_date as string) || null;
  // The line the close itself added goes with it; a line the notes no longer hold changes nothing.
  const noteBack = !!snapshot.note && removeNoteLine(notes, snapshot.note) !== notes;
  if (noteBack) notes = removeNoteLine(notes, snapshot.note as string);
  return {
    status: snapshot.status,
    closed_at: snapshot.closed_at,
    close_reason: snapshot.close_reason,
    lesson: snapshot.lesson,
    pending_outcome: snapshot.pending_outcome,
    undo_snapshot: null,
    ...(followupBack ? { followup_date: snapshot.followup_date } : {}),
    ...(followupBack || noteBack ? { notes } : {}),
  };
}

/**
 * Every rule PUT /api/applications holds a closing write to, in one place, before anything is
 * written. Only an ending, on the user's word, may set closed_at; a detected outcome goes through
 * its own route. An open status on a closed row, or a step back on a live one, without the user's
 * word, moves nothing: it comes back as a question for the banner to ask. A close keeps what it took as dismissed,
 * so a sweep reporting the same email after a Reopen does not bring it back, and it leaves a
 * snapshot for Undo to restore from.
 */
export function decideClosingWrite<W extends ClosingWrite>(
  current: ClosingCurrent | null,
  write: W,
  flags: { confirmed: boolean; confirmedMoveBack: boolean; confirmedReopen: boolean },
  now: string
): { refuse: ClosingRefusal } | { fields: W } | { ask: PendingOutcome } {
  const fields: W = { ...write };
  const { status } = fields;
  if (("closed_at" in fields || "close_reason" in fields) && status === undefined) return { refuse: { status: 400, error: "A close needs a status." } };
  if ((fields.closed_at != null || fields.close_reason != null) && !(flags.confirmed && isEnding(status))) {
    return { refuse: { status: 409, error: CONFIRMATION_MESSAGE, errorType: "needs_confirmation" } };
  }
  if (("closed_at" in fields || "close_reason" in fields) && isEnding(status) && !flags.confirmed) {
    return { refuse: { status: 409, error: CONFIRMATION_MESSAGE, errorType: "needs_confirmation" } };
  }
  if (fields.pending_outcome != null) return { refuse: { status: 400, error: PENDING_VIA_PATCH } };
  // Clearing it is not a client's to do either: a null from a stale page would erase a rejection
  // it never saw. A close, an answer and the outcome route are what change it.
  delete fields.pending_outcome;
  if (status === undefined) return { fields };
  if (isEnding(status)) {
    if (needsConfirmation(current ?? {}, status, flags.confirmed)) return { refuse: { status: 409, error: CONFIRMATION_MESSAGE, errorType: "needs_confirmation" } };
    if (flags.confirmed) {
      const stored = normalizePendingOutcome(current?.pending_outcome);
      fields.closed_at ??= now;
      fields.close_reason ??= reasonForStatus(status);
      fields.pending_outcome = stored ? dismissPending(stored, now.slice(0, 10)) : null;
      fields.undo_snapshot = {
        status: normalizeStatus(current?.status) ?? "applied",
        closed_at: current?.closed_at ?? null,
        close_reason: isCloseReason(current?.close_reason) ? current.close_reason : null,
        lesson: current?.lesson ?? null,
        pending_outcome: stored,
        followup_date: current?.followup_date ?? null,
        at: now,
      };
    }
    return { fields };
  }
  const ask = (outcome: "reopen" | "move_back"): { ask: PendingOutcome } => {
    const note = reportedNote(current?.notes, fields.notes);
    return { ask: { outcome, date: now.slice(0, 10), source: "sweep", status, ...(note ? { note } : {}) } };
  };
  if (current && isClosed(current) && !flags.confirmedReopen) return ask("reopen");
  if (isMoveBack(current ?? {}, status) && !flags.confirmedMoveBack) return { refuse: { status: 409, error: MOVE_BACK_MESSAGE, errorType: "needs_move_back_confirmation" } };
  if (current && isStepBack(current, status) && !flags.confirmedMoveBack) return ask("move_back");
  fields.closed_at ??= null;
  fields.close_reason ??= null;
  // The question is answered: a reopen by getting here, an open move back once the row really
  // moves, since a sweep's rewrite of the same status says nothing. If it did what was asked, the
  // row takes what the report said. A dismissal stays as memory, or the same report would raise
  // its banner again.
  const asked = normalizePendingOutcome(current?.pending_outcome);
  if (asked && (asked.outcome === "reopen" || (asked.outcome === "move_back" && !asked.dismissed && normalizeStatus(current?.status) !== status))) {
    fields.pending_outcome = asked.earlier ?? null;
    if (reportTaken(asked, status) && asked.note && !asked.dismissed && fields.notes === undefined) {
      const notes = appendNoteLine(current?.notes, asked.note);
      if (notes.length <= MAX_NOTES_CHARS) fields.notes = notes;
    }
  }
  return { fields };
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
export function liveOrder<R extends { pending_outcome?: unknown; updated_at?: string | null; updated_minute?: number | null }>(a: R, b: R, nextEventMs: (row: R) => number): number {
  const an = nextEventMs(a);
  const bn = nextEventMs(b);
  if (an !== bn) return an - bn;
  const ap = activePending(a.pending_outcome) ? 0 : 1;
  const bp = activePending(b.pending_outcome) ? 0 : 1;
  return ap - bp || lastUpdate(b) - lastUpdate(a);
}

// The list gives whole minutes (lib/applicationRows); a full row its updated_at.
function lastUpdate(row: { updated_at?: string | null; updated_minute?: number | null }): number {
  if (typeof row.updated_minute === "number") return row.updated_minute;
  const ms = row.updated_at ? Date.parse(row.updated_at) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 60_000) : 0;
}

// ── Wins ────────────────────────────────────────────────────────────────────

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export type FunnelStep = { key: "applied" | "screening" | "interview" | "offer"; label: string; count: number; fromPrevious: number | null };

// An unsent row with an undone Submit in its history is still unsent; one that got shortlisted
// and was moved back to Ready to submit never stops counting.
function isApplication(row: StageFields): boolean {
  return normalizeStatus(row.status) !== "saved" || reachedScreening(row);
}

/** Applied → Reached screening → Reached interview → Offer, by stages_reached, all time. */
export function winsFunnel(rows: readonly StageFields[]): FunnelStep[] {
  const submitted = rows.filter(isApplication);
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
  return row.source === "tailored" ? "Tailored here" : row.source === "cold-email" ? "Cold email" : "Added by hand";
}

export type Conversion = { label: string; submitted: number; reached: number; rate: number | null };

/**
 * Reached screening out of submitted, per group. A rate shows only once a group holds
 * MIN_DECIDED applications, the tracker's rule: "1 of 2" is a count, not a 50% that means anything.
 */
export function conversionBy<R extends StageFields>(rows: readonly R[], labelOf: (row: R) => string): Conversion[] {
  const groups = new Map<string, { submitted: number; reached: number }>();
  for (const row of rows) {
    if (!isApplication(row)) continue;
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
