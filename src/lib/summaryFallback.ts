// A CareerSet CV always carries a summary (31 Oct 2026, Chunk 6). The fact
// check removes every sentence it cannot trace, and on a thin run that was
// all of them: the CV went out with a "Professional Summary" of the
// availability sentence alone, or no summary at all. When that happens the
// summary is rebuilt from the master CV itself, never written:
//
//   1. the master CV's own summary / profile section, its first sentences
//      within the style's sentence and word caps (verbatim — the master is
//      the source every claim must trace to, so it is supported by
//      definition); a right-to-work or availability sentence in it is
//      skipped, because the style appends the Eligibility one;
//   2. else one line built from the master's most recent role header and its
//      top languages: "Full Stack Engineer at Northgate Systems, working with
//      Python, TypeScript and SQL." — every word a master-CV fact.
//
// The availability sentence (when the style appends one) closes it, as on a
// normal run. topLanguages() is also what the header line leads its stack
// with (lib/headline leadLanguages).
//
// Imports only import-free siblings by relative .ts path, so it runs under
// node:test.
import { skillsFromCv } from "./claims.ts";
import { mentionsAvailability, mentionsRightToWork } from "./rightToWorkText.ts";

// Programming languages a skills list names. "Go", "C" and "R" only as a
// whole item, so "Go-to-market" or a stray letter never counts.
const LANGUAGE_NAMES = [
  "Python", "TypeScript", "JavaScript", "Java", "C#", "C++", "C", "Go", "Golang", "Rust", "Ruby", "PHP", "Kotlin",
  "Swift", "Scala", "SQL", "Bash", "Shell", "PowerShell", "Dart", "Elixir", "Haskell", "R", "MATLAB", "Perl", "Lua",
  "Objective-C", "Solidity", "HTML", "CSS",
];
const LANGUAGE_KEYS = new Map(LANGUAGE_NAMES.map((n) => [n.toLowerCase(), n]));
// Markup is a language on a skills line but not one a header should lead with.
const NOT_LEAD = new Set(["html", "css", "shell", "bash", "powershell"]);

/** The master CV's first `max` programming languages, in the order its skills list names them. */
export function topLanguages(cv: string, max = 3): string[] {
  const out: string[] = [];
  for (const { name } of skillsFromCv(cv)) {
    const k = name.trim().toLowerCase();
    if (!LANGUAGE_KEYS.has(k) || NOT_LEAD.has(k) || out.some((o) => o.toLowerCase() === k)) continue;
    out.push(name.trim());
    if (out.length >= max) break;
  }
  return out;
}

const SUMMARY_HEADING_RE = /^(?:professional\s+summary|personal\s+summary|career\s+summary|summary|profile|personal\s+profile|professional\s+profile|about(?:\s+me)?|objective|career\s+objective)\s*:?$/i;
const NEXT_HEADING_RE = /^(?:(?:technical|core|key)?\s*(?:skills|competencies|technologies|tools)|tech(?:nical)?\s+stack|(?:work|professional|relevant)?\s*experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?|(?:personal|selected|key|side)?\s*projects?|portfolio|education|academic\s+background|qualifications|certifications?|certificates|awards|honou?rs|publications|languages|interests|volunteering|references|right\s+to\s+work|work\s+authori[sz]ation)\s*:?$/i;

/** The master CV's own summary section, as one paragraph ("" when it has none). */
export function masterSummary(cv: string): string {
  const lines = (cv || "").split(/\r?\n/);
  const start = lines.findIndex((l) => SUMMARY_HEADING_RE.test(l.trim()));
  if (start < 0) return "";
  const body: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const t = raw.trim();
    if (!t) {
      if (body.length) continue;
      continue;
    }
    // The next section: a known heading, or a short line in capitals.
    if (NEXT_HEADING_RE.test(t) || (t.length <= 45 && /[A-Z]/.test(t) && t === t.toUpperCase() && !/[.!?]$/.test(t))) break;
    body.push(t.replace(/^[•\-*]\s+/, ""));
  }
  return body.join(" ").replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// A summary "has content" when, without the appended availability sentence,
// at least one sentence of three words or more is left.
export function summaryHasContent(summary: unknown, availabilityLine: string | null): boolean {
  if (typeof summary !== "string") return false;
  let body = summary;
  if (availabilityLine) body = body.split(availabilityLine).join(" ");
  return sentences(body).some((s) => words(s) >= 3 && /[a-z]/i.test(s));
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// "Title | Employer | Dates" (lib/bulletIds canonicalHeader), or the
// master's own "Title — Employer  Dates" shape.
function roleAndEmployer(header: string | null | undefined): { title: string; employer: string } | null {
  if (!header) return null;
  const parts = header.split(/\s*\|\s*|\s+[—–]\s+|\t+/).map((p) => p.trim()).filter(Boolean);
  const title = parts[0] ?? "";
  const employer = parts.find((p, i) => i > 0 && !/\b(?:19|20)\d{2}\b|\bpresent\b/i.test(p)) ?? "";
  return title ? { title, employer } : null;
}

export type EnsureSummaryInput = {
  cv: string;
  // The style's appended availability sentence (CareerSet), or null.
  availabilityLine: string | null;
  // The master CV's most recent role header (lib/bulletIds parseMasterExperience).
  recentRoleHeader?: string | null;
  maxSentences: number;
  maxWords: number;
};

export type EnsureSummaryReport = { rebuilt: boolean; source: "master_summary" | "master_role" | null };

/** The summary as it stands when it has content; else rebuilt from the master CV (see the header). */
export function ensureSummary(summary: unknown, input: EnsureSummaryInput): { summary: string; report: EnsureSummaryReport } {
  const current = typeof summary === "string" ? summary : "";
  if (summaryHasContent(current, input.availabilityLine)) return { summary: current, report: { rebuilt: false, source: null } };

  const room = {
    sentences: Math.max(1, input.maxSentences - (input.availabilityLine ? 1 : 0)),
    words: Math.max(10, input.maxWords - (input.availabilityLine ? words(input.availabilityLine) : 0)),
  };
  const kept: string[] = [];
  let used = 0;
  for (const s of sentences(masterSummary(input.cv))) {
    if (mentionsRightToWork(s) || mentionsAvailability(s)) continue;
    if (kept.length >= room.sentences || used + words(s) > room.words) break;
    kept.push(/[.!?]$/.test(s) ? s : `${s}.`);
    used += words(s);
  }
  let body = kept.join(" ");
  let source: EnsureSummaryReport["source"] = body ? "master_summary" : null;

  if (!body) {
    const role = roleAndEmployer(input.recentRoleHeader);
    if (role) {
      const langs = topLanguages(input.cv);
      body = `${role.title}${role.employer ? ` at ${role.employer}` : ""}${langs.length ? `, working with ${listOf(langs)}` : ""}.`;
      source = "master_role";
    }
  }
  if (!body) return { summary: current, report: { rebuilt: false, source: null } };
  const out = input.availabilityLine ? `${body}\n${input.availabilityLine}` : body;
  return { summary: out, report: { rebuilt: true, source } };
}
