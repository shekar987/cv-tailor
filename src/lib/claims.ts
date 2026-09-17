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
// Migration path: seeded from the CV, confirmed once by the user. Until then
// the check WARNS (mode "warn"); after confirmation it BLOCKS downloads until
// the user edits the flagged text (mode "enforce"). A user who never touches
// the registry keeps generating.
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
    const name = typeof g.name === "string" ? g.name.trim().replace(/\s+/g, " ").slice(0, MAX_SKILL_NAME) : "";
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

export function claimMode(r: ClaimsRegistry | null | undefined): ClaimMode {
  return r?.confirmedAt ? "enforce" : "warn";
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

export function learningText(cvText: string): string {
  const lines = (cvText || "").split(/\r?\n/);
  const out: string[] = [];
  let underLearningHeading = false;
  for (const line of lines) {
    const t = line.trim();
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
};
const UNITS =
  "%|percent|x|k|m|mm|bn|b|million|billion|thousand|ms|s|sec|secs|seconds?|min|mins|minutes?|hrs?|hours?|days?|weeks?|months?|years?|yrs?|kb|mb|gb|tb|pb|qps|rps|tps|fps|users?|customers?|clients?|requests?|records?|rows?|events?|transactions?|orders?|tickets?|engineers?|developers?|people|teams?|stores?|sites?|countries|markets?|services?|microservices?|endpoints?|apis?|tests?|pipelines?|deployments?|releases?|incidents?|bugs?|reports?|dashboards?|models?|features?|repos?|repositories|projects?|servers?|nodes?|clusters?|regions?|languages?|components?|screens?|pages?|articles?|documents?|files?|candidates?|applications?|hires?|students?|members?|accounts?|devices?|vehicles?|locations?|branches?|products?|skus?|queries|jobs?|tasks?|issues?|prs?|commits?|lines?";
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

export function extractFigures(text: string): Figure[] {
  const norm = normalizeFigureText(text)
    .replace(PHONE_RE, (run) => ((run.match(/\d/g) ?? []).length >= 9 ? " ".repeat(run.length) : run))
    .replace(RANGE_RE, "$1$3 to $2$3");
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
export type SkillViolation = { skill: string; level: "learning"; confirmed: boolean; where: ClaimWhere };
export type ClaimCheck = {
  mode: ClaimMode;
  skillViolations: SkillViolation[];
  numberViolations: NumberViolation[];
  // enforce mode and (a figure absent from the sources, or a confirmed
  // learning skill present). Warnings never block.
  blocking: boolean;
};

export function checkClaims(
  parts: { where: ClaimWhere; text: string }[],
  registry: ClaimsRegistry | null | undefined,
  sources: (string | null | undefined)[]
): ClaimCheck {
  const mode = claimMode(registry);
  const sourceFigures = sources.filter((s): s is string => typeof s === "string" && s.trim() !== "").flatMap(extractFigures);
  const byKey = new Map<string, Figure[]>();
  for (const f of sourceFigures) {
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  }
  const learningSkills = (registry?.skills ?? []).filter((s) => s.level === "learning");

  const numberViolations: NumberViolation[] = [];
  const skillViolations: SkillViolation[] = [];
  for (const part of parts) {
    if (!part.text || !part.text.trim()) continue;
    const seen = new Set<string>();
    for (const f of extractFigures(part.text)) {
      const dedupe = `${f.key}|${f.sentence}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const sourceHits = byKey.get(f.key);
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
      if (matchAtsKeywords(part.text, [s.name]).matched > 0) {
        skillViolations.push({ skill: s.name, level: "learning", confirmed: s.confirmed, where: part.where });
      }
    }
  }

  const blocking =
    mode === "enforce" &&
    (numberViolations.some((n) => n.kind === "absent") || skillViolations.some((s) => s.confirmed));
  return { mode, skillViolations, numberViolations, blocking };
}

export function countUnconfirmed(r: ClaimsRegistry | null | undefined): number {
  return (r?.skills ?? []).filter((s) => !s.confirmed).length;
}
