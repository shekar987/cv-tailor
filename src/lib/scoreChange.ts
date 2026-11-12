// Before and after tailoring, on one card (12 Nov 2026, Chunk 24). The pre-check's
// "Rough keyword match, before tailoring" and the result's "Recruiter search
// visibility" are the SAME measure: lib/atsMatch over the posting's
// top_15_ats_keywords. They read different text: the pre-check reads the
// master CV as saved (every section), the score reads the tailored summary,
// skills, experience and projects (lib/atsMatch tailoredSectionsText). Shown
// apart, the two looked like one figure repeated; this puts the "before" on
// the result with the terms that moved, so a change (or none) is visible.
//
// Relative imports only, so it runs under node:test.

import { matchAtsKeywords, type AtsMatchResult } from "./atsMatch.ts";

export type ScoreChange = {
  before: AtsMatchResult;
  after: AtsMatchResult;
  // Terms the tailored text carries that the master CV text did not match.
  gained: string[];
  // Terms the master CV matched that the scored sections do not carry: usually
  // a term only in Education or Certifications, which the score does not read,
  // or in a line left out of this CV.
  lost: string[];
};

/**
 * The two readings of one term list. Null when there are no terms, or when the
 * "after" read here disagrees with the figure the page shows (`shownMatched`):
 * a line that contradicts the score beside it would be worse than none.
 */
export function scoreChange(masterCvText: string, tailoredText: string, terms: unknown, shownMatched?: number | null): ScoreChange | null {
  const before = matchAtsKeywords(masterCvText || "", terms);
  const after = matchAtsKeywords(tailoredText || "", terms);
  if (before.total === 0 || after.total !== before.total) return null;
  if (typeof shownMatched === "number" && shownMatched !== after.matched) return null;
  const had = new Set(before.matchedKeywords);
  const has = new Set(after.matchedKeywords);
  return {
    before,
    after,
    gained: after.matchedKeywords.filter((t) => !had.has(t)),
    lost: before.matchedKeywords.filter((t) => !has.has(t)),
  };
}

/** One sentence for the card: what tailoring changed in the count, by term. */
export function scoreChangeLine(c: ScoreChange): string {
  const list = (xs: string[]) => xs.join(", ");
  const parts: string[] = [`Before tailoring: ${c.before.matched}/${c.before.total} in your master CV.`];
  if (c.gained.length === 0 && c.lost.length === 0) {
    parts.push("Tailoring did not change which terms are matched.");
  } else {
    if (c.gained.length > 0) parts.push(`Now matched: ${list(c.gained)}.`);
    if (c.lost.length > 0)
      parts.push(`No longer counted: ${list(c.lost)} (in your master CV, but not in the tailored summary, skills, experience or projects, which are what this score reads).`);
  }
  return parts.join(" ");
}
