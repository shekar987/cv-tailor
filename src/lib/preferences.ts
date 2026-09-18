// Document preferences — per-user switches for how the CV document renders.
// Stored in user_settings.preferences (migration 20260918120000); the pages
// hold them and apply them client-side, so the download routes never need to
// know: they render whatever profile they are handed.
//
// includeRightToWorkOnCv, default false. A CV reviewer who sees immigration
// status before reading any experience screens on it; the application form
// asks the same question in a better context. So the Right to Work section
// is left off the document by default, its wording is offered as a
// copy-to-clipboard block for forms, and the cover letter pipeline (which
// reads the master CV text) is unchanged. The switch exists for the rare
// posting that asks for it on the document itself.
//
// Import-free, so it runs in the browser and under node:test.

export type Preferences = {
  version: 1;
  includeRightToWorkOnCv: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = { version: 1, includeRightToWorkOnCv: false };

export function normalizePreferences(v: unknown): Preferences {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { version: 1, includeRightToWorkOnCv: o.includeRightToWorkOnCv === true };
}

// The profile the CV document renders with: identical to the stored profile
// except that Right to Work is dropped unless the switch is on. Every renderer
// (preview, .docx, PDF, the Applied snapshot) reads this one derivation, so
// the section can never appear in one output and not another.
export function profileForDocument<T extends { rightToWork?: string[] } | null | undefined>(profile: T, prefs: Preferences): T {
  if (!profile || prefs.includeRightToWorkOnCv) return profile;
  if (!Array.isArray(profile.rightToWork) || profile.rightToWork.length === 0) return profile;
  return { ...profile, rightToWork: [] };
}

// The wording offered for application forms: the profile's own lines, one
// per line, as the CV states them.
export function rightToWorkForForms(profile: { rightToWork?: string[] } | null | undefined): string {
  return (profile?.rightToWork ?? []).map((s) => s.trim()).filter(Boolean).join("\n");
}
