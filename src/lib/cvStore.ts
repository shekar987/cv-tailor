// CV storage layer. Today it uses browser localStorage.
// LATER (accounts): swap the bodies of these functions to call a database/API.
// The rest of the app only calls these functions, so nothing else changes.

const KEY = "cvtailor_master_cv";

export type MasterCV = {
  text: string;        // the full CV text
  updatedAt: number;   // when it was last saved
};

export function getMasterCV(): MasterCV | null {
  if (typeof window === "undefined") return null; // server-side guard
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MasterCV;
  } catch {
    return null;
  }
}

export function saveMasterCV(text: string): MasterCV {
  const record: MasterCV = { text: text.trim(), updatedAt: Date.now() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // storage may be unavailable (private mode, etc.) — fail quietly
  }
  return record;
}

export function clearMasterCV(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function hasMasterCV(): boolean {
  return getMasterCV() !== null;
}