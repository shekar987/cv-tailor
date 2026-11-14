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
import { BAND_LABELS, type VisibilityBand } from "./visibilityVerdict.ts";

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
  const parts: string[] = [`Before tailoring: ${c.before.matched}/${c.before.total} in your main CV.`];
  if (c.gained.length === 0 && c.lost.length === 0) {
    parts.push("Tailoring did not change which terms are matched.");
  } else {
    if (c.gained.length > 0) parts.push(`Now matched: ${list(c.gained)}.`);
    if (c.lost.length > 0)
      parts.push(`No longer counted: ${list(c.lost)} (in your main CV, but not in this tailored CV: listed below).`);
  }
  return parts.join(" ");
}

// ── The card's headline and its lists (14 Nov 2026, Chunk 28) ────────────────
//
// The free check said "Apply" at 7/15 and the result said "Borderline. Fix
// these before sending." at 9/15: the score went up and the tone got worse.
// When tailoring raised the count, the card now says so first. The band is
// still arithmetic on the count (lib/visibilityVerdict); only the sentence
// changes, and only when the sentence is the plain band label: a verdict that
// company research lowered (combineWithFit) names the research figure and is
// never replaced. A weak match stays "do not send it yet" whatever it rose from.

export type ScoreCardCopy = {
  // The verdict line under the figure.
  headline: string;
  // The heading over the suggested edits.
  editsHeading: string;
  // Tailoring raised the count, and the headline says so.
  improved: boolean;
};

const EDITS_HEADING: Record<VisibilityBand, string> = {
  weak: "Fix first",
  borderline: "Fix before sending",
  ready: "Optional edits",
};

/**
 * `band` and `label` are the verdict the page settled on (after company
 * research, when there is any); `change` is the before / after read, null when
 * it could not be made; `hasEdits` says whether a list of edits follows.
 */
export function scoreCardCopy(band: VisibilityBand, label: string, change: ScoreChange | null, hasEdits: boolean): ScoreCardCopy {
  const plain = { headline: label, editsHeading: EDITS_HEADING[band], improved: false };
  if (!change || change.after.matched <= change.before.matched) return plain;
  if (label !== BAND_LABELS[band]) return plain;
  const rose = `Improved from ${change.before.matched}/${change.before.total} to ${change.after.matched}/${change.after.total}`;
  if (band === "weak") return { headline: `${rose}, but still a weak match. Do not send it yet.`, editsHeading: EDITS_HEADING.weak, improved: true };
  if (band === "ready") return { headline: `${rose}. Ready to send.`, editsHeading: EDITS_HEADING.ready, improved: true };
  return {
    headline: hasEdits ? `${rose}. Optional fixes before you send are listed below.` : `${rose}.`,
    editsHeading: "Optional fixes before you send",
    improved: true,
  };
}

/**
 * The result's Missing list in two parts, so it never shows a "new" missing
 * term the free check did not list. `missing`: not in the main CV either (the
 * free check listed it). `leftOut`: the main CV has the term, the tailored
 * summary, skills, experience and projects do not. Each entry is the card's
 * own line for the term ("Kafka — not present in the tailored text"), matched
 * by its opening term. With no before / after read, everything is `missing`.
 */
export function splitMisses(misses: string[], change: ScoreChange | null): { missing: string[]; leftOut: string[] } {
  if (!change || change.lost.length === 0) return { missing: [...misses], leftOut: [] };
  // The longest term first: "Java" must not claim the line that opens "JavaScript".
  const lost = [...change.lost].sort((a, b) => b.length - a.length);
  const still = [...change.after.missedKeywords].filter((t) => !change.lost.includes(t)).sort((a, b) => b.length - a.length);
  const opens = (line: string, term: string) => line.trim().toLowerCase().startsWith(term.toLowerCase());
  const missing: string[] = [];
  const leftOut: string[] = [];
  for (const line of misses) {
    const asLost = lost.find((t) => opens(line, t));
    const asStill = still.find((t) => opens(line, t));
    if (asLost && (!asStill || asLost.length >= asStill.length)) leftOut.push(asLost);
    else missing.push(line);
  }
  return { missing, leftOut };
}
