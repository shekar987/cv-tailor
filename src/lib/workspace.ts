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
  // Minted once per completed tailoring run. An "Applied" save is keyed on it,
  // so a reload can't turn a second click into a second tracker row. Optional:
  // envelopes written before it existed restore fine without one.
  tailorSessionId?: string | null;
  // The JD the stored result was tailored from — /app compares it against the
  // textarea to flag stale results. Optional for the same backwards-compat
  // reason as tailorSessionId.
  resultJd?: string | null;
  // Which flow produced the result: a pasted JD, or a cold-outreach brief
  // built from research. The stale-JD banner only applies to "jd" runs.
  // Optional — older envelopes restore as null, which the page treats as "jd"
  // (only JD runs ever stored a resultJd before this field existed).
  resultSource?: "jd" | "outreach" | null;
  // Stage 3 company research (the /api/research payload) and the URL it was
  // run for. Optional — envelopes written before Stage 3 restore fine.
  research?: unknown;
  researchUrl?: string | null;
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
      tailorSessionId: typeof parsed.tailorSessionId === "string" ? parsed.tailorSessionId : null,
      resultJd: typeof parsed.resultJd === "string" ? parsed.resultJd : null,
      resultSource: parsed.resultSource === "jd" || parsed.resultSource === "outreach" ? parsed.resultSource : null,
      research: parsed.research ?? null,
      researchUrl: typeof parsed.researchUrl === "string" ? parsed.researchUrl : null,
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
    if (!data.jobDescription.trim() && !data.result && !data.research) {
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

// Sign-out sweep: on a shared browser every past account's tailored result
// would otherwise stay in localStorage forever, eventually filling the quota
// and silently disabling persistence for everyone.
export function clearAllWorkspaces(): void {
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
