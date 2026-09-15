"use client";

// Practice-mode progress for the interview prep pack: the user's self-ratings
// per question, kept in this browser so a reload mid-session doesn't lose
// them. Same envelope pattern as lib/workspace.ts — per user, versioned,
// failure-tolerant, and swept on sign-out.
//
// Ratings are keyed to the pack they were made against (packGeneratedAt): a
// regenerated pack has different questions, so old ratings are discarded
// rather than silently applied to new cards.

const KEY_PREFIX = "cvtailor:prep:";
const VERSION = 1;

export type PrepRating = 1 | 2 | 3; // shaky · ok · nailed it
export type PrepRatings = Record<string, PrepRating>;

type Envelope = { v: number; packGeneratedAt: string; ratings: PrepRatings; savedAt: number };

function keyFor(userId: string, applicationId: string): string {
  return `${KEY_PREFIX}${userId}:${applicationId}`;
}

export function loadPrepProgress(userId: string, applicationId: string, packGeneratedAt: string): PrepRatings {
  if (!userId || !applicationId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(keyFor(userId, applicationId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Envelope;
    if (!parsed || parsed.v !== VERSION || parsed.packGeneratedAt !== packGeneratedAt) return {};
    const ratings: PrepRatings = {};
    for (const [id, value] of Object.entries(parsed.ratings ?? {})) {
      if (value === 1 || value === 2 || value === 3) ratings[id] = value;
    }
    return ratings;
  } catch {
    return {};
  }
}

export function savePrepProgress(userId: string, applicationId: string, packGeneratedAt: string, ratings: PrepRatings): void {
  if (!userId || !applicationId || typeof window === "undefined") return;
  try {
    if (Object.keys(ratings).length === 0) {
      window.localStorage.removeItem(keyFor(userId, applicationId));
      return;
    }
    const envelope: Envelope = { v: VERSION, packGeneratedAt, ratings, savedAt: Date.now() };
    window.localStorage.setItem(keyFor(userId, applicationId), JSON.stringify(envelope));
  } catch {
    // Storage unavailable or full — practice still works, it just won't persist.
  }
}

export function clearAllPrepProgress(): void {
  if (typeof window === "undefined") return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) stale.push(key);
    }
    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
