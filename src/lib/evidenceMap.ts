// Requirement → evidence map. For every requirement the posting names (the
// JD analysis's required skills, nice-to-haves and top keywords): where the
// master CV shows it — in paid work, only in a personal project, only listed
// (skills line, certificates, education), registered as still being learnt,
// or nowhere at all. Deterministic and free, so:
//   - the pre-check shows it before a tailor credit is spent (/app gate card);
//   - every writing prompt receives it (renderEvidenceBlock): lead with what
//     paid work shows, present project-only evidence as project work, and
//     never claim — or describe other work as equivalent to — what is absent;
//   - the claims check reads it (graftRules): a technology the posting asks
//     for and the master CV never shows is an invention when it appears in
//     the CV, and a project-only one is when it appears under a paid role.
//
// Matching is deliberately conservative — the whole term (lib/atsMatch), the
// opposite of the claims check's catch-all: a line counts as evidence only
// when it names the requirement itself ("AWS Certified Cloud Practitioner"
// is not evidence of AWS Lambda). A few implications are exact ("SQL" is
// shown by PostgreSQL or MySQL work; "a Computer Science degree" by a BSc in
// Computer Science) and listed in IMPLIED.
//
// Imports only ./atsMatch.ts, ./claims.ts and ./bulletIds.ts (node:test).
import { matchAtsKeywords } from "./atsMatch.ts";
import { sectionsOf, distinctiveTokens, namesRequirement, learningText, type ClaimsRegistry, type ClaimLevel, type GraftRule } from "./claims.ts";
import { parseMasterExperience } from "./bulletIds.ts";

export type EvidenceStatus = "experience" | "project" | "listed" | "learning" | "gap";
export type RequirementKind = "technical" | "domain" | "soft" | "qualification";
export type Importance = "required" | "preferred" | "keyword";
export type EvidenceItem = {
  term: string;
  importance: Importance;
  kind: RequirementKind;
  status: EvidenceStatus;
  // The master-CV (or pool) line that shows it, clipped for display; null
  // for a gap, or when only the registry says so.
  evidence: string | null;
  // The role or project that line sits under.
  where: string | null;
};
export type EvidenceMap = { items: EvidenceItem[] };

export const MAX_EVIDENCE_ITEMS = 36;
const MAX_EVIDENCE_CHARS = 160;

// ── Requirement kinds ────────────────────────────────────────────────────────
// Only for presentation and for which gaps the claims check blocks on: a
// technology gap is an invention when written into a CV; a soft-skill "gap"
// only means the CV never says it in words.
const SOFT_RE =
  /\b(?:communicat\w*|interpersonal|collaborat\w*|teamwork|team\s+player|stakeholders?|self[- ]?starter|self[- ]?motivat\w*|self[- ]directed|motivat\w*|curio\w*|ownership|owning|problem[- ]?solv\w*|analytical\s+(?:thinking|skills?|abilit\w*|mind\w*)|attention\s+to\s+detail|adaptab\w*|learning\s+agility|eager\w*|passion\w*|proactiv\w*|autonom\w*|independen\w*|leadership|mentor\w*|organi[sz]ation\w*|time\s+management|written|verbal|presentation\s+skills|customer\s+focus|growth\s+mindset|initiative|accountab\w*|resilien\w*|flexib\w*|work\s+ethic|craftsmanship|high[- ]trust|fast[- ]paced|ambiguit\w*|experiment\w*|drive|driven|energ\w*|enthusias\w*|humility|empathy|interpersonal|personable|client\s+success)\b/i;
const DOMAIN_RE =
  /\b(?:insur\w*|reinsur\w*|actuar\w*|underwrit\w*|pricing|financ\w*|fintech|banking|trading|payments?|healthcare|health\s*tech|clinical|pharma\w*|legal|retail|e-?commerce|marketplace|logistics|supply\s+chain|energy|telecom\w*|gaming|advertising|adtech|edtech|proptech|insurtech|government|public\s+sector|defen[cs]e|automotive|aviation|marine|political|specialty|brokers?|carriers?|property|real\s+estate|travel|hospitality|food|delivery|mobility)\b/i;
const QUALIFICATION_RE = /\b(?:degree|bachelor\w*|master'?s|bsc|msc|beng|meng|phd|doctorate|qualification|graduate|diploma|a[- ]levels?|certif\w*|accredit\w*|chartered)\b/i;

export function kindOf(term: string): RequirementKind {
  if (QUALIFICATION_RE.test(term)) return "qualification";
  if (SOFT_RE.test(term)) return "soft";
  if (DOMAIN_RE.test(term)) return "domain";
  return "technical";
}

// ── The master CV and pool as lines with their owner ─────────────────────────
// (namesRequirement, the whole-term matcher, lives in lib/claims so the
// claims check reads generated text with the same test.)

type SourceLine = { text: string; where: string | null };

function clip(s: string): string {
  const t = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return t.length > MAX_EVIDENCE_CHARS ? `${t.slice(0, MAX_EVIDENCE_CHARS - 1)}…` : t;
}

// "Full Stack Engineer — Brane Group | Jul 2023 – Sep 2024" → "Full Stack
// Engineer, Brane Group"; "Research Assistant — AI & Full-Stack Development
// | University of East London — AssetGuard+ · London, UK" → "Research
// Assistant, University of East London"; "Backend Engineer | Acme | 2022 –
// Present" → "Backend Engineer, Acme".
export function roleLabel(header: string): string {
  const noDates = header
    .replace(/\s*[|·,]\s*(?:[A-Za-z]{3,9}\.?\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}.*$/, "")
    .replace(/\s*\((?:full|part)[- ]time.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = noDates.split(/\s\|\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  const [role, rest] = parts[0].split(/\s[—–]\s/);
  const employer = parts.length > 1 ? parts[1].split(/\s[—–·]\s|,\s/)[0] : rest ? rest.split(/\s·\s|,\s/)[0] : "";
  return employer ? `${role.trim()}, ${employer.trim()}` : role.trim();
}

// A role's header is evidence too: the title "Full Stack Engineer" shows
// full-stack development in paid work (dates and places name no skill).
function experienceLines(cv: string): SourceLine[] {
  return parseMasterExperience(cv).flatMap((r) => {
    const where = roleLabel(r.header) || null;
    return [{ text: r.header, where }, ...r.bullets.map((b) => ({ text: b.text, where }))];
  });
}

// "Relational databases and SQL" is two requirements, placed one by one: SQL
// is shown by PostgreSQL work even where "database design" beside it is not
// (read whole, the phrase was a gap on 26 Sep and the summary lost "SQL").
// An "or" stays whole: any option meets it (claims.namesRequirement). An
// "and" inside a qualifier ("full-stack development across frontend and
// backend systems") is read by the phrase's head, and coordinated verbs
// ("identifying and implementing automation opportunities") stay one phrase.
const LEAD_RE =
  /^(?:(?:strong|solid|proven|good|excellent|deep|sound|demonstrable|demonstrated)\s+)*(?:(?:(?:commercial|professional|practical|hands[- ]on|working|some)\s+)?(?:experience|knowledge|understanding|familiarity|proficiency|expertise|background|exposure|grounding)(?:\s+(?:with|in|of|on|using)\s+|\s+(?=\w+ing\b)))?/i;
const PREP_SPLIT_RE = /\s+(?:across|for|in|with|on|of|using|within|including|between|through|via|to)\s+/i;
export function requirementParts(term: string): string[] {
  const whole = term.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const core = whole.replace(LEAD_RE, "").trim() || whole;
  if (!/\s(?:and|&)\s|,|;/i.test(core)) return [core];
  // A list of options ("AWS, GCP or Azure", "Python, Go, or Rust") is one
  // requirement that any option meets.
  if (/\sor\s/i.test(core) && !/\s(?:and|&)\s/i.test(core)) return [core];
  const pieces = core
    .split(/\s*,\s*(?:and\s+|&\s+)?|\s+(?:and|&)\s+|\s*;\s*/i)
    .map((p) => p.replace(LEAD_RE, "").trim())
    .filter(Boolean);
  if (pieces.length < 2) return [core];
  const coordinatedVerbs = /^\w+ing$/i.test(pieces[0]) && /^\w+ing\b/i.test(pieces[1]);
  if (!coordinatedVerbs && pieces.every((p) => p.split(" ").length <= 3)) return pieces;
  const head = core.split(PREP_SPLIT_RE)[0].trim();
  return [head && head !== core && head.split(" ").length <= 4 ? head : core];
}

const BULLET_RE = /^\s*[•▪●◦\-*]\s*/;
const LINK_RE = /^(?:live|github|demo|url|link|repo|code|website)\b|https?:\/\/|\b[\w-]+\.(?:app|com|io|dev|co\.uk)\b/i;
const YEAR_ONLY_RE = /^\s*(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}(?:\s*[–-]\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present))?\s*$/i;
const NAME_MARKER_RE = /\s[—–|·]\s|\(\s*github|github\s*\)/i;

function isTechLine(t: string): boolean {
  return !/[.!?]$/.test(t) && t.split(",").length >= 3 && t.length <= 260;
}

function projectName(header: string): string {
  return header.split(/\s[—–|·]\s|\s\(|\s{2,}/)[0].replace(/\s+/g, " ").trim().slice(0, 60);
}

// A project's name line: short, not a sentence, not a link, year or tech
// line. A second name-like line straight after one ("FinSight" then
// "Natural-language analysis of SEC filings") is its subtitle.
// Inside a bullet (no blank line since it began) only a "Name — subtitle"
// line starts a new project: anything else there is the bullet wrapping.
function isProjectHeader(t: string, prevWasHeader: boolean, inBullet: boolean): boolean {
  if (prevWasHeader) return false;
  if (BULLET_RE.test(t) || LINK_RE.test(t) || YEAR_ONLY_RE.test(t) || /[.!?:,;]$/.test(t) || t.length > 140) return false;
  if (/^[a-z(—–-]/.test(t)) return false;
  if (NAME_MARKER_RE.test(t)) return true;
  return !inBullet && t.length <= 40 && !isTechLine(t);
}

// Lines of a projects section or pool, each with its project. Wrapped bullet
// lines are joined back to their bullet; a blank line ends a bullet.
export function projectLines(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  let name: string | null = null;
  let prevWasHeader = false;
  let open: SourceLine | null = null;
  for (const raw of (text || "").split(/\r?\n/)) {
    const t = raw.replace(/\t/g, " ").trim();
    if (!t) {
      open = null;
      continue;
    }
    if (isProjectHeader(t, prevWasHeader, open !== null)) {
      name = projectName(t);
      prevWasHeader = true;
      open = null;
      continue;
    }
    if (YEAR_ONLY_RE.test(t) || LINK_RE.test(t)) continue;
    if (BULLET_RE.test(t)) {
      open = { text: t.replace(BULLET_RE, ""), where: name };
      out.push(open);
    } else if (open && !prevWasHeader) {
      // Inside a bullet: the bullet wrapping, commas or not.
      open.text = `${open.text} ${t}`;
    } else {
      // A tech line, or a plain content line (a project written without bullets).
      open = isTechLine(t) ? null : { text: t, where: name };
      out.push(open ?? { text: t, where: name });
    }
    prevWasHeader = false;
  }
  return out;
}

// Each project's own text (the CV's Projects section and the pool, joined by
// project name), and the paid-work text beside them: what the fact check
// needs to see one project's facts told as another's (lib/supportCheck
// mergedProjects).
export function projectFacts(cv: string, pool: string | null | undefined): { projects: { name: string; text: string }[]; paidWork: string } {
  const sections = sectionsOf(cv);
  const by = new Map<string, { name: string; text: string }>();
  for (const l of [...projectLines(sections.projects.join("\n")), ...projectLines(pool || "")]) {
    if (!l.where) continue;
    const key = l.where.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const p = by.get(key) ?? { name: l.where, text: "" };
    p.text = `${p.text}\n${l.text}`;
    by.set(key, p);
  }
  return { projects: [...by.values()], paidWork: experienceLines(cv).map((l) => l.text).join("\n") };
}

function findLine(term: string, lines: SourceLine[]): SourceLine | null {
  for (const l of lines) if (namesRequirement(l.text, term)) return l;
  return null;
}

// The registry entry a requirement names — the most specific one: "AWS
// Lambda" is the project-level "AWS Lambda", not the production "AWS". An
// exact name wins, then the longest registered name the term contains; a
// registered name that merely contains the term counts only when it is the
// only one ("Lambda" → "AWS Lambda"). "React" is the production "React", never
// the project-level "React Testing Library" (that read would have had the
// claims check strip React from paid work).
function registryLevel(term: string, registry: ClaimsRegistry | null | undefined): { level: ClaimLevel; exact: boolean } | null {
  const skills = registry?.skills ?? [];
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
  const exact = skills.find((s) => key(s.name) === key(term));
  if (exact) return { level: exact.level, exact: true };
  let best: { level: ClaimLevel; len: number } | null = null;
  for (const s of skills) {
    if (matchAtsKeywords(term, [s.name]).matched > 0 && (!best || s.name.length > best.len)) best = { level: s.level, len: s.name.length };
  }
  if (best) return { level: best.level, exact: false };
  // Only a distinctive name reads through a longer one: "APIs" is not the
  // project-level "OpenAI API".
  if (key(term).split(" ").some((w) => GENERIC_WORDS.has(w))) return null;
  const containing = skills.filter((s) => matchAtsKeywords(s.name, [term]).matched > 0);
  return containing.length === 1 ? { level: containing[0].level, exact: false } : null;
}

// ── The map ──────────────────────────────────────────────────────────────────

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 80)) : [];

export function buildEvidenceMap(
  analysis: unknown,
  cv: string,
  pool: string | null | undefined,
  registry: ClaimsRegistry | null | undefined
): EvidenceMap {
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  const terms: { term: string; importance: Importance }[] = [];
  const seen = new Set<string>();
  // The posting's own title is not a requirement (the summary is required to
  // carry it), and a term an earlier, higher-priority one already covers
  // ("Ruby" after "Ruby/Rails", "Insurance" after "Insurance product
  // knowledge") would only repeat it.
  const title = typeof a.role_title === "string" ? a.role_title.trim() : "";
  const isTitle = (term: string) =>
    !!title && (term.toLowerCase() === title.toLowerCase() || (term.trim().split(/\s+/).length >= 2 && matchAtsKeywords(title, [term]).matched > 0));
  const add = (list: string[], importance: Importance) => {
    for (const whole of list) {
      if (isTitle(whole)) continue;
      for (const term of requirementParts(whole)) {
        const k = term.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
        if (!k || seen.has(k) || isTitle(term)) continue;
        if (terms.some((x) => matchAtsKeywords(x.term, [term]).matched > 0)) continue;
        seen.add(k);
        terms.push({ term, importance });
      }
    }
  };
  add(strList(a.required_skills), "required");
  add(strList(a.nice_to_have_skills), "preferred");
  add(strList(a.top_15_ats_keywords), "keyword");

  const sections = sectionsOf(cv);
  const exp = experienceLines(cv);
  const proj = [...projectLines(sections.projects.join("\n")), ...projectLines(pool || "")];
  // The CV's own "Currently learning: Kubernetes, Kafka" line is no evidence
  // that the skill may be named: it places the skill as being learnt, with or
  // without a registry (the eval harness has none, and the model listed them).
  const learnt = learningText(cv);
  const learntLines = learnt.split("\n").map((l) => l.trim()).filter(Boolean);
  const isLearningLine = (t: string) => learntLines.some((x) => t.includes(x) || x.includes(t.trim()));
  const listed: SourceLine[] = [
    ...sections.skills.filter((t) => !isLearningLine(t)).map((t) => ({ text: t, where: "Skills" })),
    ...sections.other.filter((t) => !isLearningLine(t)).map((t) => ({ text: t, where: null })),
  ];

  const items: EvidenceItem[] = [];
  for (const { term, importance } of terms.slice(0, MAX_EVIDENCE_ITEMS)) {
    const kind = kindOf(term);
    const reg = registryLevel(term, registry);
    const level = reg?.level ?? null;
    const e = findLine(term, exp);
    const p = findLine(term, proj);
    const l = findLine(term, listed);
    let status: EvidenceStatus;
    let line: SourceLine | null;
    if (level === "learning") {
      status = "learning";
      line = null;
    } else if (e && level !== "project") {
      status = "experience";
      line = e;
    } else if (level === "production" && reg?.exact) {
      // The registry vouches for paid use of exactly this skill, but no
      // experience line shows it: the model may name it, with no work to
      // describe and no project rule.
      status = "listed";
      line = l ?? p;
    } else if (p || e) {
      status = "project";
      line = p ?? e;
    } else if (l) {
      status = "listed";
      line = l;
    } else if (learnt && namesRequirement(learnt, term)) {
      status = "learning";
      line = null;
    } else {
      status = "gap";
      line = null;
    }
    items.push({ term, importance, kind, status, evidence: line ? clip(line.text) : null, where: line?.where ?? null });
  }
  return { items };
}

// Coerce a map that came back from the client (the pre-check's, forwarded
// to the tailor) before it may enter a prompt.
export function normalizeEvidenceMap(v: unknown): EvidenceMap | null {
  const items = v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : null;
  if (!items) return null;
  const STATUS: EvidenceStatus[] = ["experience", "project", "listed", "learning", "gap"];
  const KIND: RequirementKind[] = ["technical", "domain", "soft", "qualification"];
  const IMP: Importance[] = ["required", "preferred", "keyword"];
  const out: EvidenceItem[] = [];
  for (const raw of items.slice(0, MAX_EVIDENCE_ITEMS)) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof r.term !== "string" || !r.term.trim()) continue;
    const pick = <T extends string>(x: unknown, allowed: T[], fallback: T): T => (typeof x === "string" && (allowed as string[]).includes(x) ? (x as T) : fallback);
    out.push({
      term: r.term.trim().slice(0, 80),
      importance: pick(r.importance, IMP, "keyword"),
      kind: pick(r.kind, KIND, "technical"),
      status: pick(r.status, STATUS, "gap"),
      evidence: typeof r.evidence === "string" ? clip(r.evidence) : null,
      where: typeof r.where === "string" ? r.where.slice(0, 80) : null,
    });
  }
  return { items: out };
}

// ── For the prompts ──────────────────────────────────────────────────────────

const byStatus = (m: EvidenceMap, s: EvidenceStatus[], kinds?: RequirementKind[]) =>
  m.items.filter((i) => s.includes(i.status) && (!kinds || kinds.includes(i.kind)));

// The block every writing prompt receives. Empty when there is no map.
export function renderEvidenceBlock(map: EvidenceMap | null | undefined): string {
  if (!map || map.items.length === 0) return "";
  const fmt = (i: EvidenceItem) => `${i.term}${i.importance === "required" ? " (required)" : i.importance === "preferred" ? " (preferred)" : ""}${i.where ? ` — ${i.where}` : ""}`;
  const direct = byStatus(map, ["experience"]);
  const project = byStatus(map, ["project"]);
  const listed = byStatus(map, ["listed"]);
  const learning = byStatus(map, ["learning"]);
  const hardGaps = byStatus(map, ["gap"], ["technical", "domain", "qualification"]);
  const softGaps = byStatus(map, ["gap"], ["soft"]);
  const lines = [
    "EVIDENCE MAP — computed from the master CV against this posting's requirements. It decides what may be claimed:",
    direct.length ? `- PAID WORK SHOWS IT (lead with these; they are the strongest evidence for this job): ${direct.map(fmt).join("; ")}` : "",
    project.length ? `- ONLY A PERSONAL PROJECT SHOWS IT (present it only as work in that named project — never under a paid role, never as professional experience or a competency): ${project.map(fmt).join("; ")}` : "",
    listed.length ? `- ONLY LISTED (skills line, certificate or course — name it, never describe work done with it): ${listed.map(fmt).join("; ")}` : "",
    learning.length ? `- STILL BEING LEARNT (never mention it): ${learning.map((i) => i.term).join("; ")}` : "",
    hardGaps.length ? `- NO EVIDENCE IN THE MASTER CV (never claim these, never list them as skills, and never describe other work as equivalent to or preparation for them): ${hardGaps.map((i) => i.term).join("; ")}` : "",
    softGaps.length ? `- NOT SHOWN IN WORDS (the posting asks for these qualities; show one only through a real example from the master CV, never as a bare claim): ${softGaps.map((i) => i.term).join("; ")}` : "",
  ].filter(Boolean);
  return lines.length > 1 ? `\n${lines.join("\n")}\n` : "";
}

// For the pool-selection prompt: which of the posting's requirements each
// pool project's own text names — computed, so the choice of projects rests
// on evidence (CampaignPulse's 192 tests for a role that reviews and tests
// models) rather than on how a project is titled.
export function poolCoverageBlock(pool: string | null | undefined, map: EvidenceMap | null | undefined): string {
  if (!pool || !map || map.items.length === 0) return "";
  const byProject = new Map<string, string[]>();
  for (const l of projectLines(pool)) {
    if (!l.where) continue;
    const list = byProject.get(l.where) ?? [];
    for (const i of map.items) {
      if (i.kind === "soft" || list.includes(i.term)) continue;
      if (namesRequirement(l.text, i.term)) list.push(i.term);
    }
    byProject.set(l.where, list);
  }
  if (byProject.size === 0) return "";
  const rows = [...byProject.entries()].map(([p, terms]) => `  - ${p}: ${terms.length ? terms.join(", ") : "none of the posting's terms"}`);
  return `- The posting's requirements each pool project's own text names (computed):\n${rows.join("\n")}`;
}

// ── For the claims check ─────────────────────────────────────────────────────

// Technologies the posting asks for that the master CV never shows (an
// invention anywhere in the CV), and ones only a personal project shows (an
// invention under a paid role). Soft skills and domains are not blocked on:
// "problem-solving" in a summary is not a false claim the way "Go" is.
export type { GraftRule };

// Blocking is reserved for NAMED technologies and methods — a language,
// framework, tool, platform or analytical method ("Go", "Ruby/Rails",
// "Brossa", "Terraform", "predictive modelling"). A generic phrase from the
// posting ("proof of value", "code quality", "platform integrations") is
// guidance for the prompts, not something to hold a download on.
const METHODS_RE =
  /\b(?:predictive\s+model(?:l)?ing|machine\s+learning|deep\s+learning|data\s+science|statistic(?:s|al\s+model(?:l)?ing)|natural\s+language\s+processing|nlp|computer\s+vision|time[- ]series|forecasting|reinforcement\s+learning|recommend(?:ation|er)\s+systems?|a\/b\s+testing|microservices?|serverless|distributed\s+systems?|stream\s+processing|data\s+warehous\w*|mlops|infrastructure\s+as\s+code|actuarial\s+model(?:l)?ing|econometrics|bayesian\s+\w+)\b/i;
const GENERIC_WORDS = new Set([
  "programming", "infrastructure", "testing", "marketplace", "insurance", "autonomous", "coding", "software", "engineering",
  "development", "design", "architecture", "security", "analytics", "data", "cloud", "backend", "frontend", "fullstack", "api",
  "apis", "integration", "integrations", "automation", "reliability", "scalability", "performance", "quality", "documentation",
  "debugging", "deployment", "monitoring", "observability", "networking", "databases", "database", "modelling", "modeling",
  "research", "operations", "product", "delivery", "consulting", "agile", "scrum", "communication", "leadership", "mentoring",
  "collaboration", "ownership", "innovation", "strategy", "optimisation", "optimization", "maintenance", "support",
  // A job noun is never a technology: "Consultant" from the posting's title
  // ("Graduate Consultant Software Engineer") blocked the summary that must
  // name that title (Softwire, 26 Sep).
  "engineer", "engineers", "developer", "developers", "consultant", "consultants", "analyst", "analysts", "associate", "graduate",
  "graduates", "intern", "internship", "programmer", "architect", "specialist", "scientist", "manager", "lead", "trainee",
  "apprentice", "officer", "technician", "administrator", "advisor", "adviser", "partner",
]);
export function isNamedTechnology(term: string): boolean {
  const t = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (METHODS_RE.test(t)) return true;
  if (distinctiveTokens(t).length > 0) return true;
  const words = t.split(/[\s/]+/).filter(Boolean);
  return words.length <= 2 && words.every((w) => /^[A-Z][A-Za-z0-9.+#-]*$/.test(w) && !GENERIC_WORDS.has(w.toLowerCase()));
}

export function graftRules(map: EvidenceMap | null | undefined): GraftRule[] {
  if (!map) return [];
  return map.items
    .filter((i) => i.kind === "technical" && (i.status === "gap" || i.status === "project") && isNamedTechnology(i.term))
    .map((i) => ({ term: i.term.replace(/\s*\([^)]*\)\s*/g, " ").trim(), status: i.status as "gap" | "project" }));
}

// ── For the gate card ────────────────────────────────────────────────────────

export function evidenceCounts(map: EvidenceMap | null | undefined): Record<EvidenceStatus, number> {
  const c: Record<EvidenceStatus, number> = { experience: 0, project: 0, listed: 0, learning: 0, gap: 0 };
  for (const i of map?.items ?? []) if (i.importance === "required") c[i.status]++;
  return c;
}
