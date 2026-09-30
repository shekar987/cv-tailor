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
// onePageCv, default false: the CV's length target. Two pages is the
// default — the tailored CV keeps the master CV's content and lib/onePage
// fits it to two pages (restoring left-out master bullets when there is
// room). One page is opt-in: lib/onePage trims by relevance to fit. Until
// 25 Sep one page was forced for anyone whose eligibility answer said under
// three years; the owner found it cut too much of the master CV.
//
// projectLinks: the GitHub and live-site addresses the user set per project
// on /customize (lib/projectLinks — keyed by projectKey, bounded there). The
// pages attach them to every project the document renders, pool selections
// included; a project with no entry shows what its CV text gives.
//
// Since 30 Sep the Right to Work section, when on the document, and the
// copy block for forms are the Eligibility statement (lib/rightToWorkText),
// never the CV's own lines: Eligibility is the one source of that wording.
//
// Imports only ./projectLinks.ts and ./rightToWorkText.ts (both
// import-free), so it runs in the browser and under node:test.

import { normalizeProjectLinks, type SavedProjectLinks } from "./projectLinks.ts";
import { rightToWorkStatement, type RtwFacts } from "./rightToWorkText.ts";

export type Preferences = {
  version: 1;
  includeRightToWorkOnCv: boolean;
  onePageCv: boolean;
  projectLinks: SavedProjectLinks;
};

export const DEFAULT_PREFERENCES: Preferences = { version: 1, includeRightToWorkOnCv: false, onePageCv: false, projectLinks: {} };

export function normalizePreferences(v: unknown): Preferences {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    version: 1,
    includeRightToWorkOnCv: o.includeRightToWorkOnCv === true,
    onePageCv: o.onePageCv === true,
    projectLinks: normalizeProjectLinks(o.projectLinks),
  };
}

// The page count the downloads lay the CV out to.
export function pageTarget(prefs: Preferences): 1 | 2 {
  return prefs.onePageCv ? 1 : 2;
}

// The profile the CV document renders with: identical to the stored profile
// except for Right to Work — dropped unless the switch is on, and when it is
// on, the Eligibility statement's lines (never the CV's own wording; nothing
// when the answer is not set). Every renderer (preview, .docx, PDF, the
// Applied snapshot) reads this one derivation, so the section can never
// appear in one output and not another.
export function profileForDocument<T extends { rightToWork?: string[] } | null | undefined>(profile: T, prefs: Preferences, eligibility?: RtwFacts | null): T {
  if (!profile) return profile;
  const own = Array.isArray(profile.rightToWork) ? profile.rightToWork : [];
  if (prefs.includeRightToWorkOnCv) {
    const lines = rightToWorkForForms(eligibility).split("\n").filter(Boolean);
    if (lines.length > 0) return { ...profile, rightToWork: lines };
  }
  return own.length === 0 ? profile : { ...profile, rightToWork: [] };
}

// The wording offered for application forms: the Eligibility statement, one
// sentence per line; empty until the user has answered.
export function rightToWorkForForms(eligibility: RtwFacts | null | undefined): string {
  return eligibility ? rightToWorkStatement(eligibility).formBlock : "";
}
