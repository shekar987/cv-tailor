// One-page enforcement for a candidate with under three years of experience
// (the user's own eligibility answer — lib/quality onePageExpected; never
// inferred). The prompts are asked for a one-page budget, and this pass makes
// the finished text actually fit: it measures the document with the same
// arithmetic the downloads use (estimatePages with a one-page target) and
// trims BY RELEVANCE until it fits — never rewriting, only dropping whole
// bullets, trailing summary sentences and the least relevant tools, and
// reporting every piece it left out so the user can put one back in the
// editable preview.
//
// Relevance is the deterministic matcher's (lib/atsMatch): a bullet that
// names a required skill outranks one that names a keyword, which outranks
// one with neither; evidence (a figure, a scale, a named system) breaks
// ties, then the model's own order (it writes the strongest bullet first).
//
// Imports only relative .ts modules so it runs under node:test.
import { estimatePages, hasEvidence, type Sections, type ProfileLike } from "./quality.ts";
import { matchAtsKeywords } from "./atsMatch.ts";
import { capTechnicalTools, splitSentences } from "./formatRules.ts";

export const ONE_PAGE_SUMMARY_WORDS = 60;
export const ONE_PAGE_TOOLS = 12;
export const ONE_PAGE_ROLE_CAP_FIRST = 4;
export const ONE_PAGE_ROLE_CAP_REST = 3;
export const ONE_PAGE_ROLE_MIN = 2;
export const ONE_PAGE_PROJECT_CAP = 2;
export const ONE_PAGE_PROJECT_MIN = 1;

export type LeftOut = {
  summary: string[];
  tools: string[];
  experience: { role: string; bullet: string }[];
  projects: { project: string; bullet: string }[];
};

export type OnePageReport = {
  fits: boolean;
  pagesBefore: number;
  pagesAfter: number;
  leftOut: LeftOut;
};

export type OnePageTerms = { keywords: unknown; required: unknown };

type Bullet = { line: number; text: string; score: number; order: number };
type Role = { title: string; bullets: Bullet[] };

const BULLET_RE = /^[•\-*]\s+/;

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function termList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

// Higher = more worth keeping.
export function bulletRelevance(bullet: string, terms: OnePageTerms): number {
  const req = matchAtsKeywords(bullet, termList(terms.required)).matched;
  const kw = matchAtsKeywords(bullet, termList(terms.keywords)).matched;
  return req * 4 + kw * 2 + (hasEvidence(bullet) ? 1 : 0);
}

// The summary keeps whole leading sentences while they fit the word budget;
// the first sentence always stays (it carries the role title).
export function capSummaryWords(summary: unknown, max = ONE_PAGE_SUMMARY_WORDS): { summary: unknown; dropped: string[] } {
  if (typeof summary !== "string") return { summary, dropped: [] };
  const sentences = splitSentences(summary);
  if (sentences.length <= 1 || words(summary) <= max) return { summary, dropped: [] };
  const kept: string[] = [];
  let total = 0;
  for (const s of sentences) {
    const n = words(s);
    if (kept.length > 0 && total + n > max) break;
    kept.push(s);
    total += n;
  }
  const dropped = sentences.slice(kept.length);
  return { summary: kept.join("\n"), dropped };
}

// Experience as lines: a role starts at a non-bullet line that follows
// bullets (or the top); bullets are the lines under it. Everything else
// (headers, highlights, blank lines) is kept exactly as written.
function parseRoles(lines: string[], terms: OnePageTerms): Role[] {
  const roles: Role[] = [];
  let current: Role | null = null;
  let sawBullet = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (BULLET_RE.test(line)) {
      if (!current) {
        current = { title: "", bullets: [] };
        roles.push(current);
      }
      const text = line.replace(BULLET_RE, "");
      current.bullets.push({ line: i, text, score: bulletRelevance(text, terms), order: current.bullets.length });
      sawBullet = true;
    } else if (!current || sawBullet) {
      current = { title: line.split("|")[0].trim(), bullets: [] };
      roles.push(current);
      sawBullet = false;
    }
  });
  return roles;
}

// Which bullet a role or project can spare: the lowest score, later order first on a tie.
function weakest(bullets: Bullet[], removed: Set<number>): Bullet | null {
  const alive = bullets.filter((b) => !removed.has(b.line));
  if (alive.length === 0) return null;
  return alive.reduce((w, b) => (b.score < w.score || (b.score === w.score && b.order > w.order) ? b : w));
}

export function fitOnePage(
  sections: Sections,
  profile: ProfileLike,
  terms: OnePageTerms
): { sections: Sections; report: OnePageReport } {
  const leftOut: LeftOut = { summary: [], tools: [], experience: [], projects: [] };
  const pagesBefore = estimatePages(sections, profile, 1).pages;

  // 1. Summary and tools: fixed one-page caps.
  const sum = capSummaryWords(sections.summary);
  leftOut.summary = sum.dropped;
  const tools = capTechnicalTools(sections.skills, terms.keywords, terms.required, ONE_PAGE_TOOLS);
  leftOut.tools = tools.fix?.dropped ?? [];

  // 2. Experience and projects: per-role / per-project caps, then trim to fit.
  const expText = typeof sections.experience === "string" ? sections.experience : "";
  const expLines = expText.split("\n");
  const roles = parseRoles(expLines, terms);
  const removedLines = new Set<number>();

  const projectsIn = sections.projects && typeof sections.projects === "object" && !Array.isArray(sections.projects)
    ? (sections.projects as Record<string, unknown>)
    : null;
  const projectNames = Array.isArray(profile?.projects) ? profile.projects.map((p) => (p && typeof p.name === "string" ? p.name : "")) : [];
  const projects: { key: string; name: string; bullets: Bullet[] }[] = projectsIn
    ? Object.entries(projectsIn).map(([key, list]) => ({
        key,
        name: projectNames[Number(key)] || `Project ${Number(key) + 1}`,
        bullets: (Array.isArray(list) ? list : [])
          .filter((b): b is string => typeof b === "string")
          .map((text, order) => ({ line: order, text, score: bulletRelevance(text, terms), order })),
      }))
    : [];
  const removedProject = new Map<string, Set<number>>(projects.map((p) => [p.key, new Set<number>()]));

  const dropRole = (role: Role, b: Bullet) => {
    removedLines.add(b.line);
    leftOut.experience.push({ role: role.title, bullet: b.text });
  };
  const dropProject = (p: { key: string; name: string }, b: Bullet) => {
    removedProject.get(p.key)!.add(b.line);
    leftOut.projects.push({ project: p.name, bullet: b.text });
  };
  const alive = (bullets: Bullet[], removed: Set<number>) => bullets.filter((b) => !removed.has(b.line)).length;

  roles.forEach((role, i) => {
    const cap = i === 0 ? ONE_PAGE_ROLE_CAP_FIRST : ONE_PAGE_ROLE_CAP_REST;
    while (alive(role.bullets, removedLines) > cap) {
      const w = weakest(role.bullets, removedLines);
      if (!w) break;
      dropRole(role, w);
    }
  });
  projects.forEach((p) => {
    const removed = removedProject.get(p.key)!;
    while (alive(p.bullets, removed) > ONE_PAGE_PROJECT_CAP) {
      const w = weakest(p.bullets, removed);
      if (!w) break;
      dropProject(p, w);
    }
  });

  const assemble = (): Sections => ({
    summary: sum.summary,
    skills: tools.skills,
    experience: expText ? expLines.filter((_, i) => !removedLines.has(i)).join("\n") : sections.experience,
    projects: projectsIn
      ? Object.fromEntries(
          projects.map((p) => [p.key, p.bullets.filter((b) => !removedProject.get(p.key)!.has(b.line)).map((b) => b.text)])
        )
      : sections.projects,
  });

  // 3. Still over: drop the least relevant bullet anywhere, above each
  // role's / project's floor — projects first on a tie (they sit after
  // experience), then the oldest role.
  let current = assemble();
  let guard = 0;
  while (!estimatePages(current, profile, 1).fitsOnePage && guard++ < 200) {
    let best: { score: number; order: number; drop: () => void } | null = null;
    const consider = (score: number, order: number, drop: () => void) => {
      if (!best || score < best.score || (score === best.score && order < best.order)) best = { score, order, drop };
    };
    projects.forEach((p) => {
      const removed = removedProject.get(p.key)!;
      if (alive(p.bullets, removed) <= ONE_PAGE_PROJECT_MIN) return;
      const w = weakest(p.bullets, removed);
      if (w) consider(w.score, 0, () => dropProject(p, w));
    });
    roles.forEach((role, i) => {
      if (alive(role.bullets, removedLines) <= ONE_PAGE_ROLE_MIN) return;
      const w = weakest(role.bullets, removedLines);
      // Oldest roles (later in the text) give way before recent ones.
      if (w) consider(w.score, roles.length - i, () => dropRole(role, w));
    });
    if (!best) break;
    (best as { drop: () => void }).drop();
    current = assemble();
  }

  const after = estimatePages(current, profile, 1);
  return { sections: current, report: { fits: after.fitsOnePage, pagesBefore, pagesAfter: after.pages, leftOut } };
}

export function leftOutCount(r: OnePageReport): number {
  return r.leftOut.summary.length + r.leftOut.tools.length + r.leftOut.experience.length + r.leftOut.projects.length;
}
