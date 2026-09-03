// Fit Score: is applying to this company worth the user's time, 0-100.
//
// Weights per the Stage 3 spec: hard skills 40%, domain experience 30%,
// complexity/scale 20%, product empathy 10%. Tiers: <60 low ⚠️, 60-79
// medium ⚡, 80+ high 🔥.
//
// The model scores the rubric with cited evidence; reconcileFitScore() then
// bounds the hard-skill component with the deterministic CV↔stack keyword
// overlap (lib/atsMatch) and recomputes the weighted total server-side, so
// the number the user sees always follows from the components — the same
// philosophy as reconcileAtsScore in the tailor route. A padded fit score
// would send people into rejection piles; honesty is the product.

import { matchAtsKeywords } from "./atsMatch";

export const FIT_WEIGHTS = {
  hard_skills: 0.4,
  domain: 0.3,
  scale: 0.2,
  product: 0.1,
} as const;

export type FitComponentKey = keyof typeof FIT_WEIGHTS;
export type FitTier = "low" | "medium" | "high";

export type FitComponent = { score: number; evidence: string };

export type FitScore = {
  total: number;
  tier: FitTier;
  components: Record<FitComponentKey, FitComponent>;
  matched_stack: string[];
  missing_stack: string[];
  honest_gaps: string;
  headline: string;
};

export function fitTier(total: number): FitTier {
  if (total >= 80) return "high";
  if (total >= 60) return "medium";
  return "low";
}

const clamp = (n: unknown): number | null => {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
};

// Allowance above the deterministic overlap for genuine adjacent-skill
// judgment the keyword matcher can't see (e.g. deep Postgres experience
// against a MySQL-listed stack). Enough to matter, not enough to let the
// model award hard-skill points the CV can't evidence at all.
const HARD_SKILL_TOLERANCE = 15;

export function reconcileFitScore(raw: unknown, cvText: string, stackKeywords: string[]): FitScore | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const comps = (r.components && typeof r.components === "object" ? r.components : {}) as Record<string, unknown>;

  const component = (key: FitComponentKey): FitComponent | null => {
    const c = (comps[key] && typeof comps[key] === "object" ? comps[key] : {}) as Record<string, unknown>;
    const score = clamp(c.score);
    if (score === null) return null;
    return { score, evidence: typeof c.evidence === "string" ? c.evidence : "" };
  };

  const hard = component("hard_skills");
  const domain = component("domain");
  const scale = component("scale");
  const product = component("product");
  if (!hard || !domain || !scale || !product) return null;

  // Deterministic ground truth for the 40% component, and for the matched/
  // missing lists shown beside the score.
  const det = matchAtsKeywords(cvText, stackKeywords);
  if (det.total > 0) {
    const detScore = Math.round((det.matched / det.total) * 100);
    hard.score = Math.min(hard.score, Math.min(100, detScore + HARD_SKILL_TOLERANCE));
  }

  const components: Record<FitComponentKey, FitComponent> = { hard_skills: hard, domain, scale, product };
  const total = Math.round(
    (Object.keys(FIT_WEIGHTS) as FitComponentKey[]).reduce((sum, k) => sum + FIT_WEIGHTS[k] * components[k].score, 0)
  );

  return {
    total,
    tier: fitTier(total),
    components,
    matched_stack: det.matchedKeywords,
    missing_stack: det.missedKeywords,
    honest_gaps: typeof r.honest_gaps === "string" ? r.honest_gaps : "",
    headline: typeof r.headline === "string" ? r.headline : "",
  };
}
