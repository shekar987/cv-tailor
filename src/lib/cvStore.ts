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

const PROFILE_KEY = "cvtailor_profile";

export type Education = { degree: string; dates: string; institution: string; note: string };
export type ProjectLink = { label: string; url: string; text: string };
export type CvProject = { name: string; tech: string; links: ProjectLink[]; originalBullets: string[] };
export type Profile = {
  name: string;
  tagline: string;
  location: string;
  phone: string;
  email: string;
  linkedin: string;
  github: string;
  education: Education[];
  certifications: string[];
  projects: CvProject[];
  rightToWork: string[];
};

export function getProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {}
}

export function clearProfile(): void {
  try {
    window.localStorage.removeItem(PROFILE_KEY);
  } catch {}
}