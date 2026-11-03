// The last pass on every tailored CV and letter, and the note that says what it
// changed (3 Nov 2026). Born of that day's Navan and V7 runs, each needing the
// same hand fixes: a tool no role or project shows, a header leading with the
// posting's keyword, a summary ending ", applying for the … role", and a project
// label lost between the master CV and the document.
//
// It only removes or normalises, and every rule reads the user's own master CV
// or Eligibility answers: no person's facts are written here. /api/tailor runs it
// server-side and returns `autoFixes`; /app shows them above Download as
// "Auto-fixed: N items".
//
// Imports only import-free siblings (relative .ts paths), so it runs under
// node:test and in the browser.
import { sectionBlock, sectionsOf } from "./claims.ts";
import { projectKey } from "./projectLinks.ts";
import { splitTrailingDate } from "./projectDate.ts";

type Claims = { skills: { name: string; level: string }[] } | null | undefined;

// ── The header's stack ──────────────────────────────────────────────────────

const NOT_TOOLS_LINE = /^(?:(?:functional|core|key)\s+)?competenc|^soft\s+skills|^(?:currently\s+)?(?:learning|studying)\b/i;
const LINK_LINE = /^(?:github|gitlab|linkedin|portfolio|website|live|demo|url|links?)\b[^:]*:/i;
const BULLET = /^\s*[•\-*·▪◦–]\s*/;
// What a skills list holds that is not a tool: a group's name, a spoken language,
// a soft skill, a practice ("REST & GraphQL API Design"), an address.
const GROUP_WORD = /^(?:languages?|frameworks?|languages?\s*&\s*frameworks?|databases?|cloud|devops|cloud\s*&\s*devops|testing|libraries|tools|technologies|platforms?|other|ai|ai\s*&\s*llm)$/i;
const SPOKEN = /^(?:english|hindi|telugu|tamil|urdu|bengali|punjabi|gujarati|marathi|kannada|malayalam|french|german|spanish|italian|portuguese|polish|dutch|russian|arabic|mandarin|cantonese|chinese|japanese|korean|turkish|romanian)\b/i;
const SOFT = /^(?:communication|leadership|team\s*work|teamwork|collaboration|problem[- ]solving|time management|adaptability|mentoring|stakeholder|critical thinking|creativity|attention to detail|presentation|organi[sz]ation|negotiation|agile)\b/i;
const PRACTICE = /\b(?:development|design|engineering|architecture|integration|testing|management|delivery|analysis|ownership|practices|methodolog(?:y|ies)|skills)\s*$/i;
// Not .io or .net: Socket.io and ASP.NET are tools.
const ADDRESS = /\bhttps?:|\b[\w-]+\.(?:com|org|dev|app|co)\b|\b[\w-]+\.\w+\/\S/i;

// "Programming Languages", "Cloud Platforms": a sub-heading, whatever qualifies it.
const GROUP_TAIL = /\b(?:languages|frameworks|databases|libraries|tools|technologies|platforms|stack)$/i;

const isTool = (item: string) => !GROUP_WORD.test(item) && !GROUP_TAIL.test(item) && !SPOKEN.test(item) && !SOFT.test(item) && !PRACTICE.test(item) && !ADDRESS.test(item);

// "React 19" is the registry's "React"; "AWS (Lambda, SQS)" its "AWS".
const foldSkill = (s: string) => s.trim().toLowerCase().replace(/\s*\([^()]*\)\s*$/, "").replace(/\s+v?\d[\d.x+]*$/, "").trim();

// Split on separators outside brackets: "AWS (Lambda, SQS), Docker" is two items.
function splitItems(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of line) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,|;·•]/.test(ch)) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * The first `max` tools on the master CV's own skills list, in its order: what
 * the user leads with, never what a posting asked for. A skill the registry holds
 * below production never headlines, version or not. `unbacked` is the fact guard's
 * test, so a tool it would strip from the skills can't head the document either.
 */
export function masterStackItems(cvText: string, claims: Claims, max = 3, unbacked?: (item: string) => boolean): string[] {
  const below = new Set((claims?.skills ?? []).filter((s) => s.level !== "production").map((s) => foldSkill(s.name)));
  const block = sectionBlock(cvText || "", "skills");
  const out: string[] = [];
  let skipping = false;
  for (const raw of block.length ? block : sectionsOf(cvText || "").skills) {
    const line = raw.replace(BULLET, "").trim();
    const bareLabel = /:\s*$/.test(line);
    if (NOT_TOOLS_LINE.test(line)) {
      // "Core Competencies" on its own heads the lines under it.
      skipping = bareLabel || !/[,|;·•:]/.test(line);
      continue;
    }
    if (bareLabel || GROUP_WORD.test(line) || GROUP_TAIL.test(line)) {
      skipping = false;
      continue;
    }
    if (skipping || LINK_LINE.test(line)) continue;
    const body = line.replace(/^[^:|]{1,40}:\s*/, "");
    for (const item of splitItems(body)) {
      const k = item.toLowerCase();
      if (item.length > 30 || item.includes(":") || !isTool(item) || below.has(foldSkill(item)) || out.some((o) => o.toLowerCase() === k) || unbacked?.(item)) continue;
      out.push(item);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ── "applying for the … role" ───────────────────────────────────────────────

// The noun ends the clause, or a word that carries a job phrase on follows it:
// "role-based access control", "position reconciliation" and "job market" do not.
const NOUN_END = String.raw`(?![-\w])(?=\s*(?:$|[.,;:!?)]|[—–-]\s|(?:at|in|within|with|where|that|which|who|on|across|focused|based)\b))`;
// The clause runs to its own end: "… role at Navan where my experience applies".
const CLAUSE_TAIL = String.raw`[^,;!?\n]*?(?=\s*(?:[,;!?]|\s[—–-]\s|\.?\s*$))`;
// "Software Engineer, Backend role": one comma, inside the title.
const PHRASE = String.raw`[^,;!?\n]{0,90}?(?:,\s+[\w.+#-]+(?:\s+[\w.+#-]+)?\s+)?`;
const JOB_NOUN = String.raw`\b(?:roles?|positions?|jobs?|posts?|vacanc(?:y|ies)|openings?|opportunit(?:y|ies))`;
// "targeting a blog post" and "seeking a job queue" are not job hunting.
const SOUGHT_NOUN = String.raw`\b(?:roles?|positions?|vacanc(?:y|ies)|opportunit(?:y|ies))`;
// A clause of its own, or straight after the candidate's own noun: "Mentored engineers
// seeking promotion to senior roles" and "a tool for candidates applying for jobs" stay.
const CLAUSE_START = String.raw`(?:^|[,;]\s*|\s+[—–-]\s+|(?<=\b(?:engineer|developer|graduate|professional|candidate|specialist|analyst|scientist|consultant|experience|background|expertise|years?)\s))(?:(?:and|currently|now|actively)\s+)*`;
// "applying" is the job application; "applying machine learning" is not (no for / to).
const APPLYING_RE = new RegExp(String.raw`${CLAUSE_START}(applying\s+(?:for|to)\s+${PHRASE}${JOB_NOUN}${NOUN_END}${CLAUSE_TAIL})`, "gi");
const SEEKING_RE = new RegExp(String.raw`${CLAUSE_START}((?:targeting|seeking|pursuing|looking\s+for)\s+${PHRASE}${SOUGHT_NOUN}${NOUN_END}${CLAUSE_TAIL})`, "gi");
// "… role with two years of Python": that part is about the candidate, and stays.
const OWN_TAIL = /\s+with\s+(?:(?:[\w+-]+\s+){0,3}(?:years?|experience|background)\b|(?:over\s+|more\s+than\s+)?\d).*$/i;
// "pursuing an MSc while working in a part-time role" is a true statement.
const NOT_A_JOB_HUNT = /\b(?:msc|bsc|btech|beng|meng|phd|degree|masters?|master's|certification|course|promotion)\b/i;
// The regex is case-blind, the comma in a title is not: "the scheme, with the role" is two clauses.
const lowerAfterComma = (clause: string) => /,\s+[a-z]/.test(clause.replace(/\s*(?:role|position|job|post|vacanc|opening|opportunit).*$/i, ""));

/** The summary without its form-letter tail. A sentence that was nothing else goes. */
export function stripApplyingFor(summary: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cutter = (whole: string, clause: string) => {
    if (NOT_A_JOB_HUNT.test(clause) || lowerAfterComma(clause)) return whole;
    const own = OWN_TAIL.exec(clause);
    removed.push((own ? clause.slice(0, own.index) : clause).trim());
    return own ? own[0] : "";
  };
  const lines = summary.split("\n").map((line) => {
    const kept = line
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
      .map((sentence) => {
        const cut = sentence.replace(APPLYING_RE, cutter).replace(SEEKING_RE, cutter);
        if (cut === sentence) return sentence;
        const tidy = cut.replace(/\s+([.!?,;])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/^[\s,;.]+/, "").trim();
        if (tidy.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length < 2) return "";
        return tidy.charAt(0).toUpperCase() + tidy.slice(1);
      })
      .filter(Boolean);
    return kept.join(" ");
  });
  if (removed.length === 0) return { text: summary, removed };
  return { text: lines.filter((l, i) => l.trim() || !summary.split("\n")[i].trim()).join("\n").trim(), removed };
}

/** The availability sentence last, from the user's own answer; null = unanswered, so nothing is claimed. */
export function keepAvailabilityLast(summary: string, line: string | null): { text: string; added: boolean; moved: boolean } {
  if (!line || !summary.trim()) return { text: summary, added: false, moved: false };
  const trimmed = summary.trim();
  if (trimmed.endsWith(line)) return { text: trimmed, added: false, moved: false };
  const present = trimmed.includes(line);
  const body = trimmed.split(line).join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return { text: body ? `${body}\n${line}` : line, added: !present, moved: present };
}

// ── Project labels, from the master CV's own line ───────────────────────────

// "Personal portfolio project" says what kind it is; "Beta Project" is a title.
const LABEL_SHAPED = (seg: string) => /\bproject\b/.test(seg) || /^(?:personal|portfolio|side|solo|university|academic|group|team|open[- ]source|freelance|client|final[- ]year|research|dissertation|hackathon)\b.*\bproject\b/i.test(seg);

/**
 * Each project's label: the first segment of the line under its heading when it
 * says what kind of project it is ("Personal portfolio project modelled on a
 * real-world brief  |  Tech: …"). Keyed as lib/projectLinks keys a project, so a
 * pool's longer title is the same project.
 */
export function masterProjectLabels(cvText: string): Map<string, string> {
  const labels = new Map<string, string>();
  const lines = sectionBlock(cvText || "", "projects");
  for (let i = 1; i < lines.length; i++) {
    const seg = lines[i].split("|")[0].trim();
    const prior = lines[i - 1];
    if (BULLET.test(lines[i]) || BULLET.test(prior) || !LABEL_SHAPED(seg) || /^tech\b/i.test(seg) || seg.split(/\s+/).length > 14) continue;
    // A project's own heading is not a label: "Beta Project | 2025" has a date,
    // and the line above it has already said its tech or its links.
    if (splitTrailingDate(lines[i]).date || /\btech(?:nologies)?\s*:/i.test(prior) || LINK_LINE.test(prior)) continue;
    const key = projectKey(prior);
    if (!key || labels.has(key)) continue;
    labels.set(key, /^[A-Z][A-Z]/.test(seg) ? seg : seg.charAt(0).toLowerCase() + seg.slice(1));
  }
  return labels;
}

const BRACKETED_DATE = /\s*\(((?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}(?:\s*(?:[–—-]|to)\s*(?:(?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present))?)\)\s*$/i;

/** "RideX — Ride-Hailing Platform | 2025" with its label in brackets; unchanged when the CV gives none. */
export function labelProjectName(name: string, labels: Map<string, string>): string {
  const [head, ...rest] = name.split(" | ");
  // "X — App — 2026" and "RideX (2025)" keep their date as a date, after the label.
  const split = rest.length > 0 ? { title: head, date: "" } : splitTrailingDate(head);
  const dated = split.date ? null : BRACKETED_DATE.exec(split.title);
  const title = dated ? split.title.slice(0, dated.index).trim() : split.title;
  const date = split.date || dated?.[1] || "";
  const label = labels.get(projectKey(title));
  if (!label || title.toLowerCase().includes(label.toLowerCase())) return name;
  const bare = title.replace(/\s*\([^()]*\bproject\b[^()]*\)/i, "").trim();
  return [`${bare} (${label})`, ...(date ? [date] : []), ...rest].join(" | ");
}

export function labelProjectNames(names: string[], cvText: string): string[] {
  const labels = masterProjectLabels(cvText);
  return names.map((n) => labelProjectName(n, labels));
}

// ── The note ────────────────────────────────────────────────────────────────

export type AutoFixKind = "tool" | "tagline" | "summary" | "label" | "fact";
export type AutoFix = { kind: AutoFixKind; text: string };

const KINDS: readonly AutoFixKind[] = ["tool", "tagline", "summary", "label", "fact"];
const MAX_FIX_CHARS = 300;
const MAX_FIXES = 20;

const DATE_SPAN = /(?:[A-Za-z]{3,9}\.?\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}|present)/i;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/\s*(?:[—–-]|\sto\s)\s*/g, "–").trim();
const shortName = (name: string) => name.split(/\s+[—–|-]\s+|\s*\(/)[0].trim();

/** The note's line for a project name that gained its label on the CV; nothing when it already had it. */
export function cvLabelFixes(names: string[], labels: Map<string, string>): AutoFix[] {
  return names
    .filter((n) => labelProjectName(n, labels) !== n)
    .map((n) => ({ kind: "label" as const, text: `Added your label to ${shortName(n)} on the CV, as your master CV writes it.` }));
}

export type AutoFixInput = {
  droppedTools?: { tool: string; why: string }[];
  unsupportedTools?: string[] | null;
  sentenceDrops?: { where: string; tool: string; why: string }[];
  degrees?: string[];
  summaryRemoved?: string[];
  availabilityAdded?: string | null;
  letterLabels?: string[];
  cvLabels?: AutoFix[];
  // The stack the header really prints, and what a posting-led header would have.
  headerStack?: string;
  postingStack?: string[];
  headerLock?: { locked: { output: string; master: string }[] } | null;
};

/** What the passes changed, in plain British English. A clean run lists nothing. */
export function buildAutoFixes(i: AutoFixInput): AutoFix[] {
  const out: AutoFix[] = [];
  for (const { tool, why } of i.droppedTools ?? []) out.push({ kind: "tool", text: `Removed ${tool} from the skills: ${why}.` });
  for (const t of i.unsupportedTools ?? []) out.push({ kind: "tool", text: `Removed ${t} from the skills: your master CV does not name it.` });
  for (const { where, tool, why } of i.sentenceDrops ?? []) out.push({ kind: "tool", text: `Removed a sentence naming ${tool} from the ${where}: ${why}.` });
  const stack = (i.headerStack ?? "").trim();
  const posting = i.postingStack ?? [];
  if (stack && posting.length && splitItems(stack)[0].toLowerCase() !== posting[0].toLowerCase()) {
    out.push({ kind: "tagline", text: `Header uses your own top skills (${stack}), not the posting's (${posting.join(", ")}).` });
  }
  for (const r of i.summaryRemoved ?? []) out.push({ kind: "summary", text: `Removed "${r}" from the summary.` });
  if (i.availabilityAdded) out.push({ kind: "summary", text: `Ended the summary with your availability: "${i.availabilityAdded}"` });
  out.push(...(i.cvLabels ?? []));
  for (const name of i.letterLabels ?? []) out.push({ kind: "label", text: `Added your label for ${name} to the cover letter, as your master CV writes it.` });
  for (const d of i.degrees ?? []) out.push({ kind: "fact", text: `Degree name set to your master CV: ${d}.` });
  for (const { output, master } of i.headerLock?.locked ?? []) {
    const had = DATE_SPAN.exec(output)?.[0];
    const own = DATE_SPAN.exec(master)?.[0];
    if (had && own && norm(had) !== norm(own)) out.push({ kind: "fact", text: `Dates for ${master.split(/\s*[|—–]\s*/)[0].trim()} set to your master CV: ${own}.` });
  }
  return out;
}

/** A note from the response or a stored workspace, re-bounded. */
export function normalizeAutoFixes(raw: unknown): AutoFix[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoFix[] = [];
  for (const f of raw) {
    const r = f as { kind?: unknown; text?: unknown } | null;
    if (r && typeof r.text === "string" && r.text.trim() && (KINDS as readonly unknown[]).includes(r.kind)) out.push({ kind: r.kind as AutoFixKind, text: r.text.trim().slice(0, MAX_FIX_CHARS) });
  }
  return out.slice(0, MAX_FIXES);
}
