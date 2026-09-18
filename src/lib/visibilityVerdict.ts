// The post-tailor search-visibility verdict — computed from the score, never
// written by the model.
//
// WHY: the scorer used to write a free-text "overall_assessment", and in
// production it praised every score: 3/15 → "Your CV is strong", 6/15 →
// "highly competitive", 9/15 → "strong and submittable". There was no score
// at which it told the user not to send. The band is now arithmetic on the
// deterministic keyword match (lib/atsMatch), the label is a fixed string per
// band, and the model is handed the band and asked only for the edits that
// belong inside it. Its output can annotate the lists and propose edits; it
// cannot move a term between hit and miss, quote a different count, or choose
// the verdict.
//
// Import-free apart from the matcher's result type (tests/ runs this under
// node:test with no `@/` alias — keep it that way).

import type { AtsMatchResult } from "./atsMatch.ts";

export type VisibilityBand = "weak" | "borderline" | "ready";

export const BAND_LABELS: Record<VisibilityBand, string> = {
  weak: "Weak match. Do not send as-is.",
  borderline: "Borderline. Fix these before sending.",
  ready: "Ready to send.",
};

// How many edits each band shows: the two highest-impact for a weak match,
// the specific gaps for a borderline one, optional polish when ready.
export const EDIT_LIMITS: Record<VisibilityBand, number> = { weak: 2, borderline: 4, ready: 2 };

// Thresholds as fractions of the role's terms. Compared with integer
// arithmetic (matched * 100 >= total * threshold) so 11/15 (73.3%) is
// borderline and 12/15 (80%) is ready, with no floating-point edge.
const READY_PCT = 75;
const BORDERLINE_PCT = 50;

export function bandFor(matched: number, total: number): VisibilityBand {
  if (!(total > 0) || !(matched > 0)) return "weak";
  if (matched * 100 >= total * READY_PCT) return "ready";
  if (matched * 100 >= total * BORDERLINE_PCT) return "borderline";
  return "weak";
}

// "3/15" → { matched: 3, total: 15 }; anything else → null.
export function parseCoverage(s: unknown): { matched: number; total: number } | null {
  if (typeof s !== "string") return null;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(s);
  if (!m) return null;
  return { matched: Number(m[1]), total: Number(m[2]) };
}

// Praise the model is not allowed to smuggle into an edit when the band says
// otherwise. An edit is an action ("Move X into the skills line"), never a
// verdict — so in the weak and borderline bands any edit that reads as one is
// dropped rather than shown beside "Do not send".
const OUT_OF_BAND_PRAISE = /\b(strong|competitive|submittable|ready to send|good to go|well[- ]positioned|impressive|excellent)\b/i;

function cleanEdits(raw: unknown, band: VisibilityBand): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (band !== "ready" && OUT_OF_BAND_PRAISE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.slice(0, 400));
    if (out.length >= EDIT_LIMITS[band]) break;
  }
  return out;
}

// The block the scoring prompt receives. It states the band as settled and
// tells the model what the only open question is.
export function renderBandBlock(coverage: AtsMatchResult, required: AtsMatchResult | null): string {
  const band = bandFor(coverage.matched, coverage.total);
  const lines = [
    "SETTLED VERDICT (computed from the deterministic keyword match — you cannot change it, restate it, soften it, or write your own):",
    `  Band: ${band.toUpperCase()} — "${BAND_LABELS[band]}"`,
    `  Keyword coverage: ${coverage.matched}/${coverage.total} of the role's terms are present in the tailored CV.`,
  ];
  if (required && required.total > 0) {
    lines.push(`  Required skills: ${required.matched}/${required.total} present.`);
  }
  lines.push(`  Present: ${coverage.matchedKeywords.join(", ") || "(none)"}`);
  lines.push(`  Absent: ${coverage.missedKeywords.join(", ") || "(none)"}`);
  if (required && required.missedKeywords.length > 0) {
    lines.push(`  Required skills absent: ${required.missedKeywords.join(", ")}`);
  }
  const ask =
    band === "weak"
      ? 'Your "edits" must be EXACTLY the 2 highest-impact edits: the two changes to the tailored text most likely to surface real, absent terms from the master CV. No praise, no "however", no assessment of competitiveness.'
      : band === "borderline"
        ? 'Your "edits" must name the specific gaps to fix before sending — one per absent term the master CV can honestly cover (2-4 entries), each saying where in the CV the evidence sits. No praise, no assessment of competitiveness.'
        : 'Your "edits" are 0-2 optional polish items. Do not manufacture edits for their own sake; an empty array is a valid answer.';
  lines.push("", ask);
  return lines.join("\n");
}

// ── One verdict on one screen ────────────────────────────────────────────────
//
// The research panel's Fit Score (lib/fitScore: the master CV against the
// company's real stack, values and pain points) and this band (the role's
// search terms found in the tailored text) measured different things and
// once read "Low match 49/100" beside "you're a strong fit" for the same
// company. The Fit Score is authoritative for whether to send: it can only
// lower the band, never raise it, and the verdict line names the research
// figure so the two never contradict.

export type FitReference = { total: number; tier: "low" | "medium" | "high" };
export type CombinedVerdict = { band: VisibilityBand; label: string; fitNote: string | null };

export function combineWithFit(band: VisibilityBand, fit: FitReference | null | undefined): CombinedVerdict {
  if (!fit || !Number.isFinite(fit.total)) return { band, label: BAND_LABELS[band], fitNote: null };
  const figure = `${Math.round(fit.total)}/100`;
  if (fit.tier === "low") {
    return {
      band: "weak",
      label: `Weak fit. Company research scored ${figure} (low match) against your CV; do not send as-is.`,
      fitNote: `Company research: ${figure}, low match. The search-term count above is not a fit score.`,
    };
  }
  if (fit.tier === "medium" && band === "ready") {
    return {
      band: "borderline",
      label: `Borderline. The role's terms are covered, but company research scored ${figure} (potential match). Fix the gaps before sending.`,
      fitNote: `Company research: ${figure}, potential match.`,
    };
  }
  return {
    band,
    label: BAND_LABELS[band],
    fitNote: `Company research: ${figure}, ${fit.tier === "high" ? "highly positive fit" : "potential match"}.`,
  };
}

export type VisibilityScore = {
  band: VisibilityBand;
  verdict: string;
  keyword_coverage: string;
  required_skill_coverage?: string;
  required_misses?: string[];
  hits: string[];
  misses: string[];
  recommendations: string[];
};

// Combines the deterministic match with whatever the model wrote. Membership,
// counts, band and verdict come from `coverage`; the model may only annotate
// a term it was given (prefix match on the term) and supply edits.
export function reconcileAtsScore(
  modelOutput: unknown,
  coverage: AtsMatchResult,
  required: AtsMatchResult | null
): VisibilityScore {
  const score = (modelOutput && typeof modelOutput === "object" ? modelOutput : {}) as Record<string, unknown>;
  const modelHits = Array.isArray(score.hits) ? score.hits.filter((h): h is string => typeof h === "string") : [];
  const modelMisses = Array.isArray(score.misses) ? score.misses.filter((m): m is string => typeof m === "string") : [];
  // Prefix match, not containment: a hit's annotation ("Java — skills and
  // experience (Spring Boot API)") CONTAINS other keywords, and containment
  // matching filed the same entry under several of them (duplicate hits).
  const entryFor = (list: string[], kw: string) => list.find((e) => e.trim().toLowerCase().startsWith(kw.toLowerCase()));

  const hits = coverage.matchedKeywords.map((kw) => entryFor(modelHits, kw) ?? kw);
  const misses = coverage.missedKeywords.map(
    (kw) => entryFor(modelMisses, kw) ?? `${kw} — not present in the tailored text`
  );

  const band = bandFor(coverage.matched, coverage.total);
  // The model sometimes quotes a count of its own ("13 of 15") — sync any
  // X/N or "X of N" figure in an edit with the real one.
  const syncFigures = (s: string) =>
    s.replace(
      new RegExp(String.raw`\b\d{1,2}(\s*(?:/|of)\s*)${coverage.total}\b`, "g"),
      (_m, sep: string) => `${coverage.matched}${sep}${coverage.total}`
    );
  const recommendations = cleanEdits(score.edits ?? score.recommendations, band).map(syncFigures);

  const out: VisibilityScore = {
    band,
    verdict: BAND_LABELS[band],
    keyword_coverage: `${coverage.matched}/${coverage.total}`,
    hits,
    misses,
    recommendations,
  };
  if (required && required.total > 0) {
    out.required_skill_coverage = `${required.matched}/${required.total}`;
    out.required_misses = [...required.missedKeywords];
  }
  return out;
}
