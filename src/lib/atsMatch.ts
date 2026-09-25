// Deterministic keyword-presence check — no LLM call. This is the ONE place
// a keyword is judged present or absent in a piece of CV text. It is used by
// the pre-tailoring gate (raw master CV), by reconcileAtsScore in /api/tailor
// (the rendered tailored text — the score users see), by the Fit Score's
// hard-skill component, and by the tracker when it stores an application.
//
// WHY TOKEN-BASED, NOT SUBSTRING-BASED:
// The JD analyzer returns descriptive PHRASES ("Microservices architecture",
// "Code review and mentoring"), not bare tokens. A whole-phrase substring test
// missed almost everything — a CV containing all of "code", "review" and
// "mentoring" still failed "Code review and mentoring" because the words were
// not contiguous. Raw substring matching was ALSO wrong in the other
// direction: "Java" matched a CV that only mentions "JavaScript". All
// comparisons here are on whole tokens, never substrings.
//
// WHY EVERY SPECIFIC TOKEN, WITHIN A WINDOW (the 2026-09 audit):
// An earlier version matched a multi-word keyword when ANY one of its specific
// tokens appeared, so "Machine learning" matched a CV that only said
// "continuous learning" and "React Native" matched any React CV. That is
// score inflation, and inflation tells someone an application is strong when
// it is not. A keyword now needs ALL of its specific tokens, close together.
// The matcher is deliberately conservative: an under-match is honest and
// actionable ("say it explicitly"); an over-match is a lie on a number.
//
// WHY A CANONICAL MAP: "C#" and "C++" normalised to the single letter "c"
// (dropped as noise) and so could never match; "Node.js"/"NodeJS"/"node js"
// never compared equal. The map below fixes spellings of the SAME thing only.

export type AtsMatchResult = {
  matched: number;
  total: number;
  matchedKeywords: string[];
  missedKeywords: string[];
};

// ── Canonical naming variants ────────────────────────────────────────────────
// Applied to BOTH sides, lowercased, BEFORE symbols are stripped. Every entry
// is a different spelling of the same thing — never a related concept. "ml"
// is not "machine learning", "ts" is not TypeScript, bare "node" is not
// Node.js (Kubernetes has nodes), "go"/"golang" is left alone: a generous map
// would re-create exactly the inflation this module exists to prevent. Order
// matters — the "*.js" framework rules run before the bare "js" rule.
const CANONICAL: [RegExp, string][] = [
  [/\bc#/g, "csharp "],
  [/\bc\+\+/g, "cplusplus "],
  [/\bcpp\b/g, "cplusplus"],
  [/\bobjective[\s-]?c\b/g, "objectivec"],
  [/\.net\b/g, " dotnet"],
  [/\bdot\s?net\b/g, "dotnet"],
  [/\bnode[\s.]?js\b/g, "nodejs"],
  [/\breact[\s.]?js\b/g, "react"],
  [/\bnext[\s.]?js\b/g, "nextjs"],
  [/\bvue[\s.]?js\b/g, "vue"],
  [/\bexpress[\s.]?js\b/g, "express"],
  [/\bjs\b/g, "javascript"],
  [/\bpostgres(?:ql)?\b/g, "postgresql"],
  [/\bmongo(?:\s?db)?\b/g, "mongodb"],
  [/\bk8s\b/g, "kubernetes"],
  // The acronym spelled out is the same skill — for scoring and for the
  // claims check (a rewrite must not keep a project-level RAG as prose).
  [/\bretrieval[\s-]augmented[\s-]generation\b/g, "rag"],
  [/\bamazon web services\b/g, "aws"],
  [/\bgoogle cloud(?: platform)?\b/g, "gcp"],
  [/\bmicrosoft azure\b/g, "azure"],
  [/\bci\s*[/-]?\s*cd\b/g, "cicd"],
  [/\bcontinuous (?:integration|delivery|deployment)\b/g, "cicd"],
  [/\brestful\b/g, "rest"],
  [/\bfront[\s-]?end\b/g, "frontend"],
  [/\bback[\s-]?end\b/g, "backend"],
  [/\bfull[\s-]?stack\b/g, "fullstack"],
  [/\bmicro[\s-]services?\b/g, "microservices"],
  [/\bdev[\s-]?ops\b/g, "devops"],
  [/\ba\/b\b/g, "ab"],
  [/\biac\b/g, "infrastructure as code"],
];

function canonicalize(lower: string): string {
  let out = lower;
  for (const [re, to] of CANONICAL) out = out.replace(re, to);
  return out;
}

// Grammatical filler and requirement-speak — carries no signal about what
// someone can do. ("Hands-on experience required" is not a skill.)
const STOP_WORDS = [
  "and", "or", "the", "a", "an", "of", "for", "with", "in", "on", "to", "at", "by",
  "using", "used", "use", "strong", "good", "excellent", "solid", "proven",
  "experience", "experienced", "knowledge", "skills", "skill", "ability", "years",
  "year", "plus", "etc", "including", "such", "as", "e", "g", "eg", "ie",
  "expert", "expertise", "proficient", "proficiency", "familiar", "familiarity",
  "understanding", "background", "hands", "working", "work", "deep", "advanced",
  "basic", "senior", "junior", "commercial", "demonstrable", "demonstrated",
  "track", "record", "minimum", "least", "must", "have", "required", "preferred",
  "desirable", "bonus", "willingness", "able", "team", "teams",
];

// Structural nouns that describe the SHAPE of work, or ride beside a named
// technology, rather than naming a competency. "Docker containerization" is
// about Docker; "GraphQL APIs" is about GraphQL. A keyword matches on its
// non-generic terms; generic ones only count when the phrase is nothing but
// generic terms ("System design"). NOT here on purpose: "cloud", "testing",
// "security", "infrastructure" — those are the substance of real keywords.
const GENERIC_TERMS = [
  "system", "design", "development", "developing", "developer", "architecture",
  "management", "managing", "service", "pipeline", "orchestration", "optimization",
  "optimisation", "methodology", "methodologies", "practice", "principle", "tool",
  "tooling", "framework", "technology", "technologies", "platform", "solution",
  "environment", "application", "software", "engineering", "engineer", "control",
  "version", "based", "driven", "level", "stack", "process", "delivery", "support",
  "api", "apis", "database", "databases", "container", "containers",
  "containerization", "containerisation", "containerized", "library", "libraries",
  "automation", "automated", "automating", "programming", "implementation",
  "implement", "language", "languages", "technique", "techniques", "concept",
  "concepts", "fundamental", "fundamentals", "best", "modern", "caching",
  "deployment", "deploy", "deployed", "deploying", "monitoring", "integration",
  "integrations",
];

// Vendor prefixes that don't change what the thing is: "Apache Kafka" is
// Kafka. Cloud vendors are handled by the canonical map instead.
const QUALIFIER_TERMS = ["apache", "google", "amazon", "microsoft", "adobe", "oracle", "hashicorp", "atlassian"];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Light morphology so "tests"/"testing"/"tested" agree with "test" and
// "learning" with "learn". Deliberately not a real stemmer — both sides fold
// identically, which is all that matters ("spring" and "string" fold to "spr"
// and "str" on both sides and collide with nothing).
function dedouble(w: string): string {
  const n = w.length;
  if (n >= 2 && w[n - 1] === w[n - 2] && !"lsz".includes(w[n - 1])) return w.slice(0, -1);
  return w;
}
function fold(token: string): string {
  let w = token;
  if (w.length >= 5 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length >= 6 && w.endsWith("ing")) w = dedouble(w.slice(0, -3));
  else if (w.length >= 5 && w.endsWith("ed")) w = dedouble(w.slice(0, -2));
  if (w.length >= 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const STOP_SET = new Set(STOP_WORDS.map(fold));
const GENERIC_SET = new Set(GENERIC_TERMS.map(fold));
const QUALIFIER_SET = new Set(QUALIFIER_TERMS.map(fold));

function foldedTokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean).map(fold);
}

function meaningfulTokens(text: string): string[] {
  return foldedTokens(text).filter((t) => t.length > 1 && !STOP_SET.has(t));
}

// The CV, indexed once: every folded token's positions in the global token
// sequence (not per line — CVs are hard-wrapped, so phrases straddle lines).
type CvIndex = { padded: string; positions: Map<string, number[]> };

function indexCv(text: string): CvIndex {
  const tokens = foldedTokens(canonicalize((text || "").toLowerCase()));
  const positions = new Map<string, number[]>();
  tokens.forEach((t, i) => {
    const list = positions.get(t);
    if (list) list.push(i);
    else positions.set(t, [i]);
  });
  return { padded: ` ${tokens.join(" ")} `, positions };
}

// Every term present, and all of them inside `window` consecutive tokens.
// One filler token between terms is allowed ("machine and learning"); two
// mentions three lines apart ("state machine … continuous learning") are not.
function allWithinWindow(terms: string[], cv: CvIndex): boolean {
  const unique = [...new Set(terms)];
  const lists = unique.map((t) => cv.positions.get(t));
  if (lists.some((l) => !l)) return false;
  if (unique.length === 1) return true;
  const window = unique.length + 1;
  const [anchors, ...rest] = lists as number[][];
  return anchors.some((p) => {
    let lo = p;
    let hi = p;
    for (const list of rest) {
      let nearest = list[0];
      for (const q of list) if (Math.abs(q - p) < Math.abs(nearest - p)) nearest = q;
      lo = Math.min(lo, nearest);
      hi = Math.max(hi, nearest);
    }
    return hi - lo < window;
  });
}

// One alternative of a keyword ("Scrum" in "Agile/Scrum"). Already canonical.
function matchAlternative(alt: string, cv: CvIndex): boolean {
  const tokens = meaningfulTokens(alt);
  // A phrase made only of filler ("hands-on experience") can never be evidence
  // of a skill, however often those words appear in the CV.
  if (tokens.length === 0) return false;

  // 1. Whole phrase present as whole words, folded on both sides — unambiguous.
  //    Padded containment, so "java" cannot match inside "javascript".
  const phrase = foldedTokens(alt).join(" ");
  if (phrase && cv.padded.includes(` ${phrase} `)) return true;

  // 2. The phrase's SPECIFIC terms, ignoring structural filler and vendor
  //    prefixes, must ALL be present, close together.
  const specific = tokens.filter((t) => !GENERIC_SET.has(t) && !QUALIFIER_SET.has(t));
  if (specific.length > 0) return allWithinWindow(specific, cv);

  // 3. Nothing but generic terms ("System design"): every one of them, close
  //    together. A qualifier-only remainder ("Microsoft Teams") is a miss.
  const generic = tokens.filter((t) => GENERIC_SET.has(t));
  return generic.length > 0 && allWithinWindow(generic, cv);
}

// "Code review and mentoring" → both halves must hit; "Agile/Scrum",
// "AWS (Lambda, S3)", "Java or Kotlin" → any listed option hits. Splitting
// happens AFTER canonicalisation so "CI/CD" is never cut at its slash.
function matchKeyword(keyword: string, cv: CvIndex): boolean {
  const canon = canonicalize(keyword.toLowerCase());
  const conjuncts = canon.split(/\s+(?:and|&)\s+/).map((c) => c.trim()).filter(Boolean);
  if (conjuncts.length === 0) return false;
  return conjuncts.every((conjunct) => {
    const alternatives = conjunct
      .split(/\s*(?:\/|,|;|\(|\)|\bor\b)\s*/)
      .map((a) => a.trim())
      .filter(Boolean);
    return alternatives.length > 0 && alternatives.some((a) => matchAlternative(a, cv));
  });
}

export function matchAtsKeywords(cvText: string, keywords: unknown): AtsMatchResult {
  const list = Array.isArray(keywords)
    ? keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "")
    : [];
  const cv = indexCv(cvText);

  const matchedKeywords: string[] = [];
  const missedKeywords: string[] = [];
  for (const keyword of list) {
    (matchKeyword(keyword, cv) ? matchedKeywords : missedKeywords).push(keyword);
  }
  return { matched: matchedKeywords.length, total: list.length, matchedKeywords, missedKeywords };
}

// The tailored document as one text, exactly as the scorer sees it: the
// three prose sections plus every project bullet. Shared by reconcileAtsScore
// (the score shown after a run) and the tracker (the score stored with an
// application), so the two can never compute from different text.
export function tailoredSectionsText(sections: {
  summary?: unknown;
  skills?: unknown;
  experience?: unknown;
  projects?: unknown;
}): string {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const projectText = Object.values(
    (sections.projects && typeof sections.projects === "object" ? sections.projects : {}) as Record<string, unknown>
  )
    .flatMap((v) => (Array.isArray(v) ? v.filter((b): b is string => typeof b === "string") : []))
    .join("\n");
  return [str(sections.summary), str(sections.skills), str(sections.experience), projectText].filter(Boolean).join("\n");
}
