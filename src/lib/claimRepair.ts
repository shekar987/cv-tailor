// Claims repair: make a tailored CV and its cover letter pass the claims
// check without another tailor. Used by /api/fix-claims (the "Fix it" button
// on /app) and by the tailor route's own claims pass.
//
// Three stages, cheapest first — every change is reported:
// 1. Surgical (no model): remove only the flagged skill's own words where
//    the text makes that exact. "LLM/RAG" → "LLM"; a bracketed list
//    "(Axonius, Qualys, runZero)" loses the flagged items; a skills line
//    loses the item; a plain list item that is exactly the skill goes.
//    Every other word, figure and outcome stays. (The model, asked to
//    "drop the skill", deleted a whole clause and pinned "automated
//    business-document generation" on facial recognition instead — and
//    dropped an "11". A regex cannot misattribute.)
// 2. The model rewrites what is left, one sentence per item, with the job's
//    terms in view (/api/fix-claims; claimsRepairPrompt). A rewrite that
//    breaks a rule on its own is not applied.
// 3. Drop: a sentence that still fails is removed, so one click always ends
//    in a CV that passes.
//
// Imports only ./claims.ts and ./atsMatch.ts, so it runs under node:test.
import {
  checkClaims,
  distinctiveTokens,
  skillMentioned,
  namesRequirement,
  registryMentions,
  sentencesOf,
  describesAsCompetency,
  extractFigures,
  normalizeFigureText,
  technicalTools,
  SKILL_RULE_TEXT,
  TOOLS_LEAD_SLOTS,
  type ClaimsRegistry,
  type ClaimCheck,
  type GraftRule,
} from "./claims.ts";
import { tailoredSectionsText } from "./atsMatch.ts";

export type RepairSection = "summary" | "skills" | "experience" | "projects" | "coverLetter";
export type RepairSections = {
  summary: string;
  skills: string;
  experience: string;
  projects: Record<string, string[]>;
  coverLetter: string;
};
export type RepairItem = {
  id: string;
  section: RepairSection;
  // The full sentence as sentencesOf() reads it: bold markers and the
  // leading bullet removed.
  sentence: string;
  problems: string[];
  skills: string[];
  figures: string[];
  // The skills among `skills` that are posting terms the master CV never
  // shows: matched as whole terms (namesRequirement), so "go live" is not Go.
  absent: string[];
};
export type RepairChange = {
  section: RepairSection;
  before: string;
  after: string;
  how: "trimmed" | "rewritten" | "removed" | "reordered";
  // Words a trim or rewrite took out and put in, case kept — what the
  // report shows, since the sentence itself is clipped for display.
  removed?: string[];
  added?: string[];
};

export const REPAIR_SECTION_LABEL: Record<RepairSection, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  coverLetter: "Cover letter",
};

const CV_SECTIONS: RepairSection[] = ["summary", "skills", "experience", "projects"];
const BULLET_RE = /^\s*[•▪●◦\-*]\s+/;
const stripBold = (t: string) => t.replace(/\*\*/g, "");

// The same two parts the tailor route and /app check: the CV, and the letter
// (which may quote the posting's own facts about the company).
export function checkSections(
  s: RepairSections,
  registry: ClaimsRegistry | null,
  sources: (string | null | undefined)[],
  jd: string,
  grafts: GraftRule[] = []
): ClaimCheck {
  return checkClaims(
    [
      {
        where: "cv",
        text: tailoredSectionsText({ summary: s.summary, skills: s.skills, experience: s.experience, projects: s.projects }),
        experience: s.experience,
        skills: s.skills,
      },
      { where: "coverLetter", text: s.coverLetter, extraSources: [jd] },
    ],
    registry,
    sources,
    grafts
  );
}

// How an item's skills are found in text: a posting term the master CV never
// shows by the whole term; a registered skill by the claims check's own test
// (registryMentions: "AWS" is not "AWS Lambda" when AWS is production).
function mentionsFor(it: { absent: string[] }, registered: Mentions = skillMentioned): Mentions {
  return (text, skill) => (it.absent.includes(skill) ? namesRequirement(text, skill) : registered(text, skill));
}

function sentencesIn(s: RepairSections, section: RepairSection): string[] {
  const raw =
    section === "projects"
      ? Object.values(s.projects).flat().flatMap((b) => (typeof b === "string" ? sentencesOf(b) : []))
      : sentencesOf(s[section]);
  return raw.map((x) => x.replace(BULLET_RE, "").trim()).filter(Boolean);
}

// Every sentence that makes the check fail, with what is wrong in it. The
// check reports only the FIRST rule a project-level skill breaks, so fixing
// that one used to expose the next on the following check; here every
// sentence that breaks any rule for a flagged skill is listed at once, so one
// repair round (and one model call) covers them all. A sentence named by
// several problems is one item.
export function listRepairs(s: RepairSections, check: ClaimCheck, registry?: ClaimsRegistry | null): RepairItem[] {
  const registered = registryMentions(registry);
  const items = new Map<string, RepairItem>();
  const add = (section: RepairSection, sentence: string, problem: string, skill?: string, figure?: string, absent = false) => {
    const key = `${section} ${sentence}`;
    let it = items.get(key);
    if (!it) {
      it = { id: "", section, sentence, problems: [], skills: [], figures: [], absent: [] };
      items.set(key, it);
    }
    if (!it.problems.includes(problem)) it.problems.push(problem);
    if (skill && !it.skills.includes(skill)) it.skills.push(skill);
    if (skill && absent && !it.absent.includes(skill)) it.absent.push(skill);
    if (figure && !it.figures.includes(figure)) it.figures.push(figure);
  };

  const flagged = new Map<string, { skill: string; level: "learning" | "project" | "absent"; letter: boolean }>();
  for (const v of check.skillViolations) {
    const letter = v.where === "coverLetter";
    flagged.set(`${letter ? "L" : "C"}:${v.skill}`, { skill: v.skill, level: v.level, letter });
  }
  for (const f of flagged.values()) {
    const mentions = f.level === "absent" ? namesRequirement : registered;
    for (const section of f.letter ? (["coverLetter"] as RepairSection[]) : CV_SECTIONS) {
      for (const sentence of sentencesIn(s, section)) {
        // A "Role | Employer | Dates" header names no skill.
        if (section === "experience" && /\|/.test(sentence)) continue;
        if (!mentions(sentence, f.skill)) continue;
        if (f.level === "absent") {
          add(section, sentence, `${f.skill}: ${SKILL_RULE_TEXT.not_in_cv}`, f.skill, undefined, true);
          continue;
        }
        if (f.level === "learning") {
          add(section, sentence, `${f.skill}: ${SKILL_RULE_TEXT.learning_anywhere}`, f.skill);
          continue;
        }
        if (section === "experience") add(section, sentence, `${f.skill}: ${SKILL_RULE_TEXT.project_in_experience}`, f.skill);
        if (describesAsCompetency(sentence, f.skill, registered)) add(section, sentence, `${f.skill}: ${SKILL_RULE_TEXT.project_as_competency}`, f.skill);
      }
    }
    // Among the lead Technical Tools. demoteProjectTools() moves it down when
    // the line is long enough; on a short line it can only leave the line.
    if (!f.letter && f.level === "project" && technicalTools(s.skills).slice(0, TOOLS_LEAD_SLOTS).some((t) => registered(t, f.skill))) {
      const line = sentencesIn(s, "skills").find((x) => /^technical tools\s*:/i.test(x) && registered(x, f.skill));
      if (line) add("skills", line, `${f.skill}: ${SKILL_RULE_TEXT.project_lead_tool}`, f.skill);
    }
  }

  for (const n of check.numberViolations) {
    if (n.kind !== "absent" && n.kind !== "combined") continue;
    for (const section of n.where === "coverLetter" ? (["coverLetter"] as RepairSection[]) : CV_SECTIONS) {
      for (const sentence of sentencesIn(s, section)) {
        if (n.kind === "combined") {
          const dash = (t: string) => t.replace(/[–—−]/g, "-").replace(/\s+/g, "");
          if (dash(sentence).includes(dash(n.figure))) {
            add(section, sentence, `${n.figure} joins two separate figures into a range the master CV never states — use each figure only where the master CV does, with the fact it belongs to, or drop them`, undefined, n.figure);
          }
          continue;
        }
        const has = extractFigures(sentence).some((f) => f.text === n.figure) || normalizeFigureText(sentence).includes(n.figure);
        if (has) {
          add(section, sentence, `${n.figure} is not on the master CV — use the master CV's exact figure for this fact, or drop the figure`, undefined, n.figure);
        }
      }
    }
  }
  return [...items.values()].map((it, i) => ({ ...it, id: `r${i + 1}` }));
}

// ── Locating a sentence in the section text ──────────────────────────────────
// sentencesOf() strips bold markers and bullet glyphs; the section text keeps
// them. Match on a normalised copy and map back to the original indices.

function normWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("**", i)) {
      i += 2;
      continue;
    }
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!lastSpace && norm.length > 0) {
        norm += " ";
        map.push(i);
        lastSpace = true;
      }
      i++;
      continue;
    }
    norm += ch;
    map.push(i);
    lastSpace = false;
    i++;
  }
  return { norm, map };
}

export function locate(hay: string, needle: string): [number, number] | null {
  const n = normWithMap(needle.replace(BULLET_RE, "")).norm.trim();
  if (!n) return null;
  const { norm, map } = normWithMap(hay);
  const at = norm.indexOf(n);
  if (at === -1) return null;
  let start = map[at];
  let end = map[at + n.length - 1] + 1;
  // Keep bold pairs balanced: a match that starts right after an opening
  // "**" or ends right before a closing "**" takes the marker with it.
  if (hay.slice(start - 2, start) === "**" && (hay.slice(0, start - 2).match(/\*\*/g) ?? []).length % 2 === 0) start -= 2;
  if (hay.slice(end, end + 2) === "**" && (hay.slice(0, end).match(/\*\*/g) ?? []).length % 2 === 1) end += 2;
  return [start, end];
}

function tidyLine(line: string): string {
  const m = /^(\s*(?:[•▪●◦\-*]\s+)?)(.*)$/.exec(line)!;
  // Only a bullet keeps its prefix; plain prose never starts with a space
  // (a letter paragraph whose first sentence was removed did, on 26 Sep).
  if (!/[•▪●◦\-*]/.test(m[1])) m[1] = "";
  const body = m[2]
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/,\s*,/g, ",")
    .replace(/([,;:])\s*([.;])/g, "$2")
    .replace(/^[,;:\s]+/, "")
    .replace(/\s+$/, "");
  // The bullet prefix (glyph + space) is kept as it was. A leading "**" is a
  // bold marker, not a "*" bullet, and is never touched.
  return m[1].replace(/\s+$/, " ") + body;
}

function isEmptyLine(line: string): boolean {
  return !line.replace(BULLET_RE, "").replace(/\*\*/g, "").replace(/[.,;:–—\s-]/g, "");
}

// Replace one sentence in a block of text; "" removes it. The line it sat on
// is tidied, and removed when nothing is left of it. null = not found.
export function replaceSentence(text: string, sentence: string, replacement: string): string | null {
  const r = locate(text, sentence);
  if (!r) return null;
  const out = text.slice(0, r[0]) + replacement + text.slice(r[1]);
  // (lastIndexOf clamps a negative start to 0 and would find a newline AT 0.)
  const lineStart = r[0] === 0 ? 0 : out.lastIndexOf("\n", r[0] - 1) + 1;
  let lineEnd = out.indexOf("\n", r[0] + replacement.length);
  if (lineEnd === -1) lineEnd = out.length;
  const line = tidyLine(out.slice(lineStart, lineEnd));
  const rebuilt = isEmptyLine(line)
    ? out.slice(0, lineStart) + out.slice(Math.min(out.length, lineEnd + 1))
    : out.slice(0, lineStart) + line + out.slice(lineEnd);
  return rebuilt.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

// The sentence as it stands in the section, bold markers included; null when
// it cannot be found.
export function originalOf(s: RepairSections, section: RepairSection, sentence: string): string | null {
  if (section === "projects") {
    for (const list of Object.values(s.projects)) {
      for (const b of list) {
        if (typeof b !== "string") continue;
        const r = locate(b, sentence);
        if (r) return b.slice(r[0], r[1]);
      }
    }
    return null;
  }
  const r = locate(s[section], sentence);
  return r ? s[section].slice(r[0], r[1]) : null;
}

export function applyToSection(s: RepairSections, section: RepairSection, sentence: string, replacement: string): RepairSections | null {
  if (section === "projects") {
    for (const [key, list] of Object.entries(s.projects)) {
      const idx = list.findIndex((b) => typeof b === "string" && locate(b, sentence));
      if (idx === -1) continue;
      const next = replaceSentence(list[idx], sentence, replacement);
      if (next === null) continue;
      const bullets = [...list];
      if (isEmptyLine(next)) bullets.splice(idx, 1);
      else bullets[idx] = next;
      return { ...s, projects: { ...s.projects, [key]: bullets } };
    }
    return null;
  }
  const next = replaceSentence(s[section], sentence, replacement);
  return next === null ? null : { ...s, [section]: next };
}

// A model replacement is plain text; the bold spans of the sentence it
// replaces are put back around the same words when those words survive
// (the experience bullets bold their figures).
export function rebold(original: string, replacement: string): string {
  let out = replacement;
  for (const m of original.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    const span = m[1].trim();
    if (!span) continue;
    let from = 0;
    for (;;) {
      const at = out.indexOf(span, from);
      if (at === -1) break;
      const inBold = (out.slice(0, at).match(/\*\*/g) ?? []).length % 2 === 1;
      if (!inBold) {
        out = `${out.slice(0, at)}**${span}**${out.slice(at + span.length)}`;
        break;
      }
      from = at + span.length;
    }
  }
  return out;
}

// The words `after` dropped from `before` and the words it brought in, by a
// word-level longest common subsequence (case-insensitive, case kept).
// "LLM/RAG knowledge" → "LLM knowledge" removed ["RAG"].
export function wordChanges(before: string, after: string): { removed: string[]; added: string[] } {
  const split = (t: string) =>
    stripBold(t)
      .split(/[\s/,;()|]+/)
      .map((w) => w.replace(/^[^\w£$€#+]+|[^\w%+#]+$/g, ""))
      .filter(Boolean);
  const a = split(before);
  const b = split(after);
  const al = a.map((w) => w.toLowerCase());
  const bl = b.map((w) => w.toLowerCase());
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (al[i] === bl[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  removed.push(...a.slice(i));
  added.push(...b.slice(j));
  return { removed, added };
}

// ── Stage 1: surgical removal ────────────────────────────────────────────────

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A "Label: a | b | c" line (the skills section): the items mentioning the
// skill go, the label and the separator stay. At least one item must remain.
type Mentions = (text: string, skill: string) => boolean;

function trimListLine(line: string, skill: string, mentions: Mentions = skillMentioned): string {
  const m = /^(\s*(?:\*\*)?[^:|]{1,40}:(?:\*\*)?\s*)?([\s\S]*)$/.exec(line)!;
  const label = m[1] ?? "";
  const body = m[2];
  const sep = /\s\|\s/.test(body) ? "|" : body.includes("·") ? "·" : body.includes(",") ? "," : null;
  if (!sep) return line;
  const items = body.split(sep === "," ? /\s*,\s*/ : new RegExp(`\\s*${esc(sep)}\\s*`)).filter((x) => x.trim());
  const kept = items.filter((x) => !mentions(stripBold(x), skill));
  if (kept.length === items.length || kept.length === 0) return line;
  return label + kept.join(sep === "," ? ", " : ` ${sep} `);
}

// The sentence with the skills' own words removed where that is exact, or
// null when no exact removal clears every one of them. `listLine`: the
// sentence is a skills-section line, whose items are the unit of removal.
export function removeSkillMentions(sentence: string, skills: string[], listLine = false, mentions: Mentions = skillMentioned): string | null {
  let out = sentence;
  for (const skill of skills) {
    if (listLine) {
      out = trimListLine(out, skill, mentions);
      continue;
    }
    const forms = [...new Set([skill, ...distinctiveTokens(skill)])].filter((f) => f.length >= 2).sort((a, b) => b.length - a.length);
    for (const f of forms) {
      const t = esc(f);
      // A slash pair keeps its other half: "LLM/RAG" → "LLM", "RAG/LLM" → "LLM".
      out = out.replace(new RegExp(`([A-Za-z0-9][\\w.+#-]*)\\s*/\\s*${t}(?![\\w])`, "gi"), "$1");
      out = out.replace(new RegExp(`(?<![\\w])${t}\\s*/\\s*([A-Za-z0-9][\\w.+#-]*)`, "gi"), "$1");
    }
    // Bracketed lists lose the flagged items.
    out = out.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
      const items = inner.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
      const kept = items.filter((x) => !mentions(stripBold(x), skill));
      if (kept.length === items.length) return whole;
      return kept.length ? ` (${kept.join(", ")})` : "";
    });
    // "|" lists inside a sentence: the flagged item goes, a label stays.
    if (/\s\|\s/.test(out)) out = trimListLine(out, skill, mentions);
    // A plain list item that is exactly the skill: "Python, RAG, Redis",
    // "Python, RAG and Redis", "Python and RAG."
    for (const f of forms) {
      const t = esc(f);
      out = out.replace(new RegExp(`\\s*,\\s*${t}(?![\\w])(?=\\s*(?:,|and\\b|[.;)]|$))`, "gi"), "");
      out = out.replace(new RegExp(`\\s+and\\s+${t}(?![\\w])(?=\\s*(?:[.;,)]|$))`, "gi"), "");
    }
  }
  out = tidyLine(out);
  if (out === sentence.trim() || skills.some((sk) => mentions(stripBold(out), sk))) return null;
  return out;
}

// Apply the exact removals to every item that is only about skills (a
// figure needs the model or the drop). Works on the sentence as it stands
// in the section, so bold markers around kept words stay.
export function surgicalPass(s: RepairSections, items: RepairItem[], registry?: ClaimsRegistry | null): { sections: RepairSections; changes: RepairChange[] } {
  const registered = registryMentions(registry);
  let cur = s;
  const changes: RepairChange[] = [];
  for (const it of items) {
    if (it.skills.length === 0 || it.figures.length > 0) continue;
    const orig = originalOf(cur, it.section, it.sentence);
    if (orig === null) continue;
    const trimmed = removeSkillMentions(orig, it.skills, it.section === "skills", mentionsFor(it, registered));
    if (trimmed === null) continue;
    const next = applyToSection(cur, it.section, it.sentence, trimmed);
    if (!next) continue;
    cur = next;
    const after = stripBold(trimmed);
    changes.push({ section: it.section, before: it.sentence, after, how: "trimmed", ...wordChanges(it.sentence, after) });
  }
  return { sections: cur, changes };
}

// Run the surgical pass until it stops finding anything (a trim can expose
// the next rule the same skill breaks). Bounded.
export function surgicalUntilStable(
  s: RepairSections,
  registry: ClaimsRegistry | null,
  sources: (string | null | undefined)[],
  jd: string,
  grafts: GraftRule[] = []
): { sections: RepairSections; changes: RepairChange[] } {
  let cur = s;
  const changes: RepairChange[] = [];
  for (let round = 0; round < 4; round++) {
    const pass = surgicalPass(cur, listRepairs(cur, checkSections(cur, registry, sources, jd, grafts), registry), registry);
    if (pass.changes.length === 0) break;
    cur = pass.sections;
    changes.push(...pass.changes);
  }
  return { sections: cur, changes };
}

// ── Stage 2: the model's edits ───────────────────────────────────────────────

export type RepairEdits = Map<string, string>;

// {"edits":[{"id":"r1","replacement":"…"}]} → id → replacement, for known
// ids only; a replacement is one sentence, bounded, with no bullet glyph.
export function normalizeRepairEdits(raw: unknown, items: RepairItem[]): RepairEdits {
  const out: RepairEdits = new Map();
  const ids = new Set(items.map((i) => i.id));
  const list = raw && typeof raw === "object" && Array.isArray((raw as { edits?: unknown }).edits) ? (raw as { edits: unknown[] }).edits : [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const id = (e as { id?: unknown }).id;
    const rep = (e as { replacement?: unknown }).replacement;
    if (typeof id !== "string" || !ids.has(id) || typeof rep !== "string") continue;
    out.set(id, rep.replace(BULLET_RE, "").replace(/\s+/g, " ").trim().slice(0, 600));
  }
  return out;
}

// Whether a replacement breaks no rule on its own: no skill above its level
// and no figure absent from the sources (the letter may also quote the
// posting). A rewrite that fails is not applied.
export function replacementPasses(
  replacement: string,
  section: RepairSection,
  registry: ClaimsRegistry | null,
  sources: (string | null | undefined)[],
  jd: string,
  grafts: GraftRule[] = []
): boolean {
  if (!replacement.trim()) return true;
  const letter = section === "coverLetter";
  const c = checkClaims(
    [
      {
        where: letter ? "coverLetter" : "cv",
        text: replacement,
        experience: section === "experience" ? replacement : undefined,
        skills: section === "skills" ? replacement : undefined,
        extraSources: letter ? [jd] : undefined,
      },
    ],
    registry,
    sources,
    grafts
  );
  return c.skillViolations.length === 0 && !c.numberViolations.some((n) => n.kind === "absent" || n.kind === "combined");
}

export function applyModelEdits(
  s: RepairSections,
  items: RepairItem[],
  edits: RepairEdits,
  accept: (item: RepairItem, replacement: string) => boolean = () => true
): { sections: RepairSections; changes: RepairChange[]; rejected: number } {
  let cur = s;
  const changes: RepairChange[] = [];
  let rejected = 0;
  for (const it of items) {
    const rep = edits.get(it.id);
    if (rep === undefined) continue;
    if (!accept(it, rep)) {
      rejected++;
      continue;
    }
    const orig = originalOf(cur, it.section, it.sentence);
    const next = applyToSection(cur, it.section, it.sentence, rep && orig ? rebold(orig, rep) : rep);
    if (!next) continue;
    cur = next;
    changes.push(
      rep
        ? { section: it.section, before: it.sentence, after: rep, how: "rewritten", ...wordChanges(it.sentence, rep) }
        : { section: it.section, before: it.sentence, after: "", how: "removed" }
    );
  }
  return { sections: cur, changes, rejected };
}

// ── Stage 3: drop what still fails ───────────────────────────────────────────

export function dropPass(s: RepairSections, items: RepairItem[]): { sections: RepairSections; changes: RepairChange[] } {
  let cur = s;
  const changes: RepairChange[] = [];
  for (const it of items) {
    const next = applyToSection(cur, it.section, it.sentence, "");
    if (!next) continue;
    cur = next;
    changes.push({ section: it.section, before: it.sentence, after: "", how: "removed" });
  }
  return { sections: cur, changes };
}

// Trim, then drop, until the check has nothing left to list (bounded: each
// round changes at least one sentence, and a removed sentence cannot be
// listed again).
export function dropUntilClean(
  s: RepairSections,
  registry: ClaimsRegistry | null,
  sources: (string | null | undefined)[],
  jd: string,
  grafts: GraftRule[] = []
): { sections: RepairSections; changes: RepairChange[] } {
  let cur = s;
  const changes: RepairChange[] = [];
  for (let round = 0; round < 6; round++) {
    const trimmed = surgicalUntilStable(cur, registry, sources, jd, grafts);
    cur = trimmed.sections;
    changes.push(...trimmed.changes);
    const items = listRepairs(cur, checkSections(cur, registry, sources, jd, grafts), registry);
    if (items.length === 0) break;
    const dropped = dropPass(cur, items);
    if (dropped.changes.length === 0) break;
    cur = dropped.sections;
    changes.push(...dropped.changes);
  }
  return { sections: cur, changes };
}
