// The claims registry — the candidate's own statement of what each skill can
// honestly be called, and a deterministic check that generated output stays
// inside it.
//
// The pipeline treats the master CV as ground truth, so a claim the candidate
// can't defend propagates into every CV, letter and cold email. The registry
// tags each skill production / project / learning; tailoring may describe a
// skill only at or below its level, and a `learning` skill never appears in
// any output. Quantified achievements are not stored: a figure is
// "registered" when it appears in the master CV (or project pool), read at
// check time by the same extractFigures() — nothing to go stale.
//
// Seeded deterministically from the CV itself (seedClaimsFromCv) on the
// first visit and after every extraction, so the registry is never empty
// for a user with a CV. The check BLOCKS downloads as soon as levels exist
// (mode "enforce"): a figure absent from the CV, a learning skill named, or
// a project-only skill claimed above its level. "Confirm levels" is a
// review. Only a user with no CV at all is in mode "warn".
//
// Import-free apart from the keyword matcher (relative, with the extension
// Node's test runner needs), so it runs identically on the server, in the
// browser (the live re-check) and under node:test.

import { matchAtsKeywords } from "./atsMatch.ts";

export type ClaimLevel = "production" | "project" | "learning";
export type ClaimSkill = { name: string; level: ClaimLevel; confirmed: boolean };
export type ClaimsRegistry = {
  version: 1;
  skills: ClaimSkill[];
  // Set by "Confirm levels"; enforce mode from then on.
  confirmedAt: string | null;
  // Fingerprint of the CV text the seed came from, so the UI can say when a
  // re-extraction would refresh the list.
  seededFrom: string | null;
};
export type ClaimMode = "warn" | "enforce";

export const MAX_CLAIM_SKILLS = 80;
export const MAX_SKILL_NAME = 60;
const LEVELS: readonly ClaimLevel[] = ["production", "project", "learning"];

// ── Registry shape ───────────────────────────────────────────────────────────

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Skill names compare after the same folding the matcher applies to CV text,
// so "Node.js" and "NodeJS" are one skill.
export function skillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\.js\b/g, "js")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

export function normalizeSkillGuesses(v: unknown): { name: string; level: ClaimLevel }[] {
  if (!Array.isArray(v)) return [];
  const out: { name: string; level: ClaimLevel }[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const g = obj(raw);
    // The same cleaning the CV's own lists get: no version suffix ("React
    // 19" is React), no group label, and a "JWT / OAuth 2.0 / RBAC" guess is
    // three skills, not one.
    const raw0 = typeof g.name === "string" ? g.name.trim().replace(/\s+/g, " ").slice(0, MAX_SKILL_NAME) : "";
    const parts = raw0.split(/\s+\/\s+/).map((p) => cleanSkill(p)).filter((p) => p.length >= 2 && !GROUP_LABEL_RE.test(p));
    if (parts.length > 1) {
      for (const p of parts) {
        const pk = skillKey(p);
        if (!pk || seen.has(pk)) continue;
        seen.add(pk);
        out.push({ name: p, level: (LEVELS as readonly string[]).includes(g.level as string) ? (g.level as ClaimLevel) : "project" });
      }
      continue;
    }
    const name = parts[0] ?? "";
    if (!name) continue;
    const k = skillKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    // An unrecognised level is never promoted: project is the safe default.
    const level = (LEVELS as readonly string[]).includes(g.level as string) ? (g.level as ClaimLevel) : "project";
    out.push({ name, level });
    if (out.length >= MAX_CLAIM_SKILLS) break;
  }
  return out;
}

export function normalizeClaims(v: unknown): ClaimsRegistry | null {
  const r = obj(v);
  if (!Array.isArray(r.skills)) return null;
  const skills: ClaimSkill[] = [];
  const seen = new Set<string>();
  for (const raw of r.skills) {
    const s = obj(raw);
    const name = typeof s.name === "string" ? s.name.trim().replace(/\s+/g, " ").slice(0, MAX_SKILL_NAME) : "";
    if (!name) continue;
    const k = skillKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    skills.push({
      name,
      level: (LEVELS as readonly string[]).includes(s.level as string) ? (s.level as ClaimLevel) : "project",
      confirmed: s.confirmed === true,
    });
    if (skills.length >= MAX_CLAIM_SKILLS) break;
  }
  return {
    version: 1,
    skills,
    confirmedAt: typeof r.confirmedAt === "string" ? r.confirmedAt : null,
    seededFrom: typeof r.seededFrom === "string" ? r.seededFrom : null,
  };
}

// Blocking as soon as levels exist. The registry is seeded from the CV
// itself (seedClaimsFromCv), so an empty registry is never the resting
// state and "confirm" is a review, not the switch that turns the check on.
export function claimMode(r: ClaimsRegistry | null | undefined): ClaimMode {
  return r && r.skills.length > 0 ? "enforce" : "warn";
}

// djb2 over whitespace-normalized text — stable, short, no crypto import.
export function cvFingerprint(text: string): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0") + t.length.toString(16);
}

// ── Seeding and merging ──────────────────────────────────────────────────────

// Lines of the CV that describe skills still being learned. Any skill named
// on one of them is `learning`, whatever the model guessed — the CV's own
// framing wins.
const LEARNING_LINE_RE =
  /\b(?:currently\s+(?:studying|learning|developing|exploring)|learning|studying|familiar\s+with|exposure\s+to|coursework|basic\s+(?:knowledge|understanding)|beginner|self[- ]teaching|reading\s+up\s+on|working\s+towards|in\s+progress)\b/i;
const LEARNING_HEADING_RE = /^\s*(?:currently\s+)?(?:studying|learning|developing)\b[^a-z]*$/i;
const HEADING_RE = /^\s*(?:[A-Z][A-Z\s&/-]{2,40}|[A-Z][\w\s&/-]{2,40}):?\s*$/;

// "Machine Learning (NPTEL)", "Deep Learning" and the like are subjects, not
// a statement that something is still being learned.
const LEARNING_AS_SUBJECT_RE = /\b(?:machine|deep|reinforcement|transfer|supervised|unsupervised|self-supervised|federated|active|continual|online|lifelong|e)[\s-]?learning\b/gi;

export function learningText(cvText: string): string {
  const lines = (cvText || "").split(/\r?\n/);
  const out: string[] = [];
  let underLearningHeading = false;
  for (const line of lines) {
    const t = line.trim().replace(LEARNING_AS_SUBJECT_RE, "");
    if (!t) continue;
    if (HEADING_RE.test(t) && t.length <= 45) {
      underLearningHeading = LEARNING_HEADING_RE.test(t);
      if (underLearningHeading) out.push(t);
      continue;
    }
    if (underLearningHeading || LEARNING_LINE_RE.test(t)) out.push(t);
  }
  return out.join("\n");
}

// ── Deterministic seed from the CV itself ────────────────────────────────────
//
// Every skill the CV names in its skills section (and in a project's tech
// line) gets an inferred level from where the CV shows it used: production
// when it appears in the work-experience section, project when it appears
// only under Projects, project (the safe floor) when it is only listed. A
// "currently studying" line still wins (seedClaims). Achievement sentences
// are never mined for claims - "Analysed 11 industry asset-management
// platforms" names no skill - so extraction stays in the skills section and
// tech lines. Nothing is promoted above what the CV evidences.

type CvSection = "skills" | "experience" | "projects" | "other";
const SKILLS_HEADING_RE = /^(?:(?:technical|core|key)\s+)?(?:skills|competencies|technologies|tools|tech(?:nical)?\s+stack|toolkit)\b/i;
const EXPERIENCE_HEADING_RE = /^(?:(?:work|professional|relevant)\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?)\b/i;
const PROJECTS_HEADING_RE = /^(?:(?:personal|selected|key|side)\s+)?projects?\b|^portfolio\b/i;
const TECH_LINE_PREFIX_RE = /^(?:tech(?:nologies)?|stack|tech\s+stack|built\s+with|tools)\s*:\s*/i;
const LINK_LINE_RE = /^(?:live|github|demo|url|link|repo)\b|https?:\/\//i;
const SPLIT_RE = /\s*(?:[|·•;,]|\s\/\s)\s*/;
const NOT_A_SKILL_RE = /^(?:and|or|etc\.?|others?|more|various|including|e\.g\.?|i\.e\.?|with|using|via)$/i;
// A group label, not a skill: "Auth (JWT, OAuth 2.0, RBAC)" registers JWT,
// OAuth 2.0 and RBAC — the items a recruiter searches for — never "Auth".
// The same words alone ("RLS", "Security") are dropped for the same reason:
// a registry entry nobody would claim or search is only noise to confirm.
const GROUP_LABEL_RE =
  /^(?:auth|authentication|authori[sz]ation|security|rls|row[-\s]level security|tools?|tooling|other|others|misc|miscellaneous|frameworks?|libraries|languages?|databases?|cloud|testing|devops|methodologies|concepts|core|stack|platforms?|infrastructure|services|apis?|backend|frontend|full[-\s]?stack|web|mobile|data|ai|ml)$/i;

// An inline "Skills: Python, Django" line counts as the skills section even
// on a CV with no headings at all; so does "Currently studying: X", whose
// items must be in the registry (as learning) to be forbidden in output.
const INLINE_SKILLS_RE = /^(?:(?:technical|core|key)\s+)?(?:skills|technologies|tools|tech(?:nical)?\s+stack)\s*:\s*\S|^(?:currently\s+)?(?:studying|learning)\s*:\s*\S/i;

const KNOWN_HEADING_RE =
  /^(?:(?:professional\s+)?summary|profile|objective|about(?:\s+me)?|(?:technical|core|key)?\s*(?:skills|competencies|technologies|tools)|tech(?:nical)?\s+stack|(?:work|professional|relevant)?\s*experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?|(?:personal|selected|key|side)?\s*projects?|portfolio|education|academic\s+background|qualifications|certifications?|certificates|awards|honou?rs|publications|languages|interests|volunteering|references|right\s+to\s+work|work\s+authori[sz]ation)\b/i;

function sectionsOf(cvText: string): Record<CvSection, string[]> {
  const out: Record<CvSection, string[]> = { skills: [], experience: [], projects: [], other: [] };
  let current: CvSection = "other";
  // A known section heading ("SKILLS", "CERTIFICATIONS") means the CV is
  // sectioned; a name line in capitals ("SMOKE TESTER") does not.
  let sectioned = false;
  for (const raw of (cvText || "").split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (HEADING_RE.test(t) && t.length <= 45) {
      const h = t.replace(/:$/, "");
      current = SKILLS_HEADING_RE.test(h) ? "skills" : EXPERIENCE_HEADING_RE.test(h) ? "experience" : PROJECTS_HEADING_RE.test(h) ? "projects" : "other";
      if (current !== "other" || KNOWN_HEADING_RE.test(h)) sectioned = true;
      continue;
    }
    if (current !== "skills" && INLINE_SKILLS_RE.test(t)) {
      out.skills.push(t);
      continue;
    }
    out[current].push(t);
  }
  // A CV with no section headings at all: whatever is not a skills line is
  // where its work history lives. A sectioned CV without EXPERIENCE
  // (certifications and education only) evidences no production use.
  if (!sectioned && out.experience.length === 0 && out.projects.length === 0) out.experience = out.other;
  return out;
}

// "Next.js 16" and "Python 3" name the tool, not the version.
const VERSION_SUFFIX_RE = /\s+v?\d+(?:\.\d+)*\+?$/;

function cleanSkill(s: string): string {
  return s.replace(/^[\s(]+|[\s)]+$/g, "").replace(VERSION_SUFFIX_RE, "").trim();
}

function splitSkillItems(line: string): string[] {
  const items: string[] = [];
  // Bracketed lists first, before any comma inside them can split the line:
  // "SQL (PostgreSQL, MySQL)" names SQL and each item inside.
  const rest = line.replace(/([^()|·•;,]+?)\s*\(([^()]+)\)/g, (_m, outer: string, inner: string) => {
    // The label stays only when it is a skill in its own right ("SQL
    // (PostgreSQL, MySQL)"); a group word ("Auth (JWT, OAuth 2.0)") does not.
    const label = cleanSkill(outer);
    if (!GROUP_LABEL_RE.test(label)) items.push(label);
    for (const i of inner.split(SPLIT_RE)) items.push(cleanSkill(i));
    return " · ";
  });
  for (const piece of rest.split(SPLIT_RE)) items.push(cleanSkill(piece));
  return items.filter(
    (s) => s.length >= 2 && s.length <= MAX_SKILL_NAME && /[a-z]/i.test(s) && !NOT_A_SKILL_RE.test(s) && !GROUP_LABEL_RE.test(s)
  );
}

export function skillsFromCv(cvText: string): { name: string; level: ClaimLevel }[] {
  const sec = sectionsOf(cvText);
  const names: string[] = [];
  for (const line of sec.skills) {
    // "Core: Python · FastAPI" - a short label before the first colon.
    const body = /^[^:|·•;,]{1,40}:\s*/.test(line) ? line.replace(/^[^:|·•;,]{1,40}:\s*/, "") : line;
    names.push(...splitSkillItems(body));
  }
  for (const line of sec.projects) {
    if (/^[•\-*]\s/.test(line) || LINK_LINE_RE.test(line) || /\b(?:19|20)\d{2}\b/.test(line)) continue;
    const isTech = TECH_LINE_PREFIX_RE.test(line) || (line.split(",").length >= 3 && line.length <= 200);
    if (isTech) names.push(...splitSkillItems(line.replace(TECH_LINE_PREFIX_RE, "")));
  }
  const experience = sec.experience.join("\n");
  const projects = sec.projects.join("\n");
  const seen = new Set<string>();
  const out: { name: string; level: ClaimLevel }[] = [];
  for (const name of names) {
    const k = skillKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const level: ClaimLevel = experience && matchAtsKeywords(experience, [name]).matched > 0 ? "production" : "project";
    void projects;
    out.push({ name, level });
    if (out.length >= MAX_CLAIM_SKILLS) break;
  }
  return out;
}

// The seed the pages use: the CV's own skills with evidenced levels, plus
// any skill the extraction model named that the CV's lists did not, held at
// or below what the experience section evidences (never promoted).
export function seedClaimsFromCv(cvText: string, modelGuesses: { name: string; level: ClaimLevel }[] = []): ClaimsRegistry {
  const det = skillsFromCv(cvText);
  const seen = new Set(det.map((s) => skillKey(s.name)));
  const experience = sectionsOf(cvText).experience.join("\n");
  const extra: { name: string; level: ClaimLevel }[] = [];
  for (const g of normalizeSkillGuesses(modelGuesses)) {
    const k = skillKey(g.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const evidenced = experience && matchAtsKeywords(experience, [g.name]).matched > 0;
    extra.push({ name: g.name, level: g.level === "learning" ? "learning" : evidenced ? "production" : "project" });
  }
  return seedClaims(cvText, [...det, ...extra]);
}

export function seedClaims(cvText: string, guesses: { name: string; level: ClaimLevel }[]): ClaimsRegistry {
  const learning = learningText(cvText);
  const skills: ClaimSkill[] = normalizeSkillGuesses(guesses).map((g) => {
    const onLearningLine = learning ? matchAtsKeywords(learning, [g.name]).matched > 0 : false;
    return { name: g.name, level: onLearningLine ? "learning" : g.level, confirmed: false };
  });
  return { version: 1, skills, confirmedAt: null, seededFrom: cvFingerprint(cvText) };
}

// Re-seeding after a CV change: confirmed levels survive for skills still on
// the CV; new skills arrive unconfirmed; skills no longer on the CV drop out;
// the registry stays confirmed (enforce mode) if it was.
export function mergeClaims(existing: ClaimsRegistry | null, seed: ClaimsRegistry): ClaimsRegistry {
  if (!existing) return seed;
  const byKey = new Map(existing.skills.map((s) => [skillKey(s.name), s]));
  const skills: ClaimSkill[] = seed.skills.map((s) => {
    const prev = byKey.get(skillKey(s.name));
    if (!prev) return s;
    if (prev.confirmed) return { name: prev.name, level: prev.level, confirmed: true };
    // Unconfirmed: the CV's own "learning" framing still wins.
    return { name: prev.name, level: s.level === "learning" ? "learning" : prev.level, confirmed: false };
  });
  return { version: 1, skills, confirmedAt: existing.confirmedAt, seededFrom: seed.seededFrom };
}

// ── Prompt block ─────────────────────────────────────────────────────────────

// A forbidden skill is a reason to leave it out, never a reason to refuse:
// the first paid run of this block saw the model answer "I cannot produce a
// tailored CV for this role" when the JD's core requirement was a learning
// skill. The output must always be the requested section.
const NEVER_REFUSE =
  "A job asking for a forbidden or absent skill is NOT a reason to refuse, apologise, or write commentary about the gap - leave that skill out, do not mention that it is being studied, and lead with the candidate's genuine strengths. Output only the section requested, always.";

export const DEFAULT_CLAIMS_BLOCK =
  `- FORBIDDEN: any skill the master CV lists under a "currently studying", "learning", "familiar with", "exposure to" or similar heading or phrase - omit it entirely, in every section and in the cover letter. Never present a personal-project skill as work experience.
- ${NEVER_REFUSE}`;

// A model step that answered with a refusal or meta-commentary instead of
// the section. Treated like a failed step (empty), so the partial-failure
// notice shows instead of the refusal rendering as a CV.
export function looksLikeRefusal(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const head = text.trim().slice(0, 160).toLowerCase();
  return /^(?:i(?:'m| am)? (?:cannot|can't|unable|won't|will not|am unable)|i (?:cannot|can't|won't)|unable to (?:produce|write|create|tailor)|sorry,|i apologi[sz]e|as an ai\b|i (?:must|need to) (?:decline|flag)|this (?:cv|candidate) (?:cannot|does not|doesn't) )/.test(head);
}

export function renderClaimsBlock(r: ClaimsRegistry | null | undefined): string {
  if (!r || r.skills.length === 0) return DEFAULT_CLAIMS_BLOCK;
  const list = (level: ClaimLevel) => r.skills.filter((s) => s.level === level).map((s) => s.name);
  const production = list("production");
  const project = list("project");
  const learning = list("learning");
  const lines = [
    "CLAIMS REGISTRY - the candidate's own statement of what each skill can honestly be called. It is checked deterministically after you write:",
  ];
  if (production.length) lines.push(`- PRODUCTION (used in paid work; may be described as experience or a competency): ${production.join(", ")}`);
  if (project.length)
    lines.push(
      `- PROJECT-ONLY (built in personal projects; write "built <project> with X" or list it under that project - NEVER "proficient in X", "experienced with X", "X years of X"): ${project.join(", ")}`
    );
  if (learning.length)
    lines.push(
      `- LEARNING - FORBIDDEN (studying, not yet used; must not appear ANYWHERE in the output: not as a skill, not hedged, not in the cover letter): ${learning.join(", ")}`
    );
  lines.push("Any skill named in the master CV but not in this registry keeps the master CV's own framing.");
  lines.push(`- ${NEVER_REFUSE}`);
  return lines.join("\n");
}

// ── Figures ──────────────────────────────────────────────────────────────────

export type Figure = {
  // Canonical key: currency + number + unit, e.g. "40%", "£2.3m", "150k user".
  key: string;
  // As written.
  text: string;
  // The sentence (or bullet) it sits in, normalized.
  sentence: string;
  index: number;
};

const UNIT_SYNONYMS: Record<string, string> = {
  percent: "%",
  thousand: "k",
  million: "m",
  mm: "m",
  billion: "bn",
  b: "bn",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  min: "min",
  mins: "min",
  minute: "min",
  minutes: "min",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  yr: "yr",
  yrs: "yr",
  year: "yr",
  years: "yr",
  repositories: "repo",
  people: "person",
  countries: "country",
  indexes: "index",
};
// Count nouns: "3 drift incidents", "8 analysts". Part of UNITS below, and
// the nouns the one-describing-word rewrite (ADJ_COUNT_RE) recognises.
const COUNT_NOUNS =
  "users?|customers?|clients?|requests?|transactions?|orders?|events?|records?|rows?|services?|microservices?|endpoints?|apis?|tests?|pipelines?|deployments?|releases?|incidents?|bugs?|reports?|dashboards?|models?|features?|repos?|repositories|projects?|servers?|nodes?|clusters?|regions?|components?|screens?|pages?|articles?|documents?|files?|candidates?|applications?|hires?|students?|members?|accounts?|devices?|vehicles?|locations?|branches?|products?|skus?|queries|jobs?|tasks?|issues?|prs?|commits?|lines?|teams?|engineers?|developers?|analysts?|journalists?|merchants?|shoppers?|templates?|libraries|alerts?|environments?|integrations?|tables?|checks?|journeys?|flows?|stages?|steps?|sprints?|systems?|platforms?|tools?|languages?|frameworks?|modules?|packages?|containers?|images?|functions?|topics?|partitions?|schemas?|indexes|migrations?|workflows?|dags?|notebooks?|experiments?|versions?|datasets?|sources?|feeds?|countries|markets?|stores?|sites?|tickets?|people";
const UNITS =
  `%|percent|x|k|m|mm|bn|b|million|billion|thousand|ms|s|sec|secs|seconds?|min|mins|minutes?|hrs?|hours?|days?|weeks?|months?|years?|yrs?|kb|mb|gb|tb|pb|qps|rps|tps|fps|${COUNT_NOUNS}`;
// Canonical (singularised) count nouns, for the noun-swap leniency in checkClaims.
const COUNT_NOUN_SET = new Set(COUNT_NOUNS.split("|").map((w) => canonicalUnit(w.replace(/\?/g, ""))));
const isCountNoun = (unit: string | undefined) => !!unit && COUNT_NOUN_SET.has(unit);
const FIGURE_RE = new RegExp(
  String.raw`(?<![a-z0-9.])(?<cur>[£$€₹]|(?:gbp|usd|eur|inr)\s?)?(?<num>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<dec>\d+))?(?<plus>\+)?\s?(?<unit>${UNITS})?(?![a-z0-9])`,
  "gi"
);
const RANGE_RE = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s?(%|percent|x|k|m|bn|ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?)(?![a-z0-9])`, "gi");
// Phone-shaped runs: digit groups joined by spaces, dots, dashes or brackets
// with at least nine digits in total. Blanked before extraction so the
// groups can't surface as figures.
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
const MONTH_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
const STOP_TOKENS = new Set([
  "reduced", "reducing", "improved", "improving", "increased", "increasing", "delivered", "delivering", "achieved", "achieving", "across",
  "using", "through", "while", "after", "before", "which", "within", "their", "that", "this", "with", "from", "into", "over", "under",
  "about", "than", "more", "less", "were", "been", "have", "also", "both", "each", "when", "where", "what", "your", "they", "them",
  "cut", "led", "built", "made", "helped", "drove", "grew", "saved", "saving", "resulting", "result", "results", "average", "around",
]);

export function normalizeFigureText(text: string): string {
  return (text || "")
    .replace(/\*\*/g, "")
    .replace(/[•▪●◦‣]/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, " ")
    // "6-million-shopper", "40-minute": the hyphen after a number hides the unit.
    .replace(/(\d)-(?=[a-z])/gi, "$1 ")
    .toLowerCase();
}

function canonicalUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (UNIT_SYNONYMS[u]) return UNIT_SYNONYMS[u];
  if (u.length > 3 && u.endsWith("ies")) return u.slice(0, -3) + "y";
  if (u.length > 3 && u.endsWith("s") && !u.endsWith("ss") && u !== "ms" && u !== "qps" && u !== "rps" && u !== "tps" && u !== "fps") return u.slice(0, -1);
  return u;
}

function sentenceAt(text: string, index: number): string {
  let start = index;
  while (start > 0 && !/[.;\n]/.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[.;\n]/.test(text[end])) end++;
  return text.slice(start, end).trim();
}

// "cut deploy time from 40 minutes to 8": the second number borrows the
// first one's unit. Written out so the CV registers "8 min", which is how
// the tailored text will state it.
const NOT_A_YEAR = String.raw`(?!(?:19|20)\d{2}(?![\d,.]))`;
// A number with optional thousands/decimal separators, never a trailing
// full stop ("to 8." must capture "8").
const NUM = String.raw`\d+(?:[,.]\d+)*`;
const FROM_TO_RE = new RegExp(
  String.raw`\bfrom\s+${NOT_A_YEAR}(${NUM})\s?(${UNITS})\s+(?:down\s+|up\s+)?to\s+${NOT_A_YEAR}(${NUM})(?![.,]?\d)(?!\s?(?:${UNITS})(?![a-z]))(?![a-z0-9])`,
  "gi"
);
// "3 drift incidents", "12 core journeys", "90+ Jest and React Testing
// Library automated tests": up to six describing words (the first never a
// unit word, none across a line break, no digits) between a number and its
// count noun still make it that count. Lazy, so the nearest count noun wins.
// A describing word starts with a letter ("e2e" is fine, another number is not).
const ADJ_COUNT_RE = new RegExp(
  String.raw`(?<![a-z0-9.])${NOT_A_YEAR}(${NUM})(\+?)[ \t]+(?!(?:${UNITS})(?![a-z]))((?:[a-z][a-z0-9/-]+[ \t]+){1,6}?)(${COUNT_NOUNS})(?![a-z])`,
  "gi"
);
const CONNECTOR_RE = /^(?:and|or|of|per|to|in|at|on|by|for|with)$/;

export function extractFigures(text: string): Figure[] {
  const norm = normalizeFigureText(text)
    .replace(PHONE_RE, (run) => ((run.match(/\d/g) ?? []).length >= 9 ? " ".repeat(run.length) : run))
    .replace(RANGE_RE, "$1$3 to $2$3")
    .replace(FROM_TO_RE, (m, a, unit, b) => `from ${a}${unit} to ${b} ${unit}`)
    .replace(ADJ_COUNT_RE, (m, n, plus, phrase, noun) => {
      const words = String(phrase).trim();
      return CONNECTOR_RE.test(words.split(/\s+/)[0]) ? m : `${n}${plus} ${noun} ${words}`;
    });
  const out: Figure[] = [];
  const seenAt = new Set<number>();
  FIGURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIGURE_RE.exec(norm)) !== null) {
    const g = m.groups as { cur?: string; num: string; dec?: string; plus?: string; unit?: string };
    const index = m.index;
    if (seenAt.has(index)) continue;
    seenAt.add(index);
    const digits = g.num.replace(/,/g, "");
    const value = parseFloat(g.dec ? `${digits}.${g.dec}` : digits);
    const cur = g.cur ? g.cur.trim().replace(/^gbp$/, "£").replace(/^usd$/, "$").replace(/^eur$/, "€").replace(/^inr$/, "₹") : "";
    const unit = g.unit ? canonicalUnit(g.unit) : "";
    const before = norm.slice(Math.max(0, index - 14), index);
    const after = norm.slice(index + m[0].length, index + m[0].length + 14);
    const prevChar = norm[index - 1] ?? "";

    // Phone numbers and long identifiers.
    if (digits.length >= 7 && !cur && !unit) continue;
    if (prevChar === "+" || /\(0$/.test(before)) continue;
    // Years and dates: a bare 4-digit year, anything beside a month name,
    // dd/mm/yyyy, mm/yyyy, yyyy-mm.
    if (!unit && !cur && /^(?:19|20)\d{2}$/.test(digits)) continue;
    if (!unit && !cur && (MONTH_RE.test(before) || MONTH_RE.test(after))) continue;
    if (/[/-]$/.test(before) && /^\d/.test(norm.slice(index))) continue;
    if (/^\s*[/-]\d/.test(after) && !unit) continue;
    // Degree classes and times (2:1, 09:30), ordinals, list numbering.
    if (/:$/.test(before) || /^:\d/.test(after)) continue;
    if (/^(?:st|nd|rd|th)\b/.test(after)) continue;
    if (/^[.)]\s/.test(after) && (index === 0 || /\n\s*$/.test(before))) continue;
    // Version-ish and small bare integers ("java 17", "step 2", "one of 3 teams").
    if (!unit && !cur && value < 100) continue;
    // "years" as a unit is an experience claim, unless it's a date range ("2019 - 2023 years"? never) — keep.

    const number = String(value);
    const key = `${cur}${number}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
    out.push({ key, text: m[0].trim(), sentence: sentenceAt(norm, index), index });
  }
  return out;
}

function contentTokens(sentence: string): Set<string> {
  const out = new Set<string>();
  for (const w of sentence.split(/[^a-z0-9+#]+/)) {
    if (w.length < 4 || STOP_TOKENS.has(w) || /^\d/.test(w)) continue;
    out.add(canonicalUnit(w));
  }
  return out;
}

// ── The check ────────────────────────────────────────────────────────────────

export type ClaimWhere = "cv" | "coverLetter" | "email" | "extra";
export type NumberViolation = { figure: string; sentence: string; kind: "absent" | "context_mismatch"; where: ClaimWhere };
// A skill claimed above its registered level: a learning skill named at all,
// or a project-only skill written as work experience, with proficiency
// wording, or among the lead Technical Tools. `claim` names the offending
// text and `rule` the rule it breaks — shown beside the Download button.
export type SkillRule = "learning_anywhere" | "project_in_experience" | "project_as_competency" | "project_lead_tool";
export const SKILL_RULE_TEXT: Record<SkillRule, string> = {
  learning_anywhere: "a learning-level skill must not appear anywhere in the output",
  project_in_experience: "a project-level skill may not appear in Experience — write it under Projects as \"built <project> with X\"",
  project_as_competency: "a project-level skill may not be described as a competency or years of experience",
  project_lead_tool: `a project-level skill may not sit among the first ${8} Technical Tools`,
};
export type SkillViolation = { skill: string; level: "learning" | "project"; confirmed: boolean; where: ClaimWhere; claim: string; rule: SkillRule };

// How many Technical Tools a recruiter reads as the lead skills.
export const TOOLS_LEAD_SLOTS = 8;

// Whether a text names a registered skill. The matcher needs every specific
// token of a multi-word name in a tight window, so "RAG and knowledge
// retrieval" never matched the CV's own "LLM/RAG knowledge solutions" and
// the rule was silently skipped. A name's DISTINCTIVE tokens — an acronym
// (RAG, LLM, AWS) or a product-spelled word (LangChain, FastAPI) — count on
// their own; generic words ("knowledge", "design") and generic acronyms
// (API, REST, UI) do not.
const GENERIC_ACRONYMS = new Set(["API", "APIS", "REST", "UI", "UX", "CI", "CD", "IT", "AI", "ML", "QA", "HR", "ETL", "CRUD", "SDK", "IDE", "OS", "DB", "URL", "HTTP", "HTTPS", "JSON", "XML", "CSV", "PDF"]);
export function distinctiveTokens(name: string): string[] {
  const out: string[] = [];
  for (const raw of name.split(/[\s/,()]+/)) {
    const t = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#.]+$/g, "");
    if (t.length < 2) continue;
    if (/^[A-Z][A-Z0-9]{1,5}$/.test(t) && !GENERIC_ACRONYMS.has(t)) out.push(t);
    else if (/^[A-Za-z][a-z]+[A-Z][A-Za-z0-9.]*$/.test(t) || /^[A-Z][a-z]+\.[a-z]+$/.test(t)) out.push(t);
  }
  return out;
}
export function skillMentioned(text: string, name: string): boolean {
  if (!text) return false;
  if (matchAtsKeywords(text, [name]).matched > 0) return true;
  const tokens = distinctiveTokens(name);
  return tokens.length > 0 && matchAtsKeywords(text, tokens).matched > 0;
}

// The bold contract puts the closing ** on either side of the colon
// ("**Technical Tools:**" or "**Technical Tools**:"); both stay in the prefix.
const TOOLS_LINE_RE = /^(\s*\**\s*technical tools\s*\**\s*:\s*\**\s*)(.*)$/im;

// The items on the "Technical Tools:" line, in order.
export function technicalTools(skills: unknown): string[] {
  if (typeof skills !== "string") return [];
  const m = TOOLS_LINE_RE.exec(skills);
  if (!m) return [];
  return m[2].split(/\s*[|·•,]\s*/).map((t) => t.trim()).filter(Boolean);
}

// Moves any project-level skill out of the first TOOLS_LEAD_SLOTS Technical
// Tools (to the end of the line) — deterministic, so no model call is needed
// to satisfy the lead-tool rule. Returns the demoted names.
export function demoteProjectTools(skills: unknown, projectSkillNames: string[]): { skills: unknown; demoted: string[] } {
  if (typeof skills !== "string") return { skills, demoted: [] };
  const m = TOOLS_LINE_RE.exec(skills);
  if (!m) return { skills, demoted: [] };
  const items = m[2].split(/\s*\|\s*/).map((t) => t.trim()).filter(Boolean);
  if (items.length <= TOOLS_LEAD_SLOTS) return { skills, demoted: [] };
  const isProject = (item: string) => projectSkillNames.some((n) => skillMentioned(item, n));
  const lead = items.slice(0, TOOLS_LEAD_SLOTS);
  const demoted = lead.filter(isProject);
  if (demoted.length === 0) return { skills, demoted: [] };
  const kept = items.filter((i) => !demoted.includes(i));
  const line = `${m[1]}${[...kept, ...demoted].join(" | ")}`;
  return { skills: skills.replace(TOOLS_LINE_RE, line.replace(/\$/g, "$$$$")), demoted };
}
export type ClaimCheck = {
  mode: ClaimMode;
  skillViolations: SkillViolation[];
  numberViolations: NumberViolation[];
  // enforce mode and (a figure absent from the sources, or a confirmed
  // learning skill present). Warnings never block.
  blocking: boolean;
};

// A part may carry extra sources of its own: the cover letter legitimately
// quotes facts about the company from the job description ("your 14 product
// teams"), which would be an invented claim inside the CV itself.
// `experience` is the work-experience section alone, when the part is the
// CV: a project-only skill appearing there is a production claim.
// `skills` is the skills section alone: a project-only skill among the lead
// Technical Tools is a claim too.
export type ClaimPart = { where: ClaimWhere; text: string; extraSources?: (string | null | undefined)[]; experience?: unknown; skills?: unknown };

// Wording that turns a mention into a competency claim: "proficient in X",
// "experienced with X", "strong X skills", "3 years of X".
const PROFICIENCY_RE =
  /\b(?:proficien(?:t|cy)|expert(?:ise)?|experienced|experience\s+(?:in|with|of|building|using|developing|delivering)|strong|advanced|extensive|deep|solid|skilled|fluen(?:t|cy)|competent|specialis(?:t|ed|ing)|specializ(?:ed|ing)|mastery|\d+\+?\s+years?)\b/i;

function sentencesOf(text: string): string[] {
  return text
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?;])\s+|\n+|\s+[•▪●◦]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
function excerpt(s: string): string {
  const t = s.replace(/^[•\-*]\s+/, "").replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

function figureIndex(sources: (string | null | undefined)[]): Map<string, Figure[]> {
  const byKey = new Map<string, Figure[]>();
  for (const f of sources.filter((s): s is string => typeof s === "string" && s.trim() !== "").flatMap(extractFigures)) {
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  }
  return byKey;
}

export function checkClaims(
  parts: ClaimPart[],
  registry: ClaimsRegistry | null | undefined,
  sources: (string | null | undefined)[]
): ClaimCheck {
  const mode = claimMode(registry);
  const baseIndex = figureIndex(sources);
  const learningSkills = (registry?.skills ?? []).filter((s) => s.level === "learning");
  const projectSkills = (registry?.skills ?? []).filter((s) => s.level === "project");

  const numberViolations: NumberViolation[] = [];
  const skillViolations: SkillViolation[] = [];
  for (const part of parts) {
    if (!part.text || !part.text.trim()) continue;
    const byKey = part.extraSources?.length ? figureIndex([...sources, ...part.extraSources]) : baseIndex;
    const seen = new Set<string>();
    for (const f of extractFigures(part.text)) {
      const dedupe = `${f.key}|${f.sentence}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      let sourceHits = byKey.get(f.key);
      // A bare number in the output ("320") or a counted one with a different
      // count noun ("14 versions" for the CV's "14 model versions") is fine
      // when the source has the same number with a count noun: the noun was
      // dropped or swapped, not the figure changed.
      if (!sourceHits && /^\d/.test(f.key) && !f.key.endsWith("%")) {
        const [num, unit] = f.key.split(" ");
        if (!unit || isCountNoun(unit)) {
          for (const [k, v] of byKey) {
            const [kn, ku] = k.split(" ");
            if (kn === num && isCountNoun(ku)) { sourceHits = v; break; }
          }
        }
      }
      if (!sourceHits) {
        numberViolations.push({ figure: f.text, sentence: f.sentence, kind: "absent", where: part.where });
        continue;
      }
      const tokens = contentTokens(f.sentence);
      if (tokens.size < 3) continue;
      const shares = sourceHits.some((s) => {
        const st = contentTokens(s.sentence);
        for (const t of tokens) if (st.has(t)) return true;
        return false;
      });
      if (!shares) numberViolations.push({ figure: f.text, sentence: f.sentence, kind: "context_mismatch", where: part.where });
    }
    for (const s of learningSkills) {
      if (skillMentioned(part.text, s.name)) {
        const hit = sentencesOf(part.text).find((x) => skillMentioned(x, s.name));
        skillViolations.push({ skill: s.name, level: "learning", confirmed: s.confirmed, where: part.where, claim: hit ? excerpt(hit) : "", rule: "learning_anywhere" });
      }
    }
    // A project-only skill claimed above its level: written into the
    // work-experience section (even when the master CV's own bullet says so
    // — the registry is the candidate's statement, the CV bullet is the
    // overclaim it corrects), among the lead Technical Tools, or with
    // proficiency wording anywhere.
    const leadTools = technicalTools(part.skills).slice(0, TOOLS_LEAD_SLOTS);
    for (const s of projectSkills) {
      if (!skillMentioned(part.text, s.name)) continue;
      // Bullets only: a "Role | Employer | Dates" header line names no skill.
      const expLine =
        typeof part.experience === "string"
          ? sentencesOf(part.experience).find((x) => !/\|/.test(x) && skillMentioned(x, s.name))
          : undefined;
      if (expLine) {
        skillViolations.push({ skill: s.name, level: "project", confirmed: s.confirmed, where: part.where, claim: `written as work experience: "${excerpt(expLine)}"`, rule: "project_in_experience" });
        continue;
      }
      const leadTool = leadTools.find((t) => skillMentioned(t, s.name));
      if (leadTool) {
        skillViolations.push({ skill: s.name, level: "project", confirmed: s.confirmed, where: part.where, claim: `listed among the first ${TOOLS_LEAD_SLOTS} Technical Tools as "${leadTool}"`, rule: "project_lead_tool" });
        continue;
      }
      const claimed = sentencesOf(part.text).find((x) => skillMentioned(x, s.name) && PROFICIENCY_RE.test(x));
      if (claimed) {
        skillViolations.push({ skill: s.name, level: "project", confirmed: s.confirmed, where: part.where, claim: `described as a competency: "${excerpt(claimed)}"`, rule: "project_as_competency" });
      }
    }
  }

  // Blocking as soon as the registry has levels: a figure absent from the
  // sources, or any skill claimed above its level.
  const blocking = mode === "enforce" && (numberViolations.some((n) => n.kind === "absent") || skillViolations.length > 0);
  return { mode, skillViolations, numberViolations, blocking };
}

export function countUnconfirmed(r: ClaimsRegistry | null | undefined): number {
  return (r?.skills ?? []).filter((s) => !s.confirmed).length;
}
