"use client";

// Keeps the user's in-progress work — the pasted job description and the
// tailored result — across page reloads and navigations.
//
// WHY: these lived only in React state, so anything that unloaded the page
// destroyed them: a hard refresh, the browser back button, or following a link
// out of the CV preview. A user could lose a finished tailored CV by clicking
// their own LinkedIn link. The work now survives until they explicitly replace
// it (new tailor run, edited JD, replaced master CV) or sign out.
//
// Scoped per user id: on a shared browser, signing in as someone else must
// never surface the previous person's CV. Every operation is failure-tolerant —
// storage can be unavailable (private mode, disabled cookies) or full, and none
// of that should break the app.

const KEY_PREFIX = "cvtailor:workspace:";
// Bump when the stored shape changes; older payloads are then ignored rather
// than restored into a component that no longer understands them.
const VERSION = 1;

export type StoredWorkspace = {
  jobDescription: string;
  result: unknown;
  ranProvider: string | null;
};

type Envelope = StoredWorkspace & { v: number; savedAt: number };

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadWorkspace(userId: string): StoredWorkspace | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (!parsed || parsed.v !== VERSION) return null;
    return {
      jobDescription: typeof parsed.jobDescription === "string" ? parsed.jobDescription : "",
      result: parsed.result ?? null,
      ranProvider: typeof parsed.ranProvider === "string" ? parsed.ranProvider : null,
    };
  } catch {
    // Corrupt or unreadable — behave as if nothing was saved.
    return null;
  }
}

export function saveWorkspace(userId: string, data: StoredWorkspace): void {
  if (!userId || typeof window === "undefined") return;
  try {
    // Nothing worth restoring — clear instead of storing an empty shell, so a
    // stale result can't outlive the JD it belongs to.
    if (!data.jobDescription.trim() && !data.result) {
      window.localStorage.removeItem(keyFor(userId));
      return;
    }
    const envelope: Envelope = { ...data, v: VERSION, savedAt: Date.now() };
    window.localStorage.setItem(keyFor(userId), JSON.stringify(envelope));
  } catch {
    // Quota exceeded or storage blocked. Losing persistence is acceptable;
    // breaking the tailoring flow is not.
  }
}

export function clearWorkspace(userId: string): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // ignore
  }
}
