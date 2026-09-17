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

import { DENSITIES, PAGE_HEIGHT, wrappedLines, chooseDensity, estimatedHeight, capacity } from "./cvDensity.ts";
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
  bodyLines: number;
};

export function estimatePages(sections: Sections, profile: ProfileLike): PageEstimate {
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
  const chosen = chooseDensity(size);
  const tightest = DENSITIES[DENSITIES.length - 1];
  const overBudget = estimatedHeight(size, tightest) > capacity(tightest);
  const usable = PAGE_HEIGHT - 2 * chosen.margin;
  const pages = Math.round((estimatedHeight(size, chosen) / usable) * 10) / 10;
  return { pages, overBudget, bodyLines: size.lines };
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
};

export function qualityReport(sections: Sections, profile: ProfileLike, coverLetter?: unknown): QualityReport {
  const prose = [str(sections.summary), str(sections.experience), projectBullets(sections.projects).join("\n"), str(coverLetter)].join("\n");
  return {
    pages: estimatePages(sections, profile),
    duplicates: findDuplicateContent(sections, profile),
    weakBullets: weakBullets(sections.experience, sections.projects),
    inflation: inflationHits(prose),
  };
}
