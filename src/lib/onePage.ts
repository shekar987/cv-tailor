// Page fit: the CV's length target, enforced on the finished text with the
// same arithmetic the downloads use (lib/quality estimatePages → cvDensity).
//
// TWO PAGES is the default (Preferences.onePageCv false). The document
// should fill two pages — not stop at one and a half, not spill onto a
// third — using only the master CV's own content. fitTwoPages():
// - runs past two pages even at the tightest spacing → drops the least
//   relevant bullet anywhere until it fits (floors kept);
// - has room → restores master bullets the tailoring left out, most relevant
//   first, while the document still fits two pages at a spacing roomier than
//   the tightest. The caller passes candidates already cleared by the claims
//   registry and the Right-to-Work switch; a candidate that repeats a bullet
//   already on the page is skipped, and an experience bullet is only ever
//   placed under the role its master header names.
//
// ONE PAGE is opt-in (Customize → CV length). fitOnePage() trims BY
// RELEVANCE until the document measures one page — never rewriting, only
// dropping whole bullets, trailing summary sentences and the least relevant
// tools, and reporting every piece it left out so the user can put one back
// in the editable preview. (Until 25 Sep it was forced for anyone whose
// eligibility answer said under three years; the owner found it cut too much.)
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
import { diffAgainstMaster, overlap, type MasterRole } from "./bulletIds.ts";

export const ONE_PAGE_SUMMARY_WORDS = 60;
export const ONE_PAGE_TOOLS = 12;
export const ONE_PAGE_ROLE_CAP_FIRST = 4;
export const ONE_PAGE_ROLE_CAP_REST = 3;
export const ROLE_MIN_BULLETS = 2;
export const ONE_PAGE_PROJECT_CAP = 2;
export const PROJECT_MIN_BULLETS = 1;
// A restored bullet may not push the layout to the tightest spacing: two
// pages at "tight" (half-inch margins) read as crammed.
export const REFILL_DENSITIES: readonly string[] = ["roomy", "normal", "snug"];
// A candidate this close to a bullet already on the page is the same point.
export const DUPLICATE_OVERLAP = 0.4;

export type LeftOut = {
  summary: string[];
  tools: string[];
  experience: { role: string; bullet: string }[];
  projects: { project: string; bullet: string }[];
};

export type PageFitReport = {
  target: 1 | 2;
  fits: boolean;
  pagesBefore: number;
  pagesAfter: number;
  leftOut: LeftOut;
  // Master bullets put back to fill two pages (two-page fit only).
  restored: { section: string; bullet: string }[];
};

export type OnePageTerms = { keywords: unknown; required: unknown };

export type RefillCandidate =
  | { where: "experience"; role: number; masterHeader: string; text: string }
  | { where: "projects"; key: string; project: string; text: string };

type Bullet = { line: number; text: string; score: number; order: number };
type Role = { title: string; bullets: Bullet[] };

const BULLET_RE = /^[•\-*]\s+/;
const ROLE_LINE = /^[^•\-*\s].*\|.*\|/;
const HIGHLIGHT_RE = /^highlight\s*:/i;

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function termList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

function emptyLeftOut(): LeftOut {
  return { summary: [], tools: [], experience: [], projects: [] };
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

// Drop bullets by relevance until the document fits `target` pages: first
// the per-role / per-project caps when given (one page), then the least
// relevant bullet anywhere above each role's / project's floor — projects
// first on a tie (they sit after experience), then the oldest role.
function trimToFit(
  base: Sections,
  profile: ProfileLike,
  terms: OnePageTerms,
  target: 1 | 2,
  caps: { first: number; rest: number; project: number } | null,
  leftOut: LeftOut
): Sections {
  const expText = typeof base.experience === "string" ? base.experience : "";
  const expLines = expText.split("\n");
  const roles = parseRoles(expLines, terms);
  const removedLines = new Set<number>();

  const projectsIn = base.projects && typeof base.projects === "object" && !Array.isArray(base.projects)
    ? (base.projects as Record<string, unknown>)
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

  if (caps) {
    roles.forEach((role, i) => {
      const cap = i === 0 ? caps.first : caps.rest;
      while (alive(role.bullets, removedLines) > cap) {
        const w = weakest(role.bullets, removedLines);
        if (!w) break;
        dropRole(role, w);
      }
    });
    projects.forEach((p) => {
      const removed = removedProject.get(p.key)!;
      while (alive(p.bullets, removed) > caps.project) {
        const w = weakest(p.bullets, removed);
        if (!w) break;
        dropProject(p, w);
      }
    });
  }

  const assemble = (): Sections => ({
    summary: base.summary,
    skills: base.skills,
    experience: expText ? expLines.filter((_, i) => !removedLines.has(i)).join("\n") : base.experience,
    projects: projectsIn
      ? Object.fromEntries(
          projects.map((p) => [p.key, p.bullets.filter((b) => !removedProject.get(p.key)!.has(b.line)).map((b) => b.text)])
        )
      : base.projects,
  });
  const fits = (s: Sections) =>
    target === 1 ? estimatePages(s, profile, 1).fitsOnePage : !estimatePages(s, profile, 2).overBudget;

  let current = assemble();
  let guard = 0;
  while (!fits(current) && guard++ < 200) {
    let best: { score: number; order: number; drop: () => void } | null = null;
    const consider = (score: number, order: number, drop: () => void) => {
      if (!best || score < best.score || (score === best.score && order < best.order)) best = { score, order, drop };
    };
    projects.forEach((p) => {
      const removed = removedProject.get(p.key)!;
      if (alive(p.bullets, removed) <= PROJECT_MIN_BULLETS) return;
      const w = weakest(p.bullets, removed);
      if (w) consider(w.score, 0, () => dropProject(p, w));
    });
    roles.forEach((role, i) => {
      if (alive(role.bullets, removedLines) <= ROLE_MIN_BULLETS) return;
      const w = weakest(role.bullets, removedLines);
      // Oldest roles (later in the text) give way before recent ones.
      if (w) consider(w.score, roles.length - i, () => dropRole(role, w));
    });
    if (!best) break;
    (best as { drop: () => void }).drop();
    current = assemble();
  }
  return current;
}

// ── One page (opt-in) ────────────────────────────────────────────────────────

export function fitOnePage(
  sections: Sections,
  profile: ProfileLike,
  terms: OnePageTerms
): { sections: Sections; report: PageFitReport } {
  const leftOut = emptyLeftOut();
  const pagesBefore = estimatePages(sections, profile, 1).pages;

  // Summary and tools: fixed one-page caps.
  const sum = capSummaryWords(sections.summary);
  leftOut.summary = sum.dropped;
  const tools = capTechnicalTools(sections.skills, terms.keywords, terms.required, ONE_PAGE_TOOLS);
  leftOut.tools = tools.fix?.dropped ?? [];

  const current = trimToFit(
    { ...sections, summary: sum.summary, skills: tools.skills },
    profile,
    terms,
    1,
    { first: ONE_PAGE_ROLE_CAP_FIRST, rest: ONE_PAGE_ROLE_CAP_REST, project: ONE_PAGE_PROJECT_CAP },
    leftOut
  );
  const after = estimatePages(current, profile, 1);
  return { sections: current, report: { target: 1, fits: after.fitsOnePage, pagesBefore, pagesAfter: after.pages, leftOut, restored: [] } };
}

// ── Two pages (the default) ──────────────────────────────────────────────────

function roleBlocks(lines: string[]): { header: number; end: number }[] {
  const headers = lines.map((l, i) => (ROLE_LINE.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  return headers.map((h, k) => ({ header: h, end: k + 1 < headers.length ? headers[k + 1] : lines.length }));
}

// The output role a master bullet belongs to: the block whose title (else,
// uniquely, whose employer) appears in the master header. Never a guess — no
// unique match, no placement.
function blockFor(lines: string[], blocks: { header: number; end: number }[], masterHeader: string, position: number) {
  const m = masterHeader.toLowerCase();
  const seg = (b: { header: number }) => lines[b.header].split("|").map((s) => s.trim().toLowerCase());
  const byTitle = blocks.filter((b) => {
    const t = seg(b)[0] ?? "";
    return t.length >= 4 && m.includes(t);
  });
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    const pos = blocks[position - 1];
    return pos && byTitle.includes(pos) ? pos : null;
  }
  const byEmployer = blocks.filter((b) => {
    const e = seg(b)[1] ?? "";
    return e.length >= 3 && m.includes(e);
  });
  return byEmployer.length === 1 ? byEmployer[0] : null;
}

function insertExperienceBullet(exp: string, c: { role: number; masterHeader: string; text: string }): string | null {
  const lines = exp.split("\n");
  const block = blockFor(lines, roleBlocks(lines), c.masterHeader, c.role);
  if (!block) return null;
  let at = block.header;
  for (let i = block.header + 1; i < block.end; i++) if (BULLET_RE.test(lines[i].trim())) at = i;
  // A "Highlight:" line leads its role, as the experience prompt places it.
  lines.splice(HIGHLIGHT_RE.test(c.text) ? block.header + 1 : at + 1, 0, `• ${c.text}`);
  return lines.join("\n");
}

function experienceBullets(exp: string): string[] {
  return exp
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => BULLET_RE.test(l))
    .map((l) => l.replace(BULLET_RE, ""));
}

// Master experience bullets the finished text does not carry (by closest
// match, lib/bulletIds), with the role they belong to.
export function experienceRefillCandidates(finalExperience: unknown, masterRoles: MasterRole[]): RefillCandidate[] {
  if (typeof finalExperience !== "string" || masterRoles.length === 0) return [];
  const diff = diffAgainstMaster(finalExperience, masterRoles);
  if (!diff) return [];
  const out: RefillCandidate[] = [];
  masterRoles.forEach((role, i) => {
    const d = diff.roles.find((r) => r.role === role.header);
    for (const b of d?.dropped ?? []) out.push({ where: "experience", role: i + 1, masterHeader: role.header, text: b.text });
  });
  return out;
}

// Each project's original bullets (from the extracted profile) that its
// tailored list does not carry.
export function projectRefillCandidates(
  projects: unknown,
  metas: { name?: string; originalBullets?: string[] }[] | undefined
): RefillCandidate[] {
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return [];
  const out: RefillCandidate[] = [];
  for (const [key, list] of Object.entries(projects as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const meta = metas?.[Number(key)];
    const have = list.filter((b): b is string => typeof b === "string");
    for (const raw of meta?.originalBullets ?? []) {
      const text = typeof raw === "string" ? raw.replace(BULLET_RE, "").trim() : "";
      if (!text || have.some((b) => overlap(b, text) >= 0.5)) continue;
      out.push({ where: "projects", key, project: meta?.name?.trim() || `Project ${Number(key) + 1}`, text });
    }
  }
  return out;
}

export function fitTwoPages(
  sections: Sections,
  profile: ProfileLike,
  terms: OnePageTerms,
  candidates: RefillCandidate[]
): { sections: Sections; report: PageFitReport } {
  const leftOut = emptyLeftOut();
  const restored: PageFitReport["restored"] = [];
  const before = estimatePages(sections, profile, 2);
  let current: Sections = sections;

  if (before.overBudget) {
    current = trimToFit(sections, profile, terms, 2, null, leftOut);
  } else {
    const ranked = candidates
      .map((c, order) => ({ c, order, score: bulletRelevance(c.text, terms) }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    for (const { c } of ranked) {
      let next: Sections | null = null;
      if (c.where === "experience") {
        if (typeof current.experience !== "string") continue;
        if (experienceBullets(current.experience).some((b) => overlap(b, c.text) >= DUPLICATE_OVERLAP)) continue;
        const exp = insertExperienceBullet(current.experience, c);
        if (!exp) continue;
        next = { ...current, experience: exp };
      } else {
        const projects =
          current.projects && typeof current.projects === "object" && !Array.isArray(current.projects)
            ? (current.projects as Record<string, unknown>)
            : null;
        const list = projects && Array.isArray(projects[c.key]) ? (projects[c.key] as unknown[]).filter((b): b is string => typeof b === "string") : null;
        if (!projects || !list) continue;
        if (list.some((b) => overlap(b, c.text) >= DUPLICATE_OVERLAP)) continue;
        next = { ...current, projects: { ...projects, [c.key]: [...list, c.text] } };
      }
      const est = estimatePages(next, profile, 2);
      if (est.overBudget || !REFILL_DENSITIES.includes(est.density)) continue;
      current = next;
      restored.push({ section: c.where === "experience" ? c.masterHeader.split("|")[0].trim() : c.project, bullet: c.text });
    }
  }

  const after = estimatePages(current, profile, 2);
  return {
    sections: current,
    report: { target: 2, fits: !after.overBudget, pagesBefore: before.pages, pagesAfter: after.pages, leftOut, restored },
  };
}

export function leftOutCount(r: PageFitReport): number {
  return r.leftOut.summary.length + r.leftOut.tools.length + r.leftOut.experience.length + r.leftOut.projects.length;
}
