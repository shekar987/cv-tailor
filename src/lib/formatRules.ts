// Hard post-generation formatting rules for the tailored CV.
//
// WHY: the prompts state the rules ("exactly 3 lines", a bounded tools list)
// and the model breaks them anyway — real runs produced a 25-item Technical
// Tools line and a three-paragraph, ~180-word summary. A rule the prompt
// carries is a request; a rule enforced here is a fact. Nothing is added or
// rewritten: tools are dropped, sentences are dropped, and the run reports
// what it dropped so the user sees it.
//
// Imports only the matcher (relative, with the extension) so it runs on the
// server and under node:test with no `@/` alias.

import { matchAtsKeywords } from "./atsMatch.ts";

export const MAX_TECHNICAL_TOOLS = 15;
export const MAX_SUMMARY_SENTENCES = 3;

const TOOLS_LABEL = /^(\s*)(technical tools)(\s*:\s*)(.*)$/i;
const SEP = " | ";

export type ToolsFix = { kept: string[]; dropped: string[] };
export type SummaryFix = { sentences: number; kept: number };
export type FormatFixes = { tools: ToolsFix | null; summary: SummaryFix | null };

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
export function capSummary(summary: unknown, max = MAX_SUMMARY_SENTENCES): { summary: unknown; fix: SummaryFix | null } {
  if (typeof summary !== "string") return { summary, fix: null };
  const collapsed = summary.replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").trim();
  const sentences = splitSentences(collapsed);
  if (sentences.length <= max) return { summary: collapsed, fix: null };
  return { summary: sentences.slice(0, max).join("\n"), fix: { sentences: sentences.length, kept: max } };
}

export function applyFormatRules(
  sections: { summary: unknown; skills: unknown },
  analysis: unknown
): { summary: unknown; skills: unknown; fixes: FormatFixes } {
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  const tools = capTechnicalTools(sections.skills, a.top_15_ats_keywords, a.required_skills);
  const summary = capSummary(sections.summary);
  return { summary: summary.summary, skills: tools.skills, fixes: { tools: tools.fix, summary: summary.fix } };
}
