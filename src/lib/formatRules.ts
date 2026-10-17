// Hard post-generation formatting rules for the tailored CV.
//
// WHY: the prompts state the rules ("exactly 3 lines", a bounded tools list)
// and the model breaks them anyway — real runs produced a 25-item Technical
// Tools line and a three-paragraph, ~180-word summary. A rule the prompt
// carries is a request; a rule enforced here is a fact. Nothing is rewritten:
// tools and sentences are dropped, and the run reports what it dropped so the
// user sees it. The one addition is restoreAskedTools(): a tool the posting
// asks for that the candidate's own skills list names goes back on the line.
// separateSkillLines() then keeps the two skills lines apart (the UKJI shape:
// capabilities on Functional Competencies, named technologies on Technical
// Tools, no item on both).
//
// Imports only relative modules with the extension (./atsMatch.ts,
// ./claims.ts, ./roleTitle.ts) so it runs on the server and under node:test
// with no `@/` alias.

import { matchAtsKeywords } from "./atsMatch.ts";
import { namesRequirement, sectionsOf, distinctiveTokens, learningText, TOOLS_LEAD_SLOTS, type ClaimsRegistry } from "./claims.ts";
import { titleInText } from "./roleTitle.ts";
import { FLAT_SKILLS, type SkillsShape } from "./formatStyles/ids.ts";
import { parseSkillsBlock, toolItems, toolLines, writeToolLines, keepToolItems, addToolItem, dropStrayLines } from "./skillsLines.ts";

export const MAX_TECHNICAL_TOOLS = 15;
export const MAX_SUMMARY_SENTENCES = 3;
// A summary is read in seconds; past this the last sentence goes (never the
// one carrying the role title, never below two sentences).
export const MAX_SUMMARY_WORDS = 85;

// The label as the model writes it, bold or plain: "Technical Tools:",
// "**Technical Tools:**" or "**Technical Tools**:". Groups 1 and 3 keep the
// markers so the rebuilt line reads exactly as it did. (The plain-only form
// silently skipped every bold line — the 15-tool cap never ran on real output.)
const TOOLS_LABEL = /^(\s*\**\s*)(technical tools)(\s*\**\s*:\s*\**\s*)(.*)$/i;
const SEP = " | ";

export type ToolsFix = { kept: string[]; dropped: string[] };
export type SummaryFix = { sentences: number; kept: number; words?: number };
// unsupportedTools: Technical Tools the master CV and pool never name.
// competencies: Functional Competencies naming a work context (clients,
// stakeholders, insurance …) the master CV never shows.
export type FormatFixes = {
  tools: ToolsFix | null;
  summary: SummaryFix | null;
  unsupportedTools?: string[] | null;
  competencies?: string[] | null;
  // Tools the posting asks for that the master CV's own skills list names,
  // put back on the Technical Tools line.
  restoredTools?: string[] | null;
  // separateSkillLines(): practice phrases moved from Technical Tools to
  // Functional Competencies, and items dropped from one line because the
  // other already carries them.
  skillLines?: SkillLinesFix | null;
  // dedupeSkillLines(): a later line with a label an earlier one already
  // carries ("Technical Tools:" written twice — the Marshall Wace CV, 30 Sep),
  // or an exact repeat of an earlier line.
  duplicateLines?: string[] | null;
  // dropStrayLines() (grouped blocks only): lines under the skills labels that
  // are not skills at all — the model's own commentary or rationale.
  strayLines?: string[] | null;
  // The British-English pass (lib/britishSpelling): how many words changed,
  // and the first few as "from → to".
  spelling?: { count: number; examples: string[] } | null;
  // The real-page-count fit (lib/onePage fitToRealPages): the built PDF ran
  // past the target and these bullets went, or it still does not fit.
  pageOverflow?: { target: 1 | 2; pagesBefore: number; pagesAfter: number; dropped: { where: "experience" | "projects"; owner: string; bullet: string }[]; fits: boolean } | null;
  // The style pass (lib/stylePass, CareerSet): bold markers, highlight
  // prefixes and trailing full stops removed from the bullets, banned words
  // swapped for the plain equivalent the style allows or dropped.
  style?: { debolded: number; highlightsStripped: number; fullStopsStripped: number; swapped: { where: "experience" | "projects"; from: string; to: string; bullet: string }[] } | null;
};
export type SkillLinesFix = { moved: string[]; removedFromTools: string[]; removedFromCompetencies: string[] };

function splitTools(list: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list.split(/\s*\|\s*/)) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function termList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && k.trim() !== "") : [];
}

// Keeps the `max` most JD-relevant tools on the "Technical Tools:" line, in
// the model's original order within each relevance tier. Relevance is the
// deterministic matcher's: a tool that the role's required skills name
// outranks one only its keywords name, which outranks one the JD never
// mentions. Any other line of the skills block is left exactly as it was.
export function capTechnicalTools(
  skills: unknown,
  keywords: unknown,
  required: unknown,
  max = MAX_TECHNICAL_TOOLS,
  shape: SkillsShape = FLAT_SKILLS
): { skills: unknown; fix: ToolsFix | null } {
  if (typeof skills !== "string") return { skills, fix: null };
  if (shape.grouped) return capToolsGrouped(skills, keywords, required, max, shape);
  const lines = skills.split("\n");
  const idx = lines.findIndex((l) => TOOLS_LABEL.test(l));
  if (idx === -1) return { skills, fix: null };
  const m = TOOLS_LABEL.exec(lines[idx])!;
  const tools = splitTools(m[4]);
  if (tools.length <= max) return { skills, fix: null };

  const req = termList(required);
  const kw = termList(keywords);
  const tier = (tool: string) =>
    matchAtsKeywords(tool, req).matched > 0 ? 0 : matchAtsKeywords(tool, kw).matched > 0 ? 1 : 2;
  const ranked = tools
    .map((tool, order) => ({ tool, order, tier: tier(tool) }))
    .sort((a, b) => a.tier - b.tier || a.order - b.order);
  const keptSet = new Set(ranked.slice(0, max).map((r) => r.tool));
  // Original order for the kept tools, so the line still reads as the model wrote it.
  const kept = tools.filter((t) => keptSet.has(t));
  const dropped = tools.filter((t) => !keptSet.has(t));
  lines[idx] = `${m[1]}${m[2]}${m[3]}${kept.join(SEP)}`;
  return { skills: lines.join("\n"), fix: { kept, dropped } };
}

// The grouped block (lib/formatStyles, CareerSet): the cap ranks every
// tool across the group lines by the same tiers, keeps each line's own
// order and drops a line left with nothing.
function capToolsGrouped(skills: string, keywords: unknown, required: unknown, max: number, shape: SkillsShape): { skills: unknown; fix: ToolsFix | null } {
  const block = parseSkillsBlock(skills, shape);
  const tools = toolItems(block);
  if (tools.length <= max) return { skills, fix: null };
  const req = termList(required);
  const kw = termList(keywords);
  const tier = (tool: string) => (matchAtsKeywords(tool, req).matched > 0 ? 0 : matchAtsKeywords(tool, kw).matched > 0 ? 1 : 2);
  const ranked = tools.map((tool, order) => ({ tool, order, tier: tier(tool) })).sort((a, b) => a.tier - b.tier || a.order - b.order);
  const keptSet = new Set(ranked.slice(0, max).map((r) => r.tool));
  return { skills: keepToolItems(block, keptSet), fix: { kept: tools.filter((t) => keptSet.has(t)), dropped: tools.filter((t) => !keptSet.has(t)) } };
}

// Sentence boundaries: end punctuation, whitespace, then a capital, digit or
// opening quote/bracket — so "2.3m", "e.g." mid-sentence and "Node.js" don't
// split. A hard line break also ends a sentence.
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])|\n+/;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The summary is three lines; a summary that arrives as paragraphs is cut to
// its first `max` sentences, one per line. A compliant summary is returned
// untouched (blank lines between its lines are collapsed either way, so the
// preview never renders empty paragraphs).
export function capSummary(summary: unknown, max = MAX_SUMMARY_SENTENCES, roleTitle = "", maxWords = MAX_SUMMARY_WORDS): { summary: unknown; fix: SummaryFix | null } {
  if (typeof summary !== "string") return { summary, fix: null };
  const collapsed = summary.replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").trim();
  const sentences = splitSentences(collapsed);
  let kept = sentences.slice(0, max);
  const words = (list: string[]) => list.join(" ").split(/\s+/).filter(Boolean).length;
  // Too long to read at a glance: drop the last sentence — unless it is the
  // one carrying the role title, or only two would be left.
  const before = words(kept);
  let capped = false;
  if (before > maxWords && kept.length > 2) {
    const last = kept[kept.length - 1];
    if (!(roleTitle && titleInText(last, roleTitle) && !titleInText(kept.slice(0, -1).join(" "), roleTitle))) {
      kept = kept.slice(0, -1);
      capped = true;
    }
  }
  if (kept.length === sentences.length) return { summary: collapsed, fix: null };
  return { summary: kept.join("\n"), fix: { sentences: sentences.length, kept: kept.length, ...(capped ? { words: before } : {}) } };
}

// ── Evidence-bound skills ────────────────────────────────────────────────────

// Technical Tools the master CV and pool never name are dropped: the list is
// a claim that each tool was used, and the prompt's "verbatim from the CV"
// rule is a request, not a guarantee.
export function dropUnsupportedTools(skills: unknown, sources: (string | null | undefined)[], shape: SkillsShape = FLAT_SKILLS): { skills: unknown; dropped: string[] } {
  if (typeof skills !== "string") return { skills, dropped: [] };
  const corpus = sources.filter((s): s is string => typeof s === "string" && s.trim() !== "").join("\n");
  if (!corpus) return { skills, dropped: [] };
  if (shape.grouped) {
    const block = parseSkillsBlock(skills, shape);
    const tools = toolItems(block);
    const kept = tools.filter((t) => namesRequirement(corpus, t.replace(/\*\*/g, "")));
    const dropped = tools.filter((t) => !kept.includes(t));
    if (dropped.length === 0 || kept.length === 0) return { skills, dropped: [] };
    return { skills: keepToolItems(block, new Set(kept)), dropped };
  }
  const lines = skills.split("\n");
  const idx = lines.findIndex((l) => TOOLS_LABEL.test(l));
  if (idx === -1) return { skills, dropped: [] };
  const m = TOOLS_LABEL.exec(lines[idx])!;
  const tools = splitTools(m[4]);
  const kept = tools.filter((t) => namesRequirement(corpus, t.replace(/\*\*/g, "")));
  const dropped = tools.filter((t) => !kept.includes(t));
  if (dropped.length === 0 || kept.length === 0) return { skills, dropped: [] };
  lines[idx] = `${m[1]}${m[2]}${m[3]}${kept.join(SEP)}`;
  return { skills: lines.join("\n"), dropped };
}

// A Functional Competency naming a work context the master CV never shows
// ("Client-facing technical problem-solving", "Stakeholder collaboration")
// is the posting's language grafted onto the candidate — dropped. The words
// are contexts a CV either evidences or does not; a general capability
// ("REST API design") is left to the prompt.
const CONTEXT_WORDS = [
  "client", "customer", "stakeholder", "consult", "sales", "presales", "pre-sales", "mentor", "coach", "leadership", "cross-functional", "code review",
  "line management", "people management", "team lead", "hiring", "recruit", "insur", "actuar", "underwrit", "reinsur",
  "banking", "trading", "healthcare", "clinical", "regulat", "commercial", "negotiat", "vendor", "procurement",
  "marketing", "budget", "pricing",
];
const COMPETENCIES_LABEL = /^(\s*\**\s*)(functional competencies)(\s*\**\s*:\s*\**\s*)(.*)$/i;
export function dropUnsupportedCompetencies(skills: unknown, sources: (string | null | undefined)[]): { skills: unknown; dropped: string[] } {
  if (typeof skills !== "string") return { skills, dropped: [] };
  const corpus = sources.filter((s): s is string => typeof s === "string").join("\n").toLowerCase();
  if (!corpus.trim()) return { skills, dropped: [] };
  const lines = skills.split("\n");
  const idx = lines.findIndex((l) => COMPETENCIES_LABEL.test(l));
  if (idx === -1) return { skills, dropped: [] };
  const m = COMPETENCIES_LABEL.exec(lines[idx])!;
  const items = splitTools(m[4]);
  // A personal quality is not a competency ("Problem-solving and debugging"
  // is kept for "debugging"; "Self-directed learning" goes).
  const QUALITY_RE =
    /\b(?:problem[- ]solving|communication|self[- ]directed(?:\s+learning)?|rapid\s+(?:skill\s+acquisition|learning)|continuous\s+learning|learning\s+agility|adaptab\w*|attention\s+to\s+detail|analytical\s+thinking|team\s*work|work\s+ethic|curiosity)\b/gi;
  const unsupported = (item: string) => {
    const t = item.toLowerCase();
    if (CONTEXT_WORDS.some((w) => t.includes(w) && !corpus.includes(w))) return true;
    QUALITY_RE.lastIndex = 0;
    if (!QUALITY_RE.test(item)) return false;
    // Only when nothing concrete is left once the qualities are taken out.
    const rest = item.replace(QUALITY_RE, " ").replace(/\b(?:and|&|with|across|of|in|for|the|skills?)\b/gi, " ").replace(/[^a-z]+/gi, " ").trim();
    return rest.length < 4;
  };
  const kept = items.filter((i) => !unsupported(i));
  const dropped = items.filter((i) => unsupported(i));
  if (dropped.length === 0) return { skills, dropped: [] };
  if (kept.length === 0) lines.splice(idx, 1);
  else lines[idx] = `${m[1]}${m[2]}${m[3]}${kept.join(SEP)}`;
  return { skills: lines.join("\n"), dropped };
}

// ── Two lines, no shared item ───────────────────────────────────────────────

// A master CV line that lists capabilities rather than tools.
const COMPETENCY_LINE_RE = /^\s*\**\s*(?:functional|core|key|professional)?\s*competenc(?:y|ies)\b|^\s*\**\s*(?:soft|personal|interpersonal|transferable)\s+skills\b/i;

// A capability, not a technology: two or more words ending in a practice
// noun ("Full-Stack Development", "REST API Design", "AI/LLM Integration",
// "Unit Testing"). A named tool keeps its own name ("REST APIs", "CI/CD",
// "Spring Security").
const PRACTICE_NOUNS = new Set([
  "development", "design", "engineering", "architecture", "integration", "optimisation", "optimization", "testing",
  "automation", "deployment", "delivery", "programming", "modelling", "modeling", "implementation", "debugging", "documentation",
]);
export function isPracticePhrase(item: string): boolean {
  const words = item.replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return PRACTICE_NOUNS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ""));
}
const itemKey = (s: string) => s.replace(/\*\*/g, "").toLowerCase().replace(/[^a-z0-9+#]+/g, "");

// The two skills lines in the UKJI shape never share an item: Functional
// Competencies are capabilities, Technical Tools are named technologies. The
// owner's run on 27 Sep printed "Python Backend Development" and "Full-Stack
// Development" on both. A practice phrase on the Tools line moves to
// Competencies when that line lacks it and has room (at most
// MAX_COMPETENCIES), and otherwise leaves Tools; a named technology written on
// both lines stays on Tools. Without a Competencies line nothing moves.
export const MAX_COMPETENCIES = 6;
export function separateSkillLines(skills: unknown, shape: SkillsShape = FLAT_SKILLS, maxCompetencies = MAX_COMPETENCIES): { skills: unknown; fix: SkillLinesFix | null } {
  if (typeof skills !== "string") return { skills, fix: null };
  if (shape.grouped) return separateGrouped(skills, shape, maxCompetencies);
  const lines = skills.split("\n");
  const ti = lines.findIndex((l) => TOOLS_LABEL.test(l));
  const ci = lines.findIndex((l) => COMPETENCIES_LABEL.test(l));
  if (ti === -1 || ci === -1) return { skills, fix: null };
  const tm = TOOLS_LABEL.exec(lines[ti])!;
  const cm = COMPETENCIES_LABEL.exec(lines[ci])!;
  const tools = splitTools(tm[4]);
  const comps = splitTools(cm[4]);
  const compKeys = new Set(comps.map(itemKey));
  const moved: string[] = [];
  const removedFromTools: string[] = [];
  const keptTools: string[] = [];
  for (const t of tools) {
    if (!isPracticePhrase(t)) {
      keptTools.push(t);
      continue;
    }
    if (!compKeys.has(itemKey(t)) && comps.length < maxCompetencies) {
      comps.push(t);
      compKeys.add(itemKey(t));
      moved.push(t);
    } else {
      removedFromTools.push(t);
    }
  }
  const toolKeys = new Set(keptTools.map(itemKey));
  const removedFromCompetencies = comps.filter((c) => toolKeys.has(itemKey(c)));
  // A line of nothing but repeats is left alone rather than emptied.
  const keptComps = removedFromCompetencies.length < comps.length ? comps.filter((c) => !toolKeys.has(itemKey(c))) : comps;
  if (moved.length === 0 && removedFromTools.length === 0 && keptComps.length === comps.length) return { skills, fix: null };
  if (keptTools.length === 0) return { skills, fix: null };
  lines[ti] = `${tm[1]}${tm[2]}${tm[3]}${keptTools.join(SEP)}`;
  lines[ci] = `${cm[1]}${cm[2]}${cm[3]}${keptComps.join(SEP)}`;
  return {
    skills: lines.join("\n"),
    fix: { moved, removedFromTools, removedFromCompetencies: keptComps.length === comps.length ? [] : removedFromCompetencies },
  };
}

// The grouped block: a practice phrase leaves whichever group line carries
// it, for the competencies line when that has room (the style's cap — 12
// for CareerSet, where 6 would have thrown every phrase away), and a tool
// named on both sides stays with its group.
function separateGrouped(skills: string, shape: SkillsShape, maxCompetencies: number): { skills: unknown; fix: SkillLinesFix | null } {
  const block = parseSkillsBlock(skills, shape);
  if (!block.competencies || block.groups.length === 0) return { skills, fix: null };
  const cm = block.competencies;
  const comps = [...cm.items];
  const compKeys = new Set(comps.map(itemKey));
  const moved: string[] = [];
  const removedFromTools: string[] = [];
  const perLine = toolLines(block).map((l) =>
    l.items.filter((t) => {
      if (!isPracticePhrase(t)) return true;
      if (!compKeys.has(itemKey(t)) && comps.length < maxCompetencies) {
        comps.push(t);
        compKeys.add(itemKey(t));
        moved.push(t);
      } else {
        removedFromTools.push(t);
      }
      return false;
    })
  );
  const keptTools = perLine.flat();
  const toolKeys = new Set(keptTools.map(itemKey));
  const removedFromCompetencies = comps.filter((c) => toolKeys.has(itemKey(c)));
  const keptComps = removedFromCompetencies.length < comps.length ? comps.filter((c) => !toolKeys.has(itemKey(c))) : comps;
  if (moved.length === 0 && removedFromTools.length === 0 && keptComps.length === comps.length) return { skills, fix: null };
  if (keptTools.length === 0) return { skills, fix: null };
  const lines = [...block.lines];
  lines[cm.index] = `${cm.prefix}${keptComps.join(SEP)}`;
  const rebuilt = parseSkillsBlock(lines.join("\n"), shape);
  return {
    skills: writeToolLines(rebuilt, perLine),
    fix: { moved, removedFromTools, removedFromCompetencies: keptComps.length === comps.length ? [] : removedFromCompetencies },
  };
}

// ── Tools the posting asks for ───────────────────────────────────────────────

// The one rule here that adds rather than drops. A tool the posting asks for
// that the candidate's OWN skills list names (directly, or as an exact
// implication — SQL by PostgreSQL), missing from the tailored Technical Tools
// line, goes back in: in place of the last tool the posting never mentions
// when the line is full. The Somak run on 26 Sep left out JavaScript, which
// the master CV lists and the posting searched for. Never a learning-level
// skill, never a project-level one into the first TOOLS_LEAD_SLOTS, never a
// phrase ("Accessibility" is not on the owner's list, so it never lands).
export const MAX_RESTORED_TOOLS = 3;
type AskedCandidate = { name: string; project: boolean };
// The posting's terms the master CV's own tool lines name, in posting order,
// each with whether the registry holds it at project level — computed once
// against the skills text as it arrived; the two shapes below consume them.
// `asked`: whether a tool on the line is one the posting names (the slot a
// restored tool may take is the last that is not).
function askedToolCandidates(
  skills: string,
  analysis: unknown,
  masterCv: string,
  registry?: ClaimsRegistry | null
): { candidates: AskedCandidate[]; asked: (tool: string) => boolean } | null {
  // A "Currently learning: Kubernetes" line is no evidence: without it the
  // eval harness's CVs got Flink and Kubernetes restored (26 Sep).
  const learnt = learningText(masterCv || "");
  const learntLines = learnt.split("\n").map((l) => l.trim()).filter(Boolean);
  // The master CV's TOOL lines: its competencies line lists capabilities
  // ("Full-Stack Development"), and restoring those as tools printed them on
  // both skills lines (the owner's run, 27 Sep).
  const masterSkills = sectionsOf(masterCv || "")
    .skills.filter((l) => !learntLines.some((x) => l.includes(x) || x.includes(l.trim())))
    .filter((l) => !COMPETENCY_LINE_RE.test(l))
    .join("\n");
  if (!masterSkills.trim()) return null;
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  const req = termList(a.required_skills);
  const kw = termList(a.top_15_ats_keywords);
  // Named by the posting either way round: "PostgreSQL" is asked for by
  // "PostgreSQL and database design".
  const asked = (tool: string) => [...req, ...kw].some((term) => matchAtsKeywords(tool, [term]).matched > 0 || matchAtsKeywords(term, [tool]).matched > 0);
  const levelled = (t: string, level: string) =>
    (registry?.skills ?? []).some((s) => s.level === level && (matchAtsKeywords(t, [s.name]).matched > 0 || matchAtsKeywords(s.name, [t]).matched > 0));
  // The master CV's own spelling when it lists the tool by name.
  const masterItems = masterSkills.split(/[,|;\n]|\s\/\s/).map((s) => s.replace(/^[^:]*:\s*/, "").replace(/\s*\([^)]*\)\s*/g, " ").trim()).filter(Boolean);
  const candidates: AskedCandidate[] = [];
  for (const term of [...req, ...kw]) {
    const t = term.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.split(" ").length > 3 || /\s(?:and|or|&)\s|,/i.test(t)) continue;
    // A capability is never a tool; and a term the skills block already
    // carries on either line needs no second mention.
    if (isPracticePhrase(t) || matchAtsKeywords(skills, [t]).matched > 0) continue;
    if (!namesRequirement(masterSkills, t) || levelled(t, "learning") || (learnt && namesRequirement(learnt, t))) continue;
    // An item the master CV lists by name, or one distinctive name it
    // implies ("SQL" by PostgreSQL) — never a concept ("Relational
    // databases", "API development" read as tools on the first try).
    const listed = masterItems.find((i) => i.toLowerCase() === t.toLowerCase()) ?? masterItems.find((i) => matchAtsKeywords(i, [t]).matched > 0 && i.split(" ").length <= 3);
    const name = listed ?? (!t.includes(" ") && distinctiveTokens(t).length > 0 ? t : null);
    if (!name) continue;
    candidates.push({ name, project: levelled(t, "project") });
  }
  return { candidates, asked };
}

// `shape`, `maxTools`, `leadSlots` (lib/formatStyles): the grouped block puts
// a restored tool in the group a reader expects (lib/skillsLines groupFor) —
// creating the line when the block has none — or in place of the last tool
// the posting never mentions, in reading order; the flat line is as before.
export function restoreAskedTools(
  skills: unknown,
  analysis: unknown,
  masterCv: string,
  registry?: ClaimsRegistry | null,
  shape: SkillsShape = FLAT_SKILLS,
  maxTools = MAX_TECHNICAL_TOOLS,
  leadSlots = TOOLS_LEAD_SLOTS
): { skills: unknown; restored: string[] } {
  if (typeof skills !== "string") return { skills, restored: [] };
  const found = askedToolCandidates(skills, analysis, masterCv, registry);
  if (!found) return { skills, restored: [] };
  const { candidates, asked } = found;
  const same = (tools: string[], name: string) => tools.some((x) => x.toLowerCase() === name.toLowerCase());
  const restored: string[] = [];
  if (shape.grouped) {
    let block = parseSkillsBlock(skills, shape);
    if (!block.header && block.groups.length === 0) return { skills, restored };
    for (const c of candidates) {
      if (restored.length >= MAX_RESTORED_TOOLS) break;
      const tools = toolItems(block);
      if (same(tools, c.name)) continue;
      if (tools.length < maxTools) {
        if (c.project && tools.length < leadSlots) continue;
        block = parseSkillsBlock(addToolItem(block, c.name, null), shape);
      } else {
        let slot = -1;
        for (let i = tools.length - 1; i >= (c.project ? leadSlots : 0); i--) {
          if (!asked(tools[i])) {
            slot = i;
            break;
          }
        }
        if (slot === -1) continue;
        const perLine = toolLines(block).map((l) => [...l.items]);
        let k = 0;
        outer: for (const line of perLine) {
          for (let j = 0; j < line.length; j++, k++) {
            if (k === slot) {
              line[j] = c.name;
              break outer;
            }
          }
        }
        block = parseSkillsBlock(writeToolLines(block, perLine), shape);
      }
      restored.push(c.name);
    }
    return { skills: block.lines.join("\n"), restored };
  }
  const lines = skills.split("\n");
  const idx = lines.findIndex((l) => TOOLS_LABEL.test(l));
  if (idx === -1) return { skills, restored: [] };
  const m = TOOLS_LABEL.exec(lines[idx])!;
  const tools = splitTools(m[4]);
  for (const c of candidates) {
    if (restored.length >= MAX_RESTORED_TOOLS) break;
    if (same(tools, c.name)) continue;
    if (tools.length < maxTools) {
      if (c.project && tools.length < leadSlots) continue;
      tools.push(c.name);
    } else {
      let slot = -1;
      for (let i = tools.length - 1; i >= (c.project ? leadSlots : 0); i--) {
        if (!asked(tools[i])) {
          slot = i;
          break;
        }
      }
      if (slot === -1) continue;
      tools[slot] = c.name;
    }
    restored.push(c.name);
  }
  if (restored.length === 0) return { skills, restored };
  lines[idx] = `${m[1]}${m[2]}${m[3]}${tools.join(SEP)}`;
  return { skills: lines.join("\n"), restored };
}

// The limits one style's rules run with (lib/formatStyles): the skills
// block's shape and its caps. The default is UKJI's, exactly as before.
export type FormatRuleLimits = {
  skills: SkillsShape;
  maxTools: number;
  maxCompetencies: number;
  maxSummarySentences: number;
  maxSummaryWords: number;
  leadSlots: number;
};
export function formatRulesFor(style: {
  skills: SkillsShape;
  limits: { tools: { max: number; leadSlots: number }; competencies: { max: number }; summary: { maxSentences: number; maxWords: number } };
}): FormatRuleLimits {
  return {
    skills: style.skills,
    maxTools: style.limits.tools.max,
    maxCompetencies: style.limits.competencies.max,
    maxSummarySentences: style.limits.summary.maxSentences,
    maxSummaryWords: style.limits.summary.maxWords,
    leadSlots: style.limits.tools.leadSlots,
  };
}

// `sources`: the master CV and pool — omitted, the evidence-bound rules
// are skipped (the caller has nothing to hold the skills to). `registry`:
// the claims registry, for the tools restored from the master CV's list.
// `rules`: the style's shape and caps (UKJI's when omitted).
export function applyFormatRules(
  sections: { summary: unknown; skills: unknown },
  analysis: unknown,
  sources: (string | null | undefined)[] = [],
  roleTitle = "",
  registry: ClaimsRegistry | null = null,
  rules: FormatRuleLimits = { skills: FLAT_SKILLS, maxTools: MAX_TECHNICAL_TOOLS, maxCompetencies: MAX_COMPETENCIES, maxSummarySentences: MAX_SUMMARY_SENTENCES, maxSummaryWords: MAX_SUMMARY_WORDS, leadSlots: TOOLS_LEAD_SLOTS }
): { summary: unknown; skills: unknown; fixes: FormatFixes } {
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  // First, so every rule below works on the one line per label it expects
  // (each finds the FIRST matching line and would leave a second untouched).
  const deduped = dedupeSkillLines(sections.skills);
  // A grouped block keeps only its label lines (lib/skillsLines dropStrayLines).
  const stray =
    rules.skills.grouped && typeof deduped.skills === "string" ? dropStrayLines(deduped.skills, rules.skills) : { skills: deduped.skills, dropped: [] as string[] };
  const unsupported = dropUnsupportedTools(stray.skills, sources, rules.skills);
  const competencies = dropUnsupportedCompetencies(unsupported.skills, sources);
  const tools = capTechnicalTools(competencies.skills, a.top_15_ats_keywords, a.required_skills, rules.maxTools, rules.skills);
  const restored =
    typeof sources[0] === "string"
      ? restoreAskedTools(tools.skills, analysis, sources[0], registry, rules.skills, rules.maxTools, rules.leadSlots)
      : { skills: tools.skills, restored: [] };
  const separated = separateSkillLines(restored.skills, rules.skills, rules.maxCompetencies);
  const summary = capSummary(sections.summary, rules.maxSummarySentences, roleTitle, rules.maxSummaryWords);
  return {
    summary: summary.summary,
    skills: separated.skills,
    fixes: {
      tools: tools.fix,
      summary: summary.fix,
      unsupportedTools: unsupported.dropped.length ? unsupported.dropped : null,
      competencies: competencies.dropped.length ? competencies.dropped : null,
      restoredTools: restored.restored.length ? restored.restored : null,
      skillLines: separated.fix,
      duplicateLines: deduped.dropped.length ? deduped.dropped : null,
      strayLines: stray.dropped.length ? stray.dropped : null,
    },
  };
}

// One skills line per label. The model sometimes writes "Technical Tools:"
// twice (plain then bold, or the block repeated); every rule above finds the
// first matching line, so the second passed through uncapped and printed
// twice in all three renderers. The later line goes, whatever it carries.
export function dedupeSkillLines(skills: unknown): { skills: unknown; dropped: string[] } {
  if (typeof skills !== "string") return { skills, dropped: [] };
  const seen = new Set<string>();
  const dropped: string[] = [];
  const lines = skills.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    const plain = t.replace(/\*\*/g, "").trim();
    const colon = plain.indexOf(":");
    const label = colon > 0 && colon <= 40 ? plain.slice(0, colon).trim().toLowerCase() : "";
    const key = label ? `label:${label}` : `line:${plain.toLowerCase()}`;
    if (seen.has(key)) {
      dropped.push(t);
      return false;
    }
    seen.add(key);
    return true;
  });
  return { skills: dropped.length ? lines.join("\n") : skills, dropped };
}
