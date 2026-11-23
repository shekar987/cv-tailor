// Status fix (Chunk JH-1, 19 Nov 2026): suggest the right status for a row whose stored
// one looks wrong, from signals the app already holds — never a guess from the model.
//
// Two signals, in order: the notes saying the row was never sent (→ Ready to submit), and
// the stage history reaching further than the current status (→ the furthest stage
// reached). A row already at an ending, or one whose history matches its status, has no
// suggestion. The wizard offers one click per row and "Accept all high-confidence".
//
// Relative .ts imports only, so it runs under node:test (tests/statusFix).
import { STATUS_LABELS, normalizeStatus, notesSayNotSubmitted, type Status } from "./tracker.ts";

const STAGE_RANK: Record<string, number> = {
  saved: 0, applied: 1, screening: 2, assessment: 3, interview: 4, offer: 5, accepted: 6,
};
const ENDED: ReadonlySet<Status> = new Set<Status>(["rejected", "withdrawn", "ghosted", "accepted"]);

export type StatusFixRow = {
  id: string;
  status: unknown;
  notes_not_submitted?: boolean;
  notes?: string | null;
  stages_reached?: readonly string[] | null;
};

export type StatusSuggestion = {
  to: Status;
  reason: string;
  confidence: "high" | "low";
};

/** The furthest live stage the history reached, or null. Endings are not "further". */
function furthestReached(stages: readonly string[] | null | undefined): Status | null {
  let best: Status | null = null;
  let bestRank = -1;
  for (const raw of stages ?? []) {
    const s = normalizeStatus(raw);
    if (!s || ENDED.has(s)) continue;
    const rank = STAGE_RANK[s] ?? -1;
    if (rank > bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * The status this row probably should be at, or null when the stored one looks right.
 * A row at an ending is left alone (its outcome is a human decision). Highest-confidence
 * signal wins: "not submitted" notes on an Applied row, then a stage history that reached
 * further than the stored status.
 */
export function suggestStatus(row: StatusFixRow): StatusSuggestion | null {
  const status = normalizeStatus(row.status);
  if (!status || ENDED.has(status)) return null;

  // 1. The notes say it was never sent, but it is marked Applied.
  const saysNotSubmitted = row.notes_not_submitted === true || notesSayNotSubmitted(row.notes);
  if (status === "applied" && saysNotSubmitted) {
    return { to: "saved", reason: "Your notes say this was never submitted.", confidence: "high" };
  }

  // 2. The stage history reached further than the stored status.
  const furthest = furthestReached(row.stages_reached);
  if (furthest && (STAGE_RANK[furthest] ?? 0) > (STAGE_RANK[status] ?? 0)) {
    return { to: furthest, reason: `Stage history reached ${STATUS_LABELS[furthest]} but the row says ${STATUS_LABELS[status]}.`, confidence: "high" };
  }

  return null;
}

export type StatusFixSuggestion<T extends StatusFixRow> = { row: T; suggestion: StatusSuggestion };

/** Every row with a suggestion, its suggestion attached. */
export function statusFixes<T extends StatusFixRow>(rows: readonly T[]): StatusFixSuggestion<T>[] {
  const out: StatusFixSuggestion<T>[] = [];
  for (const row of rows) {
    const suggestion = suggestStatus(row);
    if (suggestion) out.push({ row, suggestion });
  }
  return out;
}

/** The ids "Accept all high-confidence" would move, grouped by target status for the bulk call. */
export function highConfidenceFixes<T extends StatusFixRow>(rows: readonly T[]): Map<Status, T[]> {
  const byTarget = new Map<Status, T[]>();
  for (const { row, suggestion } of statusFixes(rows)) {
    if (suggestion.confidence !== "high") continue;
    const list = byTarget.get(suggestion.to);
    if (list) list.push(row);
    else byTarget.set(suggestion.to, [row]);
  }
  return byTarget;
}
