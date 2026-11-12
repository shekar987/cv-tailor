// Idempotency-Key on the tracker's writes (12 Nov 2026, Chunk 22). Import-free but
// for node:crypto, so it runs under node:test (tests/fastTrackerApi).
//
// On 11 Nov the morning sweep's browser script timed out three times after its
// writes had landed; run again, a follow-up line went onto a row twice. A write
// that carries an `Idempotency-Key` header now runs once per key: the first request
// claims the key (a row in api_idempotency, migration 20261112120000), runs, and
// stores its answer for IDEMPOTENCY_TTL_MS; the same key again gets that answer
// back without writing anything. The key is the caller's (a UUID per intended
// write), scoped to the signed-in user.
//
// - The same key with a different request (method, path or body) is refused (422):
//   reusing a key for new work would silently drop that work.
// - A key whose first request is still running answers 409 with Retry-After. One
//   whose answer was lost (still no answer after IN_PROGRESS_STALE_MS, longer than the
//   route can run: the process died, or the answer could not be stored) is NEVER run
//   again: it may have written, so it answers "unknown" and the caller reads the row
//   before trying under a new key. Never writing twice is the point of the key.
// - An answer that says "try again" is not kept: a server failure (5xx), a rate limit
//   (429), a timeout (408, 425). The claim is released so a retry under the same key runs.
// - What is kept leaves out the row's notes and a file's text (keptBody): the replay
//   carries the ids, statuses and versions; the text is one read away (GET ?id=).
// - No table yet: the request runs as before and says the key was not kept.
import { createHash } from "node:crypto";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
// Longer than the routes' maxDuration (60 s): a claim this old has no live request behind it.
export const IN_PROGRESS_STALE_MS = 2 * 60 * 1000;
export const MAX_IDEMPOTENCY_KEY = 255;
const KEY_RE = /^[\x21-\x7e]+$/;

export const IDEMPOTENCY_MIGRATION_HINT =
  "The Idempotency-Key was not kept: the database needs migration 20261112120000_fast_tracker_api.sql (run it in the Supabase SQL editor). This request ran once, as it would without a key.";
export const IN_PROGRESS_MESSAGE = "A request with this Idempotency-Key is still running. Wait a few seconds and send it again.";
export const UNKNOWN_MESSAGE =
  "A request with this Idempotency-Key started but its answer was lost, so it may or may not have been saved. Nothing was run again. Read the row (GET /api/applications?lite=1&q=<company>) and, only if it isn't there, send the request with a new key.";
export const ANSWER_LOST = "This request ran, but its full answer could not be kept. Read the row for the details.";
export const REUSED_MESSAGE =
  "This Idempotency-Key was used for a different request in the last 24 hours. Use a new key for new work (one key per intended write), or resend the original request unchanged.";

/** The header's key: absent, a usable key (visible ASCII, no spaces, ≤ 255), or why not. */
export function readIdempotencyKey(header: string | null | undefined): { none: true } | { key: string } | { error: string } {
  if (header === null || header === undefined) return { none: true };
  const key = header.trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY || !KEY_RE.test(key)) {
    return { error: `The ${IDEMPOTENCY_HEADER} header must be 1 to ${MAX_IDEMPOTENCY_KEY} visible characters with no spaces (a UUID is ideal).` };
  }
  return { key };
}

/** JSON with every object's keys sorted, so the same body written twice fingerprints the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A JSON body as the fingerprint reads it: parsed and key-sorted, else the raw text. */
export function canonicalJsonBody(text: string): string {
  try {
    return stableStringify(JSON.parse(text));
  } catch {
    return text;
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** What one request is, for telling a retry from new work under the same key. */
export function fingerprint(parts: { method: string; path: string; body: string }): string {
  return sha256Hex(`${parts.method.toUpperCase()}\n${parts.path}\n${parts.body}`);
}

export type StoredResponse = { status: number; body: unknown };

// "Try again" answers: never kept, so a retry under the same key really runs.
const RETRYABLE = new Set([408, 425, 429]);
export function isKeepable(status: number): boolean {
  return status < 500 && !RETRYABLE.has(status);
}

// What the store keeps of an answer: the same JSON without the row's notes and a file's
// text, which the store would otherwise copy and hold apart from the row (a deleted row's
// notes must go with it). Known keys only; everything else is kept as it was.
const TEXT_KEYS = ["notes", "reportNotes"];
const FILE_KEYS = ["sentCv", "sentCoverLetter"];
export function keptBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of TEXT_KEYS) if (typeof out[k] === "string") out[k] = null;
  // Notes text inside: a follow-up cleared, and the words a sweep's report quoted (a 202's question).
  for (const k of ["followupCleared", "pending_outcome"]) {
    const inner = out[k];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const copy = { ...(inner as Record<string, unknown>) };
      if (k === "followupCleared" && typeof copy.notes === "string") copy.notes = null;
      if (k === "pending_outcome" && typeof copy.note === "string") delete copy.note;
      out[k] = copy;
    }
  }
  for (const k of FILE_KEYS) {
    const file = out[k];
    if (file && typeof file === "object" && !Array.isArray(file)) out[k] = { ...(file as Record<string, unknown>), text: "" };
  }
  return out;
}
export type IdempotencyRecord = { request_hash: string; status_code: number | null; response: unknown; created_at: string };

export interface IdempotencyStore {
  /** Insert the claim. "taken": the key has a row already; "missing": no table yet. */
  claim(key: string, hash: string, method: string, path: string): Promise<"claimed" | "taken" | "missing">;
  read(key: string): Promise<IdempotencyRecord | null>;
  /** Take over an expired or abandoned row, only while it is still the one read (its created_at). */
  retake(key: string, seenCreatedAt: string, hash: string, method: string, path: string): Promise<boolean>;
  finish(key: string, hash: string, response: StoredResponse): Promise<void>;
  release(key: string, hash: string): Promise<void>;
}

export type RecordState = "replay" | "in_progress" | "reused" | "expired" | "abandoned";

/** What a row found under the key means for this request. */
export function classifyRecord(record: IdempotencyRecord, hash: string, now: number): RecordState {
  const created = Date.parse(record.created_at);
  if (!Number.isFinite(created) || now - created >= IDEMPOTENCY_TTL_MS) return "expired";
  if (record.request_hash !== hash) return "reused";
  if (record.status_code === null || record.status_code === undefined) return now - created >= IN_PROGRESS_STALE_MS ? "abandoned" : "in_progress";
  return "replay";
}

export type IdempotentOutcome<T> =
  | { kind: "ran"; value: T; stored: boolean }
  | { kind: "replayed"; response: StoredResponse }
  | { kind: "in_progress" }
  | { kind: "unknown" }
  | { kind: "reused" }
  | { kind: "unavailable"; value: T };

/**
 * Run `run` at most once per key. `toStored` turns its result into what is kept (null: not
 * keepable, e.g. not JSON). A thrown error or a "try again" answer releases the claim.
 */
export async function runIdempotent<T>(
  opts: { key: string; hash: string; method: string; path: string; store: IdempotencyStore; now: () => number },
  run: () => Promise<T>,
  toStored: (value: T) => Promise<StoredResponse | null>
): Promise<IdempotentOutcome<T>> {
  const { key, hash, method, path, store } = opts;
  const execute = async (): Promise<IdempotentOutcome<T>> => {
    let value: T;
    try {
      value = await run();
    } catch (err) {
      await store.release(key, hash).catch(() => undefined);
      throw err;
    }
    const stored = await toStored(value);
    if (!stored || !isKeepable(stored.status)) {
      await store.release(key, hash).catch(() => undefined);
      return { kind: "ran", value, stored: false };
    }
    try {
      await store.finish(key, hash, stored);
    } catch {
      // The write landed. Keep at least that it ran; if even that fails, the claim stays
      // unanswered and a retry is told "unknown", never run again.
      try {
        await store.finish(key, hash, { status: stored.status, body: { ok: stored.status < 400, answerLost: true, message: ANSWER_LOST } });
      } catch {
        // nothing more to do
      }
      return { kind: "ran", value, stored: false };
    }
    return { kind: "ran", value, stored: true };
  };

  // Three tries: the row can be deleted, or retaken by another request, between reads.
  for (let attempt = 0; attempt < 3; attempt++) {
    const claim = await store.claim(key, hash, method, path);
    if (claim === "missing") return { kind: "unavailable", value: await run() };
    if (claim === "claimed") return execute();
    const record = await store.read(key);
    if (!record) continue;
    const state = classifyRecord(record, hash, opts.now());
    if (state === "replay") return { kind: "replayed", response: { status: record.status_code as number, body: record.response } };
    if (state === "in_progress") return { kind: "in_progress" };
    if (state === "abandoned") return { kind: "unknown" };
    if (state === "reused") return { kind: "reused" };
    // Expired: the key is free again.
    if (await store.retake(key, record.created_at, hash, method, path)) return execute();
  }
  return { kind: "in_progress" };
}
