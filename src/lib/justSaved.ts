// "Just saved" (12 Nov 2026, Chunk 24): the application /app saved to the
// tracker last, so /applications can open on it instead of making the user
// hunt for it. /app writes it after "Applied — save to tracker"; the tracker
// reads it, shows "Just saved: <company>" with the row's CV and letter, and on
// the first open soon after the save opens the tab that holds it.
//
// Kept in this browser only (localStorage), per user, under the workspace
// prefix so sign-out's sweep (lib/workspace clearAllWorkspaces) removes it
// with the tailored result it came from. Import-free apart from window, which
// every access guards, so the rules run under node:test.

export type JustSaved = {
  id: string;
  company: string;
  role: string;
  // The status it was saved with (the API's spelling), for the tab to open on.
  status: string;
  // When it was saved, ms since epoch.
  at: number;
  // The tracker already opened on it once; later opens keep their own tab.
  opened?: boolean;
  // The user closed the "Just saved" line.
  dismissed?: boolean;
};

// The line stays this long after the save, unless closed.
export const JUST_SAVED_TTL_MS = 24 * 60 * 60 * 1000;
// Opening the tracker this soon after the save opens the row's tab, once.
export const JUST_SAVED_AUTO_OPEN_MS = 30 * 60 * 1000;

const KEY_PREFIX = "cvtailor:workspace:just-saved:";

export function justSavedKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** A stored marker, re-bounded; null when unreadable, expired or not this shape. */
export function parseJustSaved(raw: string | null | undefined, now: number): JustSaved | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const id = str(o.id, 64);
  const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : NaN;
  if (!/^[0-9a-f-]{8,64}$/i.test(id) || !Number.isFinite(at)) return null;
  // Expired, or written by a clock ahead of this one by more than a minute.
  if (now - at > JUST_SAVED_TTL_MS || at - now > 60_000) return null;
  return {
    id,
    company: str(o.company, 200),
    role: str(o.role, 200),
    status: str(o.status, 40) || "Applied",
    at,
    ...(o.opened === true ? { opened: true } : {}),
    ...(o.dismissed === true ? { dismissed: true } : {}),
  };
}

/**
 * Whether the tracker should open on the saved row now: always when it was
 * reached through "Saved to tracker" (?saved=<id>), else once, within
 * JUST_SAVED_AUTO_OPEN_MS of the save.
 */
export function shouldAutoOpen(marker: JustSaved | null, now: number, linkedId: string | null): boolean {
  if (!marker || marker.dismissed) return false;
  if (linkedId) return linkedId === marker.id;
  return !marker.opened && now - marker.at <= JUST_SAVED_AUTO_OPEN_MS;
}

/** Whether the "Just saved" line shows. */
export function showsJustSaved(marker: JustSaved | null): boolean {
  return !!marker && !marker.dismissed;
}

export function readJustSaved(userId: string | null, now = Date.now()): JustSaved | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    return parseJustSaved(window.localStorage.getItem(justSavedKey(userId)), now);
  } catch {
    return null;
  }
}

export function writeJustSaved(userId: string | null, marker: JustSaved): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(justSavedKey(userId), JSON.stringify(marker));
  } catch {
    // Storage blocked or full: the tracker simply opens as it always did.
  }
}

export function clearJustSaved(userId: string | null): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(justSavedKey(userId));
  } catch {
    // Nothing to do.
  }
}
