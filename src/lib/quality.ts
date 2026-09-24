// Deterministic quality checks on a tailored result (Brief 3). Each one is a
// standard the brief names, measured rather than assumed:
//   - page estimate: the same line/heading arithmetic the Word and PDF
//     builders use to pick their spacing, so "about 2.3 pages" here means
//     the download really will run long;
//   - duplicate content across sections (a project written up again under
//     experience or education, a bullet repeated);
//   - evidence per bullet: a number, a scale, or a named system;
//   - inflation words a recruiter reads straight past.
// Import-free apart from sibling modules (relative, with extensions), so it
// runs on the server, in the browser and under node:test. Nothing here
// edits text: it reports, and the prompts / the user act.

import { DENSITIES, PAGE_HEIGHT, TARGET_PAGES, wrappedLines, chooseDensity, estimatedHeight, capacity } from "./cvDensity.ts";
import { extractFigures } from "./claims.ts";

export type ProfileLike = {
  tagline?: string;
  location?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  education?: { degree?: string; institution?: string; note?: string }[];
  certifications?: string[];
  rightToWork?: string[];
  projects?: { name?: string; tech?: string }[];
  extraSections?: { title?: string; bullets?: string[] }[];
} | null | undefined;

export type Sections = { summary?: unknown; skills?: unknown; experience?: unknown; projects?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : "");

function projectBullets(projects: unknown): string[] {
  if (!projects || typeof projects !== "object") return [];
  return Object.values(projects as Record<string, unknown>).flatMap((v) =>
    Array.isArray(v) ? v.filter((b): b is string => typeof b === "string") : []
  );
}

// ── Page estimate ────────────────────────────────────────────────────────────

export type PageEstimate = {
  // Rendered length at the spacing the builders would pick (they stretch a
  // short CV towards two pages on purpose, so this rarely reads under ~1.7).
  pages: number;
  // True when even the tightest spacing cannot hold the content in two pages.
  overBudget: boolean;
  // True when the tightest spacing would hold the content in ONE page — the
  // honest answer to "is this CV too long for one page", as opposed to
  // `pages`, which reports the stretch the builders choose.
  fitsOnePage: boolean;
  bodyLines: number;
};

// Under this many years of experience a recruiter expects one page. The
// user's years come from their own eligibility answers (lib/knockouts) and
// are never inferred: null means no expectation is applied.
export const ONE_PAGE_MAX_YEARS = 3;
export function onePageExpected(yearsExperience: number | null | undefined): boolean {
  return typeof yearsExperience === "number" && Number.isFinite(yearsExperience) && yearsExperience < ONE_PAGE_MAX_YEARS;
}

// targetPages: the layout the downloads will pick — 2 by default, 1 when the
// user has under three years (lib/onePage). `pages` is read against it.
export function estimatePages(sections: Sections, profile: ProfileLike, targetPages: number = TARGET_PAGES): PageEstimate {
  const p = profile ?? {};
  const summary = str(sections.summary);
  const skills = str(sections.skills);
  const experience = str(sections.experience);
  const projectText = projectBullets(sections.projects).join("\n");
  const projects = Array.isArray(p.projects) ? p.projects : [];
  const projectMetaText = projects.map((m) => [m?.name, m?.tech].filter(Boolean).join("\n")).join("\n");
  const education = Array.isArray(p.education) ? p.education : [];
  const educationText = education.map((e) => [e?.degree, e?.institution, e?.note].filter(Boolean).join("\n")).join("\n");
  const certs = Array.isArray(p.certifications) ? p.certifications : [];
  const rtw = Array.isArray(p.rightToWork) ? p.rightToWork : [];
  const extras = Array.isArray(p.extraSections) ? p.extraSections.filter((s) => s && Array.isArray(s.bullets) && s.bullets.length > 0) : [];
  const extrasText = extras.map((s) => (s.bullets ?? []).join("\n")).join("\n");

  const bodyText = [summary, skills, experience, projectText, projectMetaText, educationText, certs.join("\n"), rtw.join("\n"), extrasText]
    .filter(Boolean)
    .join("\n");
  const hasContactRow = !!(p.location || p.phone || p.email || p.linkedin || p.github || p.website);
  const contactLines = 1 + (p.tagline ? 1 : 0) + (hasContactRow ? 1 : 0);
  const headings =
    (summary ? 1 : 0) + (skills ? 1 : 0) + (experience ? 1 : 0) +
    (education.length > 0 ? 1 : 0) + (certs.length > 0 ? 1 : 0) + (rtw.length > 0 ? 1 : 0) + extras.length + (projectMetaText ? 1 : 0);
  const size = {
    lines: wrappedLines(bodyText) + contactLines,
    paragraphs: bodyText.split("\n").filter((l) => l.trim()).length + contactLines,
    headings,
  };
  const chosen = chooseDensity(size, targetPages);
  const tightest = DENSITIES[DENSITIES.length - 1];
  const overBudget = estimatedHeight(size, tightest) > capacity(tightest);
  // capacity() is the two-page budget; one page is half of it.
  const fitsOnePage = estimatedHeight(size, tightest) <= capacity(tightest) / 2;
  const usable = PAGE_HEIGHT - 2 * chosen.margin;
  const pages = Math.round((estimatedHeight(size, chosen) / usable) * 10) / 10;
  return { pages, overBudget, fitsOnePage, bodyLines: size.lines };
}

// ── Duplicate content ────────────────────────────────────────────────────────

export type Duplicate = { kind: "project_in_experience" | "project_in_education" | "repeated_bullet"; text: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9%+#./ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function bulletsOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[•\-*]\s+/.test(l))
    .map((l) => l.replace(/^[•\-*]\s+/, ""));
}
function projectTitle(name: string): string {
  return name.split("|")[0].trim();
}

export function findDuplicateContent(sections: Sections, profile: ProfileLike): Duplicate[] {
  const out: Duplicate[] = [];
  const experience = str(sections.experience);
  const expNorm = norm(experience);
  const titles = (profile?.projects ?? []).map((pr) => projectTitle(str(pr?.name))).filter((t) => t.length >= 4);
  for (const t of titles) {
    if (expNorm.includes(norm(t))) out.push({ kind: "project_in_experience", text: t });
  }
  const eduNorm = norm((profile?.education ?? []).map((e) => str(e?.note)).join("\n"));
  for (const t of titles) {
    if (eduNorm && eduNorm.includes(norm(t))) out.push({ kind: "project_in_education", text: t });
  }
  const seen = new Map<string, string>();
  for (const b of [...bulletsOf(experience), ...projectBullets(sections.projects)]) {
    const k = norm(b);
    if (k.length < 20) continue;
    if (seen.has(k)) {
      if (!out.some((d) => d.kind === "repeated_bullet" && norm(d.text) === k)) out.push({ kind: "repeated_bullet", text: b });
    } else seen.set(k, b);
  }
  return out;
}

// ── Evidence per bullet ──────────────────────────────────────────────────────

// A named system: a capitalised or tech-shaped token after the bullet's
// first word (PostgreSQL, GitHub Actions, CI/CD, C#, Node.js, Kafka).
const NAMED_TOKEN_RE = /\b(?:[A-Z][A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*|[A-Z][a-z]+(?:\.[a-z]{2,4})?|[A-Za-z]+[#+]{1,2}|[A-Za-z]+\/[A-Za-z]+)\b/;
// Scale needs a quantity: "2k users", "hundreds of requests", "per day" -
// a bare "the team" is not evidence.
const SCALE_RE =
  /\b(?:\d[\d,.]*\s*(?:k|m|bn)?\+?\s*(?:users?|customers?|clients?|requests?|transactions?|orders?|events?|records?|services|microservices|endpoints?|teams?|engineers?|developers?|countries|markets?|regions?|people)|(?:hundreds|thousands|millions|dozens)\s+of\b|per\s+(?:second|day|week|month)|daily|weekly|monthly)\b/i;
const SENTENCE_START_WORD_RE = /^\W*[A-Za-z][\w'-]*/;

export function hasEvidence(bullet: string): boolean {
  const text = bullet.replace(/\*\*/g, "").trim();
  if (extractFigures(text).length > 0) return true;
  if (SCALE_RE.test(text)) return true;
  const rest = text.replace(SENTENCE_START_WORD_RE, "");
  return NAMED_TOKEN_RE.test(rest);
}

export function weakBullets(experience: unknown, projects?: unknown): string[] {
  return [...bulletsOf(str(experience)), ...projectBullets(projects)].filter((b) => !hasEvidence(b));
}

// ── Relevance bolt-ons ───────────────────────────────────────────────────────

// "… - directly applicable to Acme's technical file review workflows": a
// bullet that ends by narrating its own relevance to the employer is the
// clearest generated-by-a-tool signal in a CV. A bullet states what was
// built, how, and the measured result, then stops; relevance is shown by
// selection and ordering. Three rules, all on the bullet's trailing clause:
//   1. relevance phrases anywhere in the clause ("applicable to", "core
//      patterns for", "exactly what this role needs", "mirrors your …");
//   2. after a dash/semicolon/comma separator only: an address to the
//      employer ("your team", "this role") or a clause that ends on a
//      demand verb ("… Acme's regulated customers demand");
//   3. the employer's name inside that trailing clause, when known.
const RELEVANCE_RE =
  /\b(?:(?:directly|readily|immediately|highly)\s+)?(?:applicable|transferable|relevant)\s+to\b|\bcore\s+(?:patterns?|skills?|capabilit(?:y|ies)|competenc(?:y|ies)|experience)\s+for\b|\b(?:this|the|your)\s+(?:role|position|team|opening)\s+(?:demands|requires|needs|calls\s+for|asks\s+for|is\s+looking\s+for)\b|\b(?:exactly|precisely)\s+(?:what|the\s+(?:kind|sort|type))\b|\bmirror(?:s|ing)\s+(?:the|your|this)\b|\balign(?:s|ed|ing)\s+(?:directly\s+)?with\s+(?:the|your|this)\b|\bmaps?\s+(?:directly\s+)?(?:to|onto)\s+(?:the|your|this)\b|\btranslat(?:es|ing)\s+directly\b|\bthe\s+(?:same|exact)\s+[\w\s/-]{0,40}?\b(?:this|the|your)\s+(?:role|team|position|company|stack)\b/i;
const EMPLOYER_ADDRESS_RE = /\b(?:this|the)\s+(?:role|position|hiring\s+team|opening)\b|\byour\s+(?:team|role|stack|platform|customers|workflows?|product|engineers|pipeline|users)\b/i;
const DEMAND_VERB_END_RE = /\b(?:demands?|requires?|needs?|expects?|values?|prioriti[sz]es?|looks?\s+for|calls\s+for|depends?\s+on|relies\s+on)[.!]?$/i;
const TAIL_SEP_RE = /\s[-–—]{1,2}\s|—|;\s|,\s/g;

function trailingClause(bullet: string): { tail: string; separated: boolean } {
  const text = bullet.replace(/\*\*/g, "").trim();
  let last = -1, lastLen = 0;
  for (const m of text.matchAll(TAIL_SEP_RE)) { last = m.index ?? -1; lastLen = m[0].length; }
  if (last < 0) return { tail: text, separated: false };
  return { tail: text.slice(last + lastLen).trim(), separated: true };
}

function companyKey(company: string | undefined): string {
  return (company ?? "").toLowerCase().replace(/\b(?:ltd|limited|plc|inc|llc|gmbh|co)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function isRelevanceBoltOn(bullet: string, company?: string): boolean {
  const { tail, separated } = trailingClause(bullet);
  if (RELEVANCE_RE.test(tail)) return true;
  if (!separated || tail.split(/\s+/).length < 3) return false;
  if (EMPLOYER_ADDRESS_RE.test(tail) || DEMAND_VERB_END_RE.test(tail)) return true;
  const key = companyKey(company);
  return key.length >= 3 && ` ${norm(tail)} `.includes(` ${key} `) ? true : key.length >= 3 && norm(tail).includes(`${key}'s`);
}

export function relevanceBoltOns(experience: unknown, projects?: unknown, company?: string): string[] {
  return [...bulletsOf(str(experience)), ...projectBullets(projects)].filter((b) => isRelevanceBoltOn(b, company));
}

// ── Bullet lint (the generation loop) ────────────────────────────────────────

// Per-bullet flags the tailor route feeds back into one regeneration of the
// flagged section: a relevance bolt-on, or a filler phrase from the ban list.
export type BulletFlag = { bullet: string; reasons: string[] };
export type BulletLint = { experience: BulletFlag[]; projects: BulletFlag[] };

function flagBullet(bullet: string, company?: string): BulletFlag | null {
  const reasons: string[] = [];
  if (isRelevanceBoltOn(bullet, company)) reasons.push("ends with a clause narrating its relevance to the employer — state what was built, how, and the result, then stop");
  for (const h of inflationHits(bullet)) reasons.push(`filler: ${h.word}`);
  return reasons.length ? { bullet, reasons } : null;
}

export function lintBullets(sections: { experience?: unknown; projects?: unknown }, company?: string): BulletLint {
  const flag = (b: string) => flagBullet(b, company);
  return {
    experience: bulletsOf(str(sections.experience)).map(flag).filter((f): f is BulletFlag => f !== null),
    projects: projectBullets(sections.projects).map(flag).filter((f): f is BulletFlag => f !== null),
  };
}

export function countFlags(lint: BulletLint): number {
  return lint.experience.length + lint.projects.length;
}

// ── Inflation ────────────────────────────────────────────────────────────────

export const INFLATION_WORDS = [
  "expert", "cutting-edge", "world-class", "best-in-class", "state-of-the-art", "innovative", "dynamic", "passionate",
  "results-driven", "seamless", "seamlessly", "robust", "leveraging", "leverage", "leveraged", "synergy", "synergies",
  "guru", "ninja", "rockstar", "highly skilled", "proven track record", "go-getter", "self-starter", "thought leader",
  "production-grade", "mission-critical", "at scale", "end-to-end", "hands-on", "game-changing", "disruptive",
];
const INFLATION_RE = new RegExp(`\\b(?:${INFLATION_WORDS.map((w) => w.replace(/[-/]/g, "[-\\s]?")).join("|")})\\b`, "gi");

export function inflationHits(text: unknown): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of str(text).matchAll(INFLATION_RE)) {
    const w = m[0].toLowerCase().replace(/\s+/g, "-");
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

// ── Ordering signature (for the evaluation harness) ──────────────────────────

// Per role, the first three bullets normalized: two tailorings of the same
// CV against different JDs should differ here, or tailoring is not doing
// its job.
export function orderingSignature(experience: unknown): string[][] {
  const out: string[][] = [];
  let current: string[] | null = null;
  for (const raw of str(experience).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[•\-*]\s+/.test(line)) {
      if (current && current.length < 3) current.push(norm(line.replace(/^[•\-*]\s+/, "")).slice(0, 80));
    } else if (line.includes("|")) {
      current = [];
      out.push(current);
    }
  }
  return out;
}

export function orderingDiffers(a: unknown, b: unknown): boolean {
  const sa = orderingSignature(a), sb = orderingSignature(b);
  if (sa.length === 0 || sb.length === 0) return false;
  return JSON.stringify(sa) !== JSON.stringify(sb);
}

// ── One report for the UI ────────────────────────────────────────────────────

export type QualityReport = {
  pages: PageEstimate;
  duplicates: Duplicate[];
  weakBullets: string[];
  inflation: { word: string; count: number }[];
  // Bullets that end by narrating their relevance to the employer.
  boltOns: string[];
};

export function qualityReport(sections: Sections, profile: ProfileLike, coverLetter?: unknown, company?: string, targetPages: number = TARGET_PAGES): QualityReport {
  const prose = [str(sections.summary), str(sections.experience), projectBullets(sections.projects).join("\n"), str(coverLetter)].join("\n");
  return {
    pages: estimatePages(sections, profile, targetPages),
    duplicates: findDuplicateContent(sections, profile),
    weakBullets: weakBullets(sections.experience, sections.projects),
    inflation: inflationHits(prose),
    boltOns: relevanceBoltOns(sections.experience, sections.projects, company),
  };
}
