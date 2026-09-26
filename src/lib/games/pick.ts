// Which game a tailor gets, and how full the popup's progress bar is.
// Import-free apart from a type (node:test).
import type { GameKind } from "./core.ts";

// A full run on Claude takes roughly 30–60 s (the fact check and the repair
// call included). The bar is paced to this, never to a promise.
export const EXPECTED_TAILOR_MS = 50_000;

const KEY_PREFIX = "cvtailor:games:";
let memoryCount = 0;

// The 1st tailor gets the platformer, the 2nd the flyer, and they alternate.
export function gameForTailorCount(count: number): GameKind {
  return Math.max(1, Math.floor(count)) % 2 === 1 ? "platformer" : "flyer";
}

// Counts this user's tailors in the browser and returns the new count (1 for
// the first). Blocked or missing storage counts in memory for the session.
export function nextTailorCount(userId: string | null, storage?: Pick<Storage, "getItem" | "setItem"> | null): number {
  try {
    const store = storage === undefined ? window.localStorage : storage;
    if (!store || !userId) throw new Error("no storage");
    const key = KEY_PREFIX + userId;
    const n = Math.max(0, parseInt(store.getItem(key) ?? "0", 10) || 0) + 1;
    store.setItem(key, String(n));
    return n;
  } catch {
    memoryCount += 1;
    return memoryCount;
  }
}

// 0 … 0.99 while the run is going: 90% at the expected time, then creeping
// towards 99%. Only the real result fills the bar (the popup shows 100% then).
export function progressAt(elapsedMs: number, expectedMs: number = EXPECTED_TAILOR_MS): number {
  if (!(elapsedMs > 0)) return 0;
  if (elapsedMs <= expectedMs) return 0.9 * (elapsedMs / expectedMs);
  return Math.min(0.99, 0.9 + 0.09 * (1 - Math.exp(-(elapsedMs - expectedMs) / 25_000)));
}
