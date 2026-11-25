// The Local Tailor contract (Chunk TL-1), shared by the website (enqueue +
// preview), the PC worker (which runs the model) and the benchmark.
//
// TL-1's first local task is the Professional Summary ONLY: 3 short lines for a
// JD, built from the master CV text. The honesty rule that matters most here is
// rule 4 (faithful metrics): the summary must never contain a number the master
// CV doesn't. `summaryNumbersSupported` enforces it deterministically, in code,
// on both the TypeScript side and (mirrored) in agent/bench/tailor_bench.py.
//
// Imports only ../prompts/rules.ts (an import-free constant), so it runs under
// node:test and could be reused by a TypeScript worker.

import { ABSOLUTE_RULES } from "../prompts/rules.ts";

export type TailorJobKind = "summary" | "select";
export type TailorJobStatus = "queued" | "claimed" | "processing" | "done" | "failed" | "cancelled";

// Output type for a "select" job: ranked bullet IDs with scores and what
// requirement each bullet best covers.
export type SelectResult = {
  experience: Array<{ id: string; score: number; coveredRequirement: string }>;
  model: string;
};

export type TailorJobInput = {
  kind: TailorJobKind;
  jd_text: string;
  master_cv: string;
  application_id?: string | null;
};

export type SummaryResult = {
  summary: string;
  // The honesty read, computed by the website when the worker reports back
  // (never trusted from the worker).
  numbersOk?: boolean;
  unsupportedNumbers?: string[];
};

export type TailorJobOutput = {
  summary: string;
  model?: string;
  tokensPerSec?: number | null;
};

export const MAX_JD_CHARS = 20_000;
export const MAX_CV_CHARS = 30_000;
export const MAX_SUMMARY_LINES = 3;
export const MAX_SUMMARY_CHARS = 600;

// What one paid summary-sized call would cost on the current premium provider,
// in GBP. A single ~1.5k-token completion at Sonnet-class pricing rounds to
// about a penny; deliberately conservative so the "saved" counter never
// overstates. The worker records this per local run; Settings totals it.
export const PREMIUM_SUMMARY_GBP = 0.01;

// The JSON schema the local model is constrained to (Ollama `format`). A single
// `summary` string — up to three short lines separated by newlines.
export const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
  },
  required: ["summary"],
  additionalProperties: false,
} as const;

// ── The prompt ───────────────────────────────────────────────────────────────

export function summarySystemPrompt(): string {
  return [
    "You write the Professional Summary at the top of a CV, tailored to one job.",
    "",
    "You are given the candidate's MASTER CV (the only source of truth) and a JOB DESCRIPTION.",
    "Write a Professional Summary of AT MOST three short lines (sentences) that emphasises the",
    "parts of the candidate's real experience most relevant to the job.",
    "",
    "Hard requirements:",
    "- Use ONLY facts, skills, technologies and numbers found in the master CV.",
    "- Do NOT invent or borrow any number, percentage, figure or date that is not in the master CV.",
    "- Do NOT copy phrases or requirements from the job description as if they were the candidate's.",
    "- No first person (\"I\", \"my\"). No placeholders. No hedging, no \"(learning)\" tags.",
    "- Plain British English. Three lines maximum.",
    "",
    ABSOLUTE_RULES.trim(),
    "",
    'Return ONLY JSON of the form {"summary": "<the summary text>"}.',
  ].join("\n");
}

export function summaryUserPrompt(input: { jdText: string; masterCv: string }): string {
  const jd = (input.jdText || "").slice(0, MAX_JD_CHARS);
  const cv = (input.masterCv || "").slice(0, MAX_CV_CHARS);
  return [
    "=== MASTER CV (source of truth) ===",
    cv,
    "",
    "=== JOB DESCRIPTION ===",
    jd,
    "",
    "Write the tailored Professional Summary now.",
  ].join("\n");
}

export function buildSummaryPrompt(input: { jdText: string; masterCv: string }): {
  system: string;
  prompt: string;
} {
  return { system: summarySystemPrompt(), prompt: summaryUserPrompt(input) };
}

// ── Cleaning the model's output ────────────────────────────────────────────────

// Keep at most MAX_SUMMARY_LINES non-empty lines, cap total length, strip
// bullet markers and markdown the summary should never carry.
export function cleanSummary(raw: string): string {
  const stripped = (raw || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .trim();
  const lines = stripped
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_LINES);
  return lines.join("\n").slice(0, MAX_SUMMARY_CHARS);
}

// Read a model's JSON (or plain text) result into a clean summary string.
export function summaryFromRaw(raw: unknown): string {
  if (typeof raw === "string") return cleanSummary(raw);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.summary === "string") return cleanSummary(o.summary);
    if (Array.isArray(o.lines)) return cleanSummary(o.lines.filter((l) => typeof l === "string").join("\n"));
  }
  return "";
}

// ── The honesty number check (rule 4) ──────────────────────────────────────────

// A spelled-out-number → digit map, so a master CV that writes "three days"
// still supports a summary that writes "3 days". Small on purpose.
const WORD_NUMBERS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000", million: "1000000",
};

// Matches a figure: optional currency, digits (with thousands separators and
// decimals), optional unit/suffix (% k m bn x +). Years and plain integers count.
const NUMBER_RE = /(?<![\w.])(?:[£$€]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k|m|bn|b|x|\+)?/gi;

// Normalise a matched figure to a canonical comparable token:
// "£45,000" → "45000", "40 %" → "40%", "150k" → "150k", "3+" → "3+".
export function normalizeNumber(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[£$€]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function digitTokensOf(text: string): Set<string> {
  const set = new Set<string>();
  const matches = (text || "").match(NUMBER_RE) ?? [];
  for (const m of matches) {
    const norm = normalizeNumber(m);
    if (norm) set.add(norm);
    // also the bare digits (no unit), so "40%" in the CV supports a summary "40"
    const bare = norm.replace(/[%kmbnx+]+$/, "");
    if (bare) set.add(bare);
  }
  return set;
}

// The master CV's supported numbers: its own figures plus digit forms of any
// spelled-out numbers it contains.
export function supportedNumbers(masterCv: string): Set<string> {
  const set = digitTokensOf(masterCv);
  const lower = (masterCv || "").toLowerCase();
  for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) set.add(digit);
  }
  return set;
}

// Every number in the summary must appear in the master CV. Returns the ones
// that do NOT — an empty list means the summary passes rule 4.
export function summaryNumbersSupported(
  summary: string,
  masterCv: string
): { ok: boolean; unsupported: string[] } {
  const supported = supportedNumbers(masterCv);
  const unsupported: string[] = [];
  const seen = new Set<string>();
  const matches = (summary || "").match(NUMBER_RE) ?? [];
  for (const m of matches) {
    const norm = normalizeNumber(m);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const bare = norm.replace(/[%kmbnx+]+$/, "");
    if (supported.has(norm) || supported.has(bare)) continue;
    unsupported.push(m.trim());
  }
  return { ok: unsupported.length === 0, unsupported };
}

// ── The cost counter ───────────────────────────────────────────────────────────

export function formatGbp(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `£${n.toFixed(2)}`;
}

// What the local runs saved so far: the paid cost of every tailor job that
// finished locally. Reads estimated_gbp off each done row.
export function totalSavedGbp(rows: Array<{ status: string; estimated_gbp?: number | null }>): number {
  return rows.reduce((sum, r) => (r.status === "done" ? sum + (Number(r.estimated_gbp) || 0) : sum), 0);
}

// ── Settings: the tailoring engine ──────────────────────────────────────────────

export type TailoringEngine = "premium" | "local";

export function engineLabel(engine: TailoringEngine): string {
  return engine === "local" ? "Local (free)" : "Premium (uses your key)";
}

// The website's read of a worker result: clean the summary and run the honesty
// check against the master CV it was tailored from (the worker's own verdict is
// never trusted).
export function readSummaryResult(rawOutput: unknown, masterCv: string): SummaryResult {
  const summary = summaryFromRaw(
    rawOutput && typeof rawOutput === "object" && "summary" in (rawOutput as object)
      ? (rawOutput as Record<string, unknown>).summary
      : rawOutput
  );
  const check = summaryNumbersSupported(summary, masterCv);
  return { summary, numbersOk: check.ok, unsupportedNumbers: check.unsupported };
}
