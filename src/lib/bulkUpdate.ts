// POST /api/applications/bulk (12 Nov 2026, Chunk 23): one call for many rows. On 12 Nov
// the morning sweep moved 15 follow-ups with 15 GET + PUT pairs, to set a new follow-up
// date and add "Follow-up sent". The body:
//
//   { ids: [...], followup_date?: "YYYY-MM-DD" | null, status?: "Applied" | …, append_line?: "…" }
//
// Each id is then written by the tracker's own PUT, one at a time, with exactly
// { id, followup_date, status, append_note: append_line }: every rule a single PUT holds
// holds here (a screened row is never ended without the user, an ended row never reopened,
// the date rule, the follow-up cleared on an ending, the stamped append and its
// ten-minute repeat rule). Nothing new is decided per row; this file only reads the body
// and shapes the answer.
//
// Relative .ts imports only, so it runs under node:test.
import { isIsoDate } from "./applicationFields.ts";
import { cleanNoteLine } from "./notesWrite.ts";
import { apiStatus, normalizeStatus } from "./tracker.ts";

export const MAX_BULK_IDS = 100;
// Rows written at once: each PUT is a few short queries, and the database is next door.
export const BULK_CONCURRENCY = 5;
const KEYS = new Set(["ids", "followup_date", "status", "append_line"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BulkPatch = { followup_date?: string | null; status?: string; append_note?: string };
export type BulkRequest = { ids: string[]; patch: BulkPatch; repeatedIds: number };

/** The body read and checked once, before any row is touched. */
export function readBulkBody(body: Record<string, unknown>): BulkRequest | { error: string } {
  // A typo is never a silently empty field (as /log).
  const unknown = Object.keys(body).find((k) => !KEYS.has(k));
  if (unknown) {
    const hint = unknown === "append_note" || unknown === "notes" ? ' Send the line as "append_line".' : "";
    return { error: `Unknown field "${unknown.slice(0, 40)}". A bulk update takes ids, followup_date, status and append_line.${hint}` };
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) return { error: "ids must be a list of application ids." };
  if (body.ids.length > MAX_BULK_IDS) return { error: `At most ${MAX_BULK_IDS} ids in one call.` };
  const bad = body.ids.find((id) => typeof id !== "string" || !UUID_RE.test(id));
  if (bad !== undefined) return { error: `"${String(bad).slice(0, 40)}" is not an application id.` };
  const ids = [...new Set((body.ids as string[]).map((id) => id.toLowerCase()))];

  const patch: BulkPatch = {};
  if ("followup_date" in body) {
    const d = body.followup_date;
    if (d === null || d === "") patch.followup_date = null;
    else if (isIsoDate(d)) patch.followup_date = d;
    else return { error: "followup_date must be a date (YYYY-MM-DD), or null to clear it." };
  }
  if ("status" in body) {
    const status = normalizeStatus(body.status);
    if (!status) return { error: `Unknown status "${String(body.status).slice(0, 40)}".` };
    patch.status = apiStatus(status);
  }
  if ("append_line" in body) {
    const cleaned = cleanNoteLine(body.append_line);
    if ("error" in cleaned) return { error: cleaned.error.replace("append_note", "append_line") };
    patch.append_note = cleaned.line;
  }
  if (Object.keys(patch).length === 0) return { error: "Send at least one of followup_date, status or append_line." };
  return { ids, patch, repeatedIds: body.ids.length - ids.length };
}

/** What one row's PUT body is. */
export function itemBody(id: string, patch: BulkPatch): Record<string, unknown> {
  return { id, ...patch };
}

export type BulkItem = {
  id: string;
  ok: boolean;
  /** The single PUT's HTTP status for this row: 200, 202 (held as a question), 400, 404, 409 … (named `code`, never `status`, which on a row is its stage). */
  code: number;
  updated_at: string | null;
  error?: string;
  errorType?: string;
  message?: string;
  skipped?: string;
  date_applied?: string;
  followupCleared?: true;
  pendingOutcomeUrl?: string;
  warning?: string;
};

/**
 * One row's answer from its PUT. ok only when the write landed (a 202 recorded a
 * question and changed nothing). The row's notes are never echoed: a bulk answer is kept
 * a day under an Idempotency-Key.
 */
export function bulkItem(id: string, code: number, body: unknown): BulkItem {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof b[k] === "string" && b[k] ? { [k]: (b[k] as string).slice(0, 600) } : {});
  return {
    id,
    ok: code === 200 && b.ok === true && b.applied !== false,
    code,
    updated_at: typeof b.updated_at === "string" ? b.updated_at : null,
    ...text("error"),
    ...text("errorType"),
    ...text("message"),
    ...text("skipped"),
    ...text("date_applied"),
    ...text("pendingOutcomeUrl"),
    ...text("warning"),
    ...(b.followupCleared ? { followupCleared: true as const } : {}),
  };
}

export type BulkAnswer = { ok: boolean; updated: number; failed: number; repeatedIds?: number; results: BulkItem[] };

export function bulkAnswer(results: BulkItem[], repeatedIds: number): BulkAnswer {
  const updated = results.filter((r) => r.ok).length;
  return { ok: updated === results.length, updated, failed: results.length - updated, ...(repeatedIds ? { repeatedIds } : {}), results };
}

/** Runs `work` over `items`, at most `limit` at a time, answers in the items' order. */
export async function inBatches<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}
