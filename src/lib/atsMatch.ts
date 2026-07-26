// Deterministic keyword-presence check — no LLM call. Used by the pre-tailoring
// ATS gate to give a rough "X/15 keywords found in your CV as-is" estimate
// before spending on the full 8-step tailoring pipeline.
//
// This is intentionally cruder than the real ATS_SCORING_PROMPT step (which
// judges the TAILORED output with LLM reasoning about paraphrase/context). This
// only checks the RAW master CV for literal presence of each keyword, so the
// two numbers are expected to differ — the tailored CV is written to genuinely
// surface more of the real keywords the candidate already has.

export type AtsMatchResult = {
  matched: number;
  total: number;
  matchedKeywords: string[];
  missedKeywords: string[];
};

// Strips punctuation to spaces and collapses whitespace, so "CI/CD", "CI-CD"
// and "CI CD" are treated as the same token. Simple normalization, not NLP.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchAtsKeywords(cvText: string, keywords: unknown): AtsMatchResult {
  const list = Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "") : [];
  const cvLower = (cvText || "").toLowerCase();
  const cvNormalized = normalize(cvText || "");

  const matchedKeywords: string[] = [];
  const missedKeywords: string[] = [];

  for (const keyword of list) {
    const kwLower = keyword.toLowerCase().trim();
    const kwNormalized = normalize(keyword);
    const found =
      (kwLower !== "" && cvLower.includes(kwLower)) ||
      (kwNormalized !== "" && cvNormalized.includes(kwNormalized));
    (found ? matchedKeywords : missedKeywords).push(keyword);
  }

  return { matched: matchedKeywords.length, total: list.length, matchedKeywords, missedKeywords };
}
