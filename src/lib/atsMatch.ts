// Deterministic keyword-presence check — no LLM call. Used by the pre-tailoring
// ATS gate to give a rough "X/15 keywords found in your CV as-is" estimate
// before spending on the full 8-step tailoring pipeline.
//
// This is intentionally cruder than the real ATS_SCORING_PROMPT step (which
// judges the TAILORED output with LLM reasoning about paraphrase/context). This
// only checks the RAW master CV, so the two numbers are expected to differ.
//
// WHY TOKEN-BASED, NOT SUBSTRING-BASED:
// The JD analyzer returns descriptive PHRASES ("Microservices architecture",
// "Code review and mentoring"), not bare tokens. A whole-phrase substring test
// missed almost everything — a CV containing all of "code", "review" and
// "mentoring" still failed "Code review and mentoring" because the words were
// not contiguous. Real CVs scored ~3/15 when the honest answer was ~10/15.
//
// Raw substring matching was ALSO wrong in the other direction: "Java" matched
// a CV that only mentions "JavaScript". All comparisons here are therefore on
// whole tokens, never substrings.

export type AtsMatchResult = {
  matched: number;
  total: number;
  matchedKeywords: string[];
  missedKeywords: string[];
};

// Grammatical filler — carries no signal about what someone can do.
const STOP_WORDS = [
  "and", "or", "the", "a", "an", "of", "for", "with", "in", "on", "to", "at", "by",
  "using", "used", "use", "strong", "good", "excellent", "solid", "proven",
  "experience", "experienced", "knowledge", "skills", "skill", "ability", "years",
  "year", "plus", "etc", "including", "such", "as", "e", "g", "eg", "ie", "or",
];

// Structural nouns that describe the SHAPE of work rather than a specific
// competency. These are what made "Embedded systems design" match a CV that
// merely said "System Design" — the real signal is "embedded", not the filler.
// A keyword matches on its non-generic terms; generic ones only count when the
// phrase is nothing but generic terms.
const GENERIC_TERMS = [
  "system", "design", "development", "developing", "developer", "architecture",
  "management", "managing", "service", "pipeline", "orchestration", "optimization",
  "optimisation", "methodology", "methodologies", "practice", "principle", "tool",
  "tooling", "framework", "technology", "technologies", "platform", "solution",
  "environment", "application", "software", "engineering", "engineer", "control",
  "version", "based", "driven", "level", "stack", "process", "delivery", "support",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Very light singular/plural folding so "systems" matches "system" and
// "pipelines" matches "pipeline". Deliberately not a real stemmer — anything
// more aggressive starts producing false positives.
function fold(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

const STOP_SET = new Set(STOP_WORDS.map(fold));
const GENERIC_SET = new Set(GENERIC_TERMS.map(fold));

function meaningfulTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter(Boolean)
    .map(fold)
    .filter((t) => t.length > 1 && !STOP_SET.has(t));
}

export function matchAtsKeywords(cvText: string, keywords: unknown): AtsMatchResult {
  const list = Array.isArray(keywords)
    ? keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "")
    : [];

  const cvNormalized = normalize(cvText || "");
  // Padded so containment checks land on whole-word boundaries.
  const cvPadded = ` ${cvNormalized} `;
  const cvTokens = new Set(cvNormalized.split(" ").filter(Boolean).map(fold));

  const matchedKeywords: string[] = [];
  const missedKeywords: string[] = [];

  for (const keyword of list) {
    const tokens = meaningfulTokens(keyword);

    // A keyword made only of stop words ("and", "the") can never be evidence
    // of a skill, however often those words appear in the CV.
    if (tokens.length === 0) {
      missedKeywords.push(keyword);
      continue;
    }

    const kwNormalized = normalize(keyword);

    // 1. Whole phrase present as whole words — unambiguous hit.
    //    Padded containment, so "java" cannot match inside "javascript".
    let found = kwNormalized !== "" && cvPadded.includes(` ${kwNormalized} `);

    if (!found) {
      // 2. The phrase's SPECIFIC terms, ignoring structural filler. If any of
      //    them is in the CV, the candidate has the thing the keyword is about
      //    ("Docker" in "Docker containerization", "Kafka" in "Apache Kafka").
      //    This deliberately does not require the first token: the real term is
      //    often last ("Apache Kafka", "Google Cloud Platform").
      const specific = tokens.filter((t) => !GENERIC_SET.has(t));

      if (specific.length > 0) {
        found = specific.some((t) => cvTokens.has(t));
      } else {
        // 3. Phrase is entirely generic ("System Design"). Only a full match of
        //    every term counts, otherwise it would match almost any CV.
        found = tokens.every((t) => cvTokens.has(t));
      }
    }

    (found ? matchedKeywords : missedKeywords).push(keyword);
  }

  return { matched: matchedKeywords.length, total: list.length, matchedKeywords, missedKeywords };
}
