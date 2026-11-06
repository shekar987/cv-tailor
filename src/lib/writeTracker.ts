// Writes in flight from this browser tab (6 Nov 2026, Chunk 19), so a list read while a
// write was travelling is known to be older than the screen. /applications paints from one
// page and swaps in the full list a moment later; a full list read before a write landed
// would put the old row back on screen (the review's repro: Rejected at 2.9 s, the list
// lands at 3.0 s, the PUT commits at 3.6 s, the screen shows Applied).
//
// `seq` moves when a write starts AND when it finishes, so a read is fresh only when no
// write started or finished while it ran and none was in flight when it began.
// Every writer the tracker page can trigger goes through trackedFetch: the page itself,
// the event form, the sent-CV block and the clean-up panel. Import-free.

let seq = 0;
let inFlight = 0;

export function writeSeq(): number {
  return seq;
}

export function writesInFlight(): number {
  return inFlight;
}

function isWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  return method !== "GET" && method !== "HEAD";
}

/** fetch, counting the call as a write unless it is a GET or HEAD. */
export async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isWrite(input, init)) return fetch(input, init);
  seq++;
  inFlight++;
  try {
    return await fetch(input, init);
  } finally {
    inFlight--;
    seq++;
  }
}

/** Resolves once no write is in flight, or after `maxMs`. */
export async function whenNoWrites(maxMs = 5000, stepMs = 100): Promise<void> {
  const until = Date.now() + maxMs;
  while (inFlight > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, stepMs));
}
