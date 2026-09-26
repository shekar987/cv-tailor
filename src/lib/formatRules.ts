// Hard post-generation formatting rules for the tailored CV.
//
// WHY: the prompts state the rules ("exactly 3 lines", a bounded tools list)
// and the model breaks them anyway — real runs produced a 25-item Technical
// Tools line and a three-paragraph, ~180-word summary. A rule the prompt
// carries is a request; a rule enforced here is a fact. Nothing is rewritten:
// tools and sentences are dropped, and the run reports what it dropped so the
// user sees it. The one addition is restoreAskedTools(): a tool the posting
// asks for that the candidate's own skills list names goes back on the line.
//
// Imports only relative modules with the extension (./atsMatch.ts,
// ./claims.ts, ./roleTitle.ts) so it runs on the server and under node:test
// with no `@/` alias.

import { matchAtsKeywords } from "./atsMatch.ts";
import { namesRequirement, sectionsOf, distinctiveTokens, learningText, TOOLS_LEAD_SLOTS, type ClaimsRegistry } from "./claims.ts";
import { titleInText } from "./roleTitle.ts";

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
};

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
  max = MAX_TECHNICAL_TOOLS
): { skills: unknown; fix: ToolsFix | null } {
  if (typeof skills !== "string") return { skills, fix: null };
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
export function capSummary(summary: unknown, max = MAX_SUMMARY_SENTENCES, roleTitle = ""): { summary: unknown; fix: SummaryFix | null } {
  if (typeof summary !== "string") return { summary, fix: null };
  const collapsed = summary.replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").trim();
  const sentences = splitSentences(collapsed);
  let kept = sentences.slice(0, max);
  const words = (list: string[]) => list.join(" ").split(/\s+/).filter(Boolean).length;
  // Too long to read at a glance: drop the last sentence — unless it is the
  // one carrying the role title, or only two would be left.
  const before = words(kept);
  let capped = false;
  if (before > MAX_SUMMARY_WORDS && kept.length > 2) {
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
export function dropUnsupportedTools(skills: unknown, sources: (string | null | undefined)[]): { skills: unknown; dropped: string[] } {
  if (typeof skills !== "string") return { skills, dropped: [] };
  const corpus = sources.filter((s): s is string => typeof s === "string" && s.trim() !== "").join("\n");
  if (!corpus) return { skills, dropped: [] };
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
export function restoreAskedTools(
  skills: unknown,
  analysis: unknown,
  masterCv: string,
  registry?: ClaimsRegistry | null
): { skills: unknown; restored: string[] } {
  if (typeof skills !== "string") return { skills, restored: [] };
  // A "Currently learning: Kubernetes" line is no evidence: without it the
  // eval harness's CVs got Flink and Kubernetes restored (26 Sep).
  const learnt = learningText(masterCv || "");
  const learntLines = learnt.split("\n").map((l) => l.trim()).filter(Boolean);
  const masterSkills = sectionsOf(masterCv || "")
    .skills.filter((l) => !learntLines.some((x) => l.includes(x) || x.includes(l.trim())))
    .join("\n");
  if (!masterSkills.trim()) return { skills, restored: [] };
  const lines = skills.split("\n");
  const idx = lines.findIndex((l) => TOOLS_LABEL.test(l));
  if (idx === -1) return { skills, restored: [] };
  const m = TOOLS_LABEL.exec(lines[idx])!;
  const tools = splitTools(m[4]);
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
  const restored: string[] = [];
  for (const term of [...req, ...kw]) {
    if (restored.length >= MAX_RESTORED_TOOLS) break;
    const t = term.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.split(" ").length > 3 || /\s(?:and|or|&)\s|,/i.test(t)) continue;
    if (matchAtsKeywords(tools.join(SEP), [t]).matched > 0) continue;
    if (!namesRequirement(masterSkills, t) || levelled(t, "learning") || (learnt && namesRequirement(learnt, t))) continue;
    // An item the master CV lists by name, or one distinctive name it
    // implies ("SQL" by PostgreSQL) — never a concept ("Relational
    // databases", "API development" read as tools on the first try).
    const listed = masterItems.find((i) => i.toLowerCase() === t.toLowerCase()) ?? masterItems.find((i) => matchAtsKeywords(i, [t]).matched > 0 && i.split(" ").length <= 3);
    const name = listed ?? (!t.includes(" ") && distinctiveTokens(t).length > 0 ? t : null);
    if (!name || tools.some((x) => x.toLowerCase() === name.toLowerCase())) continue;
    const project = levelled(t, "project");
    if (tools.length < MAX_TECHNICAL_TOOLS) {
      if (project && tools.length < TOOLS_LEAD_SLOTS) continue;
      tools.push(name);
    } else {
      let slot = -1;
      for (let i = tools.length - 1; i >= (project ? TOOLS_LEAD_SLOTS : 0); i--) {
        if (!asked(tools[i])) {
          slot = i;
          break;
        }
      }
      if (slot === -1) continue;
      tools[slot] = name;
    }
    restored.push(name);
  }
  if (restored.length === 0) return { skills, restored };
  lines[idx] = `${m[1]}${m[2]}${m[3]}${tools.join(SEP)}`;
  return { skills: lines.join("\n"), restored };
}

// `sources`: the master CV and pool — omitted, the evidence-bound rules
// are skipped (the caller has nothing to hold the skills to). `registry`:
// the claims registry, for the tools restored from the master CV's list.
export function applyFormatRules(
  sections: { summary: unknown; skills: unknown },
  analysis: unknown,
  sources: (string | null | undefined)[] = [],
  roleTitle = "",
  registry: ClaimsRegistry | null = null
): { summary: unknown; skills: unknown; fixes: FormatFixes } {
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  const unsupported = dropUnsupportedTools(sections.skills, sources);
  const competencies = dropUnsupportedCompetencies(unsupported.skills, sources);
  const tools = capTechnicalTools(competencies.skills, a.top_15_ats_keywords, a.required_skills);
  const restored = typeof sources[0] === "string" ? restoreAskedTools(tools.skills, analysis, sources[0], registry) : { skills: tools.skills, restored: [] };
  const summary = capSummary(sections.summary, MAX_SUMMARY_SENTENCES, roleTitle);
  return {
    summary: summary.summary,
    skills: restored.skills,
    fixes: {
      tools: tools.fix,
      summary: summary.fix,
      unsupportedTools: unsupported.dropped.length ? unsupported.dropped : null,
      competencies: competencies.dropped.length ? competencies.dropped : null,
      restoredTools: restored.restored.length ? restored.restored : null,
    },
  };
}
