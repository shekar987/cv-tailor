// The bullet style pass (16 Oct 2026, lib/formatStyles): what a style does
// to the finished bullets AFTER the master CV's own bullets have been
// selected by id (lib/bulletIds reconcileExperience) — and again after the
// page fit, which puts master bullets back verbatim. Deterministic, idempotent
// and bounded by the same two-substitution budget the id protocol keeps:
//
// - bold markers stripped when the style has no bold (zero substitutions:
//   lib/bulletIds tokens() never counts a marker);
// - a "Highlight:" prefix stripped when the style keeps no highlight line
//   (after reconcile, so the master's own "Highlight:" token is not counted);
// - one trailing full stop stripped when the style ends bullets without one
//   (zero substitutions: tokens() drops an edge dot; "etc." and an ellipsis
//   stay);
// - a banned word swapped for its listed equivalent when the swap fits the
//   budget the bullet has left — "used" → "applied", "successfully" dropped,
//   "responsible for" → "owned"; a banned word with NO equivalent is never
//   swapped (a stronger verb would claim more, ABSOLUTE_RULES 10) and is
//   reported instead;
// - the opening-verb cap counted across experience AND projects; a bullet
//   past it is reported (the lint asks for a different selection first; a
//   master bullet is never rewritten for it);
// - a master bullet over the style's word cap is reported.
//
// The notes say what only the master CV can fix ("This bullet is 34 words;
// CareerSet style wants 30 or fewer — edit it in /customize"). With UKJI's
// rules (bold, highlight and full stops kept, no banned words, no cap) the
// pass returns its input unchanged.
//
// Imports only ./bulletIds.ts and ./bulletShape.ts, so it runs under node:test.
import { substitutions, overlap, MAX_SUBSTITUTIONS, type MasterRole, type MasterBullet } from "./bulletIds.ts";
import { stemWord } from "./bulletShape.ts";

export type BulletStyleRules = {
  render: { bold: boolean; highlightLine: boolean; trailingFullStop: boolean };
  lint: { bannedWords: readonly string[]; equivalences: Readonly<Record<string, readonly string[]>>; verbCap: number | null };
  limits: { bullets: { maxWords: number | null } };
};

export type MasterCvNote = { where: "experience" | "projects"; owner: string; bullet: string; problem: string };
export type StylePassReport = {
  debolded: number;
  highlightsStripped: number;
  fullStopsStripped: number;
  swapped: { where: "experience" | "projects"; from: string; to: string; bullet: string }[];
  // Bullets past the opening-verb cap, in document order (the verb and the bullet).
  verbCapped: { verb: string; bullet: string }[];
  notes: MasterCvNote[];
};

const OUTPUT_HEADER = /^[^•\-*\s].*\|.*\|/;
const BULLET = /^(\s*[•\-*]\s+)(.*)$/;
const HIGHLIGHT = /^highlight\s*:\s*/i;
// A full stop that closes an abbreviation or an ellipsis is not a bullet's
// trailing full stop.
const KEEP_DOT = /(?:\b(?:etc|e\.g|i\.e|vs|approx|no|ltd|inc|jr|sr|st|co)|\.)\.$/i;

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordsOf = (t: string) => t.replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean);

function bannedRe(word: string): RegExp {
  return new RegExp(`(?<![\\w-])${esc(word).replace(/\\?\s+/g, "\\s+")}(?![\\w-])`, "i");
}

// The bullet with one banned word swapped for `to` ("" = removed), case kept
// and a sentence-opening capital restored; null when the word is not there.
export function swapBanned(text: string, word: string, to: string): string | null {
  const re = bannedRe(word);
  const m = re.exec(text);
  if (!m) return null;
  const capital = /^[A-Z]/.test(m[0]);
  const at = m.index;
  if (to) {
    const rep = capital ? to.charAt(0).toUpperCase() + to.slice(1) : to;
    return `${text.slice(0, at)}${rep}${text.slice(at + m[0].length)}`;
  }
  let out = `${text.slice(0, at)}${text.slice(at + m[0].length)}`.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  if (at === 0) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

export function stripTrailingFullStop(text: string): string {
  const t = text.replace(/\s+$/, "");
  if (!t.endsWith(".") || KEEP_DOT.test(t)) return text;
  return t.slice(0, -1);
}

export function openingVerb(text: string): string {
  const first = text.replace(/\*\*/g, "").replace(/^\s*[•\-*]\s+/, "").trim().split(/\s+/)[0] ?? "";
  return stemWord(first.replace(/[^A-Za-z-]/g, ""));
}

function closest(text: string, candidates: MasterBullet[], min = 0.5): MasterBullet | null {
  let best: MasterBullet | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = overlap(text, c.text);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return bestScore >= min ? best : null;
}

export function applyBulletStyle(
  sections: { experience: string; projects: Record<string, string[]> },
  style: BulletStyleRules,
  masterRoles: MasterRole[] = [],
  projectNames: string[] = []
): { experience: string; projects: Record<string, string[]>; report: StylePassReport } {
  const report: StylePassReport = { debolded: 0, highlightsStripped: 0, fullStopsStripped: 0, swapped: [], verbCapped: [], notes: [] };
  const { render, lint, limits } = style;

  // One bullet: the shape rules, then the banned words within the budget
  // its master leaves (a generated bullet has no master: swapped freely).
  const styleOne = (raw: string, where: "experience" | "projects", owner: string, master: MasterBullet | null): string => {
    let text = raw;
    if (!render.bold && text.includes("**")) {
      text = text.replace(/\*\*/g, "");
      report.debolded++;
    }
    if (!render.highlightLine && HIGHLIGHT.test(text)) {
      text = text.replace(HIGHLIGHT, "");
      report.highlightsStripped++;
    }
    if (!render.trailingFullStop) {
      const stripped = stripTrailingFullStop(text);
      if (stripped !== text) {
        text = stripped;
        report.fullStopsStripped++;
      }
    }
    for (const word of lint.bannedWords) {
      if (!bannedRe(word).test(text)) continue;
      const targets = lint.equivalences[word] ?? [];
      const to = targets[0];
      if (to === undefined) {
        report.notes.push({ where, owner, bullet: text, problem: `contains "${word}", which this style bans, and no plain equivalent claims the same — edit it in /customize, or let the tailoring pick another bullet` });
        continue;
      }
      const proposed = swapBanned(text, word, to);
      if (proposed === null) continue;
      if (master && substitutions(master.text, proposed).changed > MAX_SUBSTITUTIONS) {
        report.notes.push({ where, owner, bullet: text, problem: `contains "${word}", which this style bans; swapping it would take this bullet past the two-word change the tailoring allows — edit it in /customize` });
        continue;
      }
      report.swapped.push({ where, from: word, to: to || "(removed)", bullet: proposed });
      text = proposed;
    }
    if (limits.bullets.maxWords !== null) {
      const n = wordsOf(text).length;
      if (n > limits.bullets.maxWords) {
        report.notes.push({
          where,
          owner,
          bullet: text,
          problem: where === "experience" ? `This bullet is ${n} words; this style wants ${limits.bullets.maxWords} or fewer — edit it in /customize` : `This bullet is ${n} words; this style wants ${limits.bullets.maxWords} or fewer — shorten it in the preview`,
        });
      }
    }
    return text;
  };

  // Experience: headers and plain lines pass through untouched; a bullet
  // keeps its own marker.
  const lines = sections.experience.split("\n");
  let currentRole = 0;
  let currentTitle = "";
  const expBullets: { line: number; text: string }[] = [];
  const out = lines.map((raw, i) => {
    const line = raw.trim();
    if (!line) return raw;
    if (OUTPUT_HEADER.test(line)) {
      currentRole += 1;
      currentTitle = line.split("|")[0].trim();
      return raw;
    }
    const m = BULLET.exec(raw);
    if (!m) return raw;
    const text = m[2];
    const pool = masterRoles.find((r) => r.index === currentRole)?.bullets ?? [];
    const master = masterRoles.length ? (closest(text, pool) ?? closest(text, masterRoles.flatMap((r) => r.bullets))) : null;
    const styled = styleOne(text, "experience", currentTitle || `Role ${currentRole}`, master);
    expBullets.push({ line: i, text: styled });
    return styled === text ? raw : `${m[1]}${styled}`;
  });

  // Projects: generated bullets, no master budget.
  const projects: Record<string, string[]> = {};
  let projectsChanged = false;
  for (const [key, list] of Object.entries(sections.projects)) {
    const name = projectNames[Number(key)]?.split("|")[0].trim() || `Project ${Number(key) + 1}`;
    const next = list.map((b) => styleOne(b, "projects", name, null));
    if (next.some((b, i) => b !== list[i])) projectsChanged = true;
    projects[key] = next;
  }

  // The opening-verb cap across the whole CV: the first `cap` bullets with a
  // verb keep it; every later one is reported (and, for the lint, flagged).
  if (lint.verbCap !== null) {
    const counts = new Map<string, number>();
    const all = [
      ...expBullets.map((b) => ({ where: "experience" as const, owner: lines[b.line] ? "" : "", text: b.text })),
      ...Object.entries(projects).flatMap(([key, list]) => list.map((text) => ({ where: "projects" as const, owner: projectNames[Number(key)]?.split("|")[0].trim() || `Project ${Number(key) + 1}`, text }))),
    ];
    for (const b of all) {
      const v = openingVerb(b.text);
      if (!v) continue;
      const n = (counts.get(v) ?? 0) + 1;
      counts.set(v, n);
      if (n > lint.verbCap) {
        const verb = b.text.trim().split(/\s+/)[0];
        report.verbCapped.push({ verb, bullet: b.text });
        report.notes.push({ where: b.where, owner: b.owner, bullet: b.text, problem: `opens with "${verb}", which already opens ${lint.verbCap} bullets; this style caps an opening verb at ${lint.verbCap} — the tailoring should pick another bullet, or edit the wording in /customize` });
      }
    }
  }

  const experienceChanged = out.some((l, i) => l !== lines[i]);
  return {
    experience: experienceChanged ? out.join("\n") : sections.experience,
    projects: projectsChanged ? projects : sections.projects,
    report,
  };
}

// The opening verbs used more than `cap` times across the bullets, for the
// lint and the format check: verb → count.
export function overusedVerbs(bullets: string[], cap: number): { verb: string; count: number }[] {
  const counts = new Map<string, { verb: string; count: number }>();
  for (const b of bullets) {
    const stem = openingVerb(b);
    if (!stem) continue;
    const cur = counts.get(stem);
    if (cur) cur.count++;
    else counts.set(stem, { verb: b.trim().split(/\s+/)[0].replace(/[^A-Za-z-]/g, ""), count: 1 });
  }
  return [...counts.values()].filter((c) => c.count > cap).sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb));
}

// The banned words a text carries (whole words / phrases), each once.
export function bannedWordsIn(text: string, banned: readonly string[]): string[] {
  return banned.filter((w) => bannedRe(w).test(text));
}
