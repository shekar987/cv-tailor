// Per-JD selection from the user's stored project/skill repository.
//
// SELECTION ONLY — this module never writes, rewrites, paraphrases or
// summarises anything. It ranks the user's OWN stored text against the JD
// analysis and returns a subset, unchanged. The existing Step 4 (Skills) and
// Step 6 (Projects) prompts then tailor that subset exactly as they do today,
// under their existing integrity rules.
//
// Why this is deterministic rather than an LLM call:
//   - Cost: it runs on every tailor, and the ATS pre-check gate exists to
//     REDUCE spend. A selection call would put that back.
//   - Honesty: ranking cannot embellish. Because selection only reorders and
//     filters stored strings, there is no step at which JD vocabulary could be
//     grafted onto work the candidate didn't do (rule 6). An LLM selector would
//     need its own guardrails for that; this one is safe by construction.

export type StoredProject = {
  id: string;
  project_name: string;
  tech_stack: string;
  links: unknown;
  bullets: unknown;
};

export type StoredSkill = {
  id: string;
  skill: string;
  category: "functional" | "technical";
};

export const MAX_SELECTED_PROJECTS = 3;
export const MIN_SELECTED_PROJECTS = 2;
export const MAX_SKILLS_PER_CATEGORY = 20;

// Tokens too generic to signal relevance — matching on these would rank
// everything equally and drown out the real signal.
const STOP_TOKENS = new Set([
  "and", "or", "the", "a", "an", "of", "for", "with", "in", "on", "to", "at", "by",
  "using", "used", "use", "experience", "strong", "good", "excellent", "knowledge",
  "skills", "ability", "work", "working", "years", "year", "plus", "etc",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

/**
 * Weighted keyword set from the JD analysis. required_skills matter more than
 * general ATS keywords, so a project matching a mandatory skill outranks one
 * matching an incidental buzzword.
 */
function buildJdTerms(analysis: unknown): { phrase: string; weight: number }[] {
  const a = (analysis ?? {}) as Record<string, unknown>;
  const required = Array.isArray(a.required_skills) ? a.required_skills : [];
  const keywords = Array.isArray(a.top_15_ats_keywords) ? a.top_15_ats_keywords : [];
  const niceToHave = Array.isArray(a.nice_to_have_skills) ? a.nice_to_have_skills : [];

  const terms: { phrase: string; weight: number }[] = [];
  const push = (list: unknown[], weight: number) => {
    for (const entry of list) {
      if (typeof entry === "string" && entry.trim()) terms.push({ phrase: entry.trim(), weight });
    }
  };
  push(required, 3);
  push(keywords, 2);
  push(niceToHave, 1);
  return terms;
}

// Score one piece of stored text against the weighted JD terms.
// Whole-phrase matches score full weight; otherwise partial credit for the
// share of the phrase's meaningful tokens that appear.
function scoreText(haystack: string, terms: { phrase: string; weight: number }[]): number {
  if (!haystack.trim() || terms.length === 0) return 0;
  const normalizedHaystack = normalize(haystack);
  const haystackTokens = new Set(normalizedHaystack.split(" "));

  let score = 0;
  for (const { phrase, weight } of terms) {
    const normalizedPhrase = normalize(phrase);
    if (!normalizedPhrase) continue;

    if (normalizedHaystack.includes(normalizedPhrase)) {
      score += weight;
      continue;
    }
    const phraseTokens = tokenize(phrase);
    if (phraseTokens.length === 0) continue;
    const hits = phraseTokens.filter((t) => haystackTokens.has(t)).length;
    if (hits > 0) score += weight * (hits / phraseTokens.length) * 0.5;
  }
  return score;
}

function bulletsToText(bullets: unknown): string {
  if (!Array.isArray(bullets)) return "";
  return bullets.filter((b): b is string => typeof b === "string").join(" ");
}

/**
 * Pick the 2-3 stored projects most relevant to this JD.
 *
 * Returns projects UNMODIFIED — same name, tech stack, links and bullets the
 * user stored. Ties and zero-score cases fall back to stored order, so a user
 * whose projects don't obviously match the JD still gets their projects rather
 * than an empty section.
 */
export function selectProjectsForJd(
  projects: StoredProject[],
  analysis: unknown
): StoredProject[] {
  if (!Array.isArray(projects) || projects.length === 0) return [];
  if (projects.length <= MIN_SELECTED_PROJECTS) return [...projects];

  const terms = buildJdTerms(analysis);

  const ranked = projects.map((project, index) => {
    // Tech stack is the strongest relevance signal for a project, then the
    // bullets, then the name.
    const score =
      scoreText(project.tech_stack || "", terms) * 2 +
      scoreText(bulletsToText(project.bullets), terms) +
      scoreText(project.project_name || "", terms) * 1.5;
    return { project, score, index };
  });

  // Stable: equal scores keep the user's stored order.
  ranked.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  // Take 3 when the third is genuinely relevant, otherwise 2 — rather than
  // padding with an unrelated project just to hit a count.
  const take = ranked[MAX_SELECTED_PROJECTS - 1]?.score > 0 ? MAX_SELECTED_PROJECTS : MIN_SELECTED_PROJECTS;
  return ranked.slice(0, take).map((r) => r.project);
}

/**
 * Pick up to 20 functional and up to 20 technical skills for this JD.
 * Returns the user's stored skill strings verbatim.
 */
export function selectSkillsForJd(
  skills: StoredSkill[],
  analysis: unknown
): { functional: string[]; technical: string[] } {
  const empty = { functional: [] as string[], technical: [] as string[] };
  if (!Array.isArray(skills) || skills.length === 0) return empty;

  const terms = buildJdTerms(analysis);

  const pick = (category: StoredSkill["category"]): string[] => {
    const pool = skills.filter((s) => s?.category === category && typeof s.skill === "string" && s.skill.trim());
    if (pool.length <= MAX_SKILLS_PER_CATEGORY) return pool.map((s) => s.skill);

    return pool
      .map((s, index) => ({ skill: s.skill, score: scoreText(s.skill, terms), index }))
      // Stable sort: unmatched skills keep stored order, so the cut is
      // predictable rather than arbitrary when nothing matches.
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .slice(0, MAX_SKILLS_PER_CATEGORY)
      .map((s) => s.skill);
  };

  return { functional: pick("functional"), technical: pick("technical") };
}

/**
 * Render selected skills into the plain-text block the Step 4 prompt already
 * expects to find in the master CV. Deliberately dumb string assembly — no
 * rewriting, no inference, just the user's own skills grouped by their own
 * category labels.
 */
export function formatSelectedSkills(selected: { functional: string[]; technical: string[] }): string {
  const lines: string[] = [];
  if (selected.functional.length > 0) lines.push(`Functional Competencies: ${selected.functional.join(" | ")}`);
  if (selected.technical.length > 0) lines.push(`Technical Tools: ${selected.technical.join(" | ")}`);
  return lines.join("\n");
}
