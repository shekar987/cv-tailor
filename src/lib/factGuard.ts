// Last-pass fact guard on the finished sections (29 Oct 2026). A CareerSet
// run through OpenRouter wrote "BSc Computer Science" for a master CV that
// says BTech, listed "OpenAI API" under the AI tools although the master CV
// never names it, and summarised a role as "live translation AI development"
// lifted from the job description. Each fix here is deterministic and only
// ever moves the text back towards the master CV:
//   1. degree labels: a degree abbreviation the master CV never uses is
//      replaced by the one it does (BSc → BTech), when the master has one;
//   2. skills: a commonly over-claimed tool that the master CV never names is
//      removed from the skills text;
//   3. summary: a sentence that leans on a phrase found in the job
//      description but nowhere in the master CV is reported (not deleted),
//      so the page can flag it before download.
//   4. (31 Oct, Chunk 6) "OpenAI API" stays only when the user's own skills
//      list names it — the claims registry, which is where the extracted
//      skills are kept (the stored profile, cv_profiles.data, has no skills
//      field), else the CV's skills section; a bullet that once called the
//      API is not a listed skill. "GitHub Actions" never sits in the first
//      TOOLS_LEAD_SLOTS Technical Tools: it moves rather than failing the
//      claims check — to the end of Cloud & DevOps (CareerSet; Other only if
//      that is still a lead slot) or of the flat line — and leaves only a
//      list too short to hold it anywhere else. "Java" joins the over-claimed
//      tools (Burendo, 30 Oct).
//
// Imports only import-free siblings (relative .ts paths), so it runs under
// node:test.
import { FLAT_SKILLS, type SkillsShape } from "./formatStyles/ids.ts";
import { parseSkillsBlock, toolItems, toolLines, writeToolLines, addToolItem } from "./skillsLines.ts";

const DEGREES = ["BTech", "B.Tech", "BSc", "B.Sc", "BEng", "BA", "MSc", "MEng", "MA", "MBA", "PhD"] as const;
const UNDERGRAD = /\b(?:BTech|B\.Tech|BSc|B\.Sc|BEng|BA)\b/g;

// Tools models add from the JD or from habit. Only removed when the master
// CV does not name them anywhere.
export const OVERCLAIMED_TOOLS = [
  "OpenAI API",
  "Kafka",
  "Azure",
  "GCP",
  "Google Cloud",
  "Kubernetes",
  "WebSockets",
  "Claude Code",
  "Rust",
  "Scala",
  "Kotlin",
  "C#",
  ".NET",
  // 30 Oct, Burendo: "Java" reached a header for a master CV with none
  // ("Java" never matches inside "JavaScript").
  "Java",
] as const;

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, term: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${esc(term)}(?=$|[^A-Za-z0-9])`, "i").test(text);
}

// The master's own undergraduate label ("BTech"), if it uses exactly one.
export function masterUndergrad(master: string): string | null {
  const found = new Set((master.match(UNDERGRAD) || []).map((d) => d.replace(".", "")));
  return found.size === 1 ? [...found][0] : null;
}

export function fixDegreeLabels(text: string, master: string): { text: string; fixed: string[] } {
  const own = masterUndergrad(master);
  if (!own || typeof text !== "string") return { text, fixed: [] };
  const fixed: string[] = [];
  const out = text.replace(UNDERGRAD, (d) => {
    const norm = d.replace(".", "");
    if (norm === own || mentions(master, d)) return d;
    fixed.push(`${d} → ${own}`);
    return own;
  });
  return { text: out, fixed };
}

// Tools kept only when the user's skills list names them; the master CV's
// prose mentioning one is not enough.
export const SKILLS_LIST_ONLY_TOOLS = ["OpenAI API"] as const;

// Whether a skills list names the tool: the item itself, or the vendor alone
// ("OpenAI" lists the OpenAI API).
export function listNames(skillNames: readonly string[], tool: string): boolean {
  const vendor = tool.replace(/\s+API$/i, "").trim().toLowerCase();
  return skillNames.some((n) => {
    const k = n.trim().toLowerCase();
    return k === tool.toLowerCase() || k === vendor || mentions(n, tool);
  });
}

// `skillNames`: the user's own skills list (the claims registry's names, or
// the CV's skills section when it has none). Without it the master CV's text
// decides every tool, as before.
export function dropUnbackedTools(skills: string, master: string, skillNames?: readonly string[]): { text: string; dropped: string[] } {
  if (typeof skills !== "string") return { text: skills, dropped: [] };
  const dropped: string[] = [];
  let out = skills;
  for (const tool of OVERCLAIMED_TOOLS) {
    const listOnly = skillNames !== undefined && (SKILLS_LIST_ONLY_TOOLS as readonly string[]).includes(tool);
    const backed = listOnly ? listNames(skillNames, tool) : mentions(master, tool);
    if (backed || !mentions(out, tool)) continue;
    // "A, OpenAI API, B" / "OpenAI API, B" / "A, OpenAI API" / "A | OpenAI API",
    // and a line whose only item it is ("Languages: Java") — that line goes.
    const t = esc(tool);
    const before = out;
    out = out
      .replace(new RegExp(`\\s*[,|;]\\s*${t}(?=\\s*(?:[,|;]|$|\\n))`, "gim"), "")
      .replace(new RegExp(`(^|[:\\n]\\s*)${t}\\s*[,|;]\\s*`, "gim"), "$1")
      .replace(new RegExp(`^[^:\\n]{1,60}:\\s*${t}\\s*(?:\\n|$)`, "gim"), "")
      .replace(/\n+$/, before.endsWith("\n") ? "\n" : "");
    if (out !== before) dropped.push(tool);
  }
  return { text: out, dropped };
}

const STOP = new Set("a an and the of for to in on with by at from as is are be or into across".split(" "));

// Phrases of 2–4 content words that appear in the JD but nowhere in the
// master CV, found inside the summary: likely lifted from the posting.
export function liftedSummaryPhrases(summary: string, master: string, jd: string): string[] {
  if (typeof summary !== "string" || !summary || !jd) return [];
  const words = summary.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").split(/\s+/).filter(Boolean);
  const m = master.toLowerCase();
  const j = jd.toLowerCase();
  const hits = new Set<string>();
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.some((w) => STOP.has(w)) || gram.join("").length < 10) continue;
      const phrase = gram.join(" ");
      if (j.includes(phrase) && !m.includes(phrase) && !gram.some((w) => m.includes(w) && w.length > 6 && m.split(w).length > 3)) hits.add(phrase);
    }
  }
  return [...hits].slice(0, 5);
}

// Tools that never hold one of the first TOOLS_LEAD_SLOTS Technical Tools:
// a CI service says little about what the candidate builds, and the lead
// slots are what a recruiter's eye reads first.
export const NEVER_LEAD_TOOLS = ["GitHub Actions"] as const;
// The same count as lib/claims TOOLS_LEAD_SLOTS (both styles: leadSlots 8).
export const LEAD_SLOTS = 8;

export type LeadToolsFix = { moved: string[]; dropped: string[] };

// Moves each NEVER_LEAD_TOOLS item behind the lead slots: to the end of the
// flat line, or to the grouped block's "Other" line. A list of LEAD_SLOTS
// items or fewer has no place behind them, so the tool leaves it.
export function keepOutOfLead(skills: string, shape: SkillsShape = FLAT_SKILLS): { text: string; fix: LeadToolsFix } {
  const fix: LeadToolsFix = { moved: [], dropped: [] };
  if (typeof skills !== "string") return { text: skills, fix };
  let text = skills;
  for (const tool of NEVER_LEAD_TOOLS) {
    const block = parseSkillsBlock(text, shape);
    const items = toolItems(block);
    const at = items.findIndex((i) => i.trim().toLowerCase() === tool.toLowerCase());
    if (at < 0 || at >= LEAD_SLOTS) continue;
    const item = items[at];
    const without = toolLines(block).map((l) => l.items.filter((i) => i !== item));
    if (items.length <= LEAD_SLOTS) {
      text = writeToolLines(block, without);
      fix.dropped.push(item);
      continue;
    }
    if (shape.grouped) {
      // Its own group, Cloud & DevOps, last on that line; the Other line only
      // when that still leaves it inside the lead slots.
      const devops = addToolItem(parseSkillsBlock(writeToolLines(block, without), shape), item, "Cloud & DevOps");
      const at2 = toolItems(parseSkillsBlock(devops, shape)).findIndex((i) => i === item);
      text = at2 >= LEAD_SLOTS ? devops : addToolItem(parseSkillsBlock(writeToolLines(block, without), shape), item, "Other");
    } else {
      without[without.length - 1] = [...without[without.length - 1], item];
      text = writeToolLines(block, without);
    }
    fix.moved.push(item);
  }
  return { text, fix };
}

// ── How a role is described (5 Nov 2026) ────────────────────────────────────
// A summary said "completed industrial placement" for a placement the master
// CV shows as current, and corrected CVs went out with "currently on an
// industrial placement" where the master CV no longer calls the role a
// placement at all. Read off the user's own master CV, never a name in code:
// another user's placement is real, and their own title is whatever their
// master CV says (lib/bulletIds lockRoleHeaders restores it on every run).
//   1. a claim about the candidate's own placement, internship, apprenticeship
//      or secondment, where the master CV never names one;
//   2. "completed" / "finished" one, where every such role the master CV
//      dates is still running (an end of "Present", "expected …" or a month
//      not yet reached);
//   3. "currently on" one, where every such role it dates has ended.
// Unsure (two such roles, one running and one ended; an end this calendar
// year with no month) → nothing changes. Never a clause about the future or
// the job applied for ("I am applying for the Industrial Placement", "I hope
// to spend my placement year with you"): intent is read in the claim's own
// clause, so "Having completed my placement at X, I am keen to …" is still
// a claim. The claim's clause is cut only where what is left is a sound
// sentence — an opening "During my placement at X," before the main clause,
// a "… currently on a placement at X" after a noun, a coordinated
// ", and I am currently on …" — otherwise the whole sentence goes, or, when
// `keep` says it must stay (the summary's title sentence), it stays and is
// reported for the user to check. Never a half sentence.

// Case-free spelling for a pattern with no "i" flag: the employer after a role
// noun must keep its capital letter ("at Example Lab", never "and two years'").
const anyCase = (s: string) => s.replace(/\\.|[a-z]/g, (c) => (c.length === 2 ? c : `[${c}${c.toUpperCase()}]`));
const ROLE_KINDS: { noun: string; inMaster: RegExp }[] = [
  { noun: anyCase(String.raw`(?:placements?(?:\s+years?)?|year\s+in\s+industry|sandwich\s+year)`), inMaster: /\bplacements?\b|\byear\s+in\s+industry\b|\bsandwich\s+year\b/i },
  { noun: anyCase(String.raw`internships?`), inMaster: /\bintern(?:ship|ed|ing)?s?\b/i },
  { noun: anyCase(String.raw`apprenticeships?`), inMaster: /\bapprentice(?:ship)?s?\b/i },
  { noun: anyCase(String.raw`secondments?`), inMaster: /\bsecond(?:ment|ed)\b/i },
];
const ROLE_ADJ = anyCase(String.raw`(?:(?:an?|my|the|his|her|their)\s+)?(?:(?:industrial|professional|research|industry|technical|engineering|software|data|work|summer|paid|graduate|year[-\s]long|\d{1,2}[-\s]month|one[-\s]year|12[-\s]month)\s+){0,3}`);
// The rest of the claim: an organisation ("at Example Lab") and a year, nothing more.
const ORG_WORD = String.raw`(?!I\b)[A-Z](?:[\w&'’+-]|\.(?=\w))*`;
const ROLE_TAIL = String.raw`(?:\s+${anyCase("(?:at|with)")}\s+(?:${anyCase("the")}\s+)?${ORG_WORD}(?:\s+(?:${ORG_WORD}|&|of))*)?(?:\s+${anyCase("in")}\s+(?:19|20)\d{2})?`;
const ONGOING_RE = /\b(?:present|current|now|ongoing|to\s+date|expected|anticipated)\b/i;
const DATED_RE = /\b(?:19|20)\d{2}\b/;
// Intent inside the claim's own clause: the future or the job applied for, never a claim.
// Phrases, not words, where the word alone has a past sense ("sprint planning").
const INTENT_RE = /\b(?:apply|applying|keen|hope|hoping|would|will|looking\s+(?:for|to)|seeking|eager|want|wish|aim|aiming|excited|joining|join|intend|intending|interested\s+in|opportunit(?:y|ies)\s+(?:to|for)|plan(?:s|ning)?\s+(?:to|on))\b/i;
// A degree line ("BSc Computing with Industrial Placement | 2022 – 2027") names a
// placement but its dates are the degree's, never the placement's.
const DEGREE_LINE_RE = /\b(?:B\.?Sc|B\.?Eng|M\.?Eng|M\.?Sc|MBA|Ph\.?D|BA|MA|degree|university|college|hons|honours|bachelor['’]?s?|master['’]s|masters|school)\b/i;
// Sentence ends that are not abbreviations ("Ltd. ", "e.g. ").
const SENTENCE_SPLIT = /(?<!\b(?:Ltd|Inc|Co|Corp|e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St|No)\.)(?<=[.!?])\s+/;
// Words that can sit between a coordinator and the claim ("…, and I am currently on …").
const SUBJECT_WORDS = new Set(["i", "we", "am", "is", "are", "was", "were", "have", "has", "had", "been", "also", "recently", "just", "i'm", "i’m", "i've", "i’ve"]);
// A word that cannot end what is left before a cut clause ("with a", "who has", "I").
const DANGLING_WORDS = new Set([...SUBJECT_WORDS, "a", "an", "the", "my", "with", "who", "which", "that", "and", "or", "of", "to", "for", "on", "in", "at", "being", "having", "after"]);
const COORDINATOR_RE = /(?:,\s*(?:and|but)\s+|;\s*)/gi;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE_TOKEN_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+((?:19|20)\d{2})\b|\b(0?[1-9]|1[0-2])\/((?:19|20)\d{2})\b|\b((?:19|20)\d{2})-(0[1-9]|1[0-2])\b|\b((?:19|20)\d{2})\b/gi;

// Where a dated line's role stands today: its LAST date is the end.
function lineState(line: string, now: Date): "ongoing" | "ended" | "unsure" {
  if (ONGOING_RE.test(line)) return "ongoing";
  let last: { year: number; month: number | null } | null = null;
  for (const m of line.matchAll(DATE_TOKEN_RE)) {
    if (m[1]) last = { year: Number(m[2]), month: MONTHS[m[1].toLowerCase()] };
    else if (m[3]) last = { year: Number(m[4]), month: Number(m[3]) };
    else if (m[5]) last = { year: Number(m[5]), month: Number(m[6]) };
    else if (m[7]) last = { year: Number(m[7]), month: null };
  }
  if (!last) return "unsure";
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (last.month === null) return last.year > year ? "ongoing" : last.year < year ? "ended" : "unsure";
  return last.year * 12 + last.month >= year * 12 + month ? "ongoing" : "ended";
}

type RoleState = { absent: boolean; ongoing: boolean; ended: boolean };
function roleState(master: string, inMaster: RegExp, now: Date): RoleState {
  const lines = master.split(/\r?\n/).filter((l) => inMaster.test(l));
  const states = lines.filter((l) => DATED_RE.test(l) && !DEGREE_LINE_RE.test(l)).map((l) => lineState(l, now));
  const unsure = states.includes("unsure");
  return { absent: lines.length === 0, ongoing: unsure || states.includes("ongoing"), ended: unsure || states.includes("ended") };
}

export type RoleStatusResult = { text: string; removed: string[]; flagged: string[] };

const wordCount = (s: string) => (s.match(/[A-Za-z0-9]+/g) ?? []).length;
const lastWord = (s: string) => (s.trim().match(/([\p{L}'’]+)$/u)?.[1] ?? "").toLowerCase();

function sentencesOf(line: string): string[] {
  // A numbered point stays whole: "2. During my placement …" is one sentence.
  const out: string[] = [];
  for (const part of line.split(SENTENCE_SPLIT)) {
    if (out.length > 0 && /^\s*\d{1,2}[.)]$/.test(out[out.length - 1])) out[out.length - 1] = `${out[out.length - 1]} ${part}`;
    else out.push(part);
  }
  return out;
}

// The clause a match sits in: from the last clause break before it to the next after it.
function clauseAround(sentence: string, at: number, end: number): string {
  const before = sentence.slice(0, at);
  const start = Math.max(...[",", ";", ":", "—", "–", "("].map((c) => before.lastIndexOf(c))) + 1;
  const afterBreaks = [",", ";", ":", "—", "–", ")"].map((c) => sentence.indexOf(c, end)).filter((i) => i >= 0);
  return sentence.slice(start, afterBreaks.length ? Math.min(...afterBreaks) : sentence.length);
}

// What is left once the claim's clause is cut, or null when no cut leaves a sound sentence.
function cutClause(sentence: string, at: number, end: number): { text: string; span: string } | null {
  const lead = (sentence.match(/^\s*\d{1,2}[.)]\s*/) ?? [""])[0];
  const before = sentence.slice(lead.length, at);
  const after = sentence.slice(end);
  const claimText = sentence.slice(at, end);
  const tidy = (s: string) => s.replace(/\s+([,;:.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // An opening adverbial before the main clause: "During my placement at X, I built Y."
  // Only before a comma or the candidate as subject: anything else is still the claim
  // ("… and later at Acme, I built"), or a word the organisation swallowed.
  if (!before.trim() && /^(?:during|throughout|in)\b/i.test(claimText) && /^(?:\s*,\s*[\p{L}]|\s+(?:I|we|my|our)\b)/u.test(after)) {
    return { text: lead + tidy(after.replace(/^\s*,?\s*/, "")), span: claimText };
  }
  // "Having completed my placement at X, I am …"
  if (/^\s*(?:having|after|following)\s*$/i.test(before) && /^\s*,/.test(after)) {
    return { text: lead + tidy(after.replace(/^\s*,\s*/, "")), span: `${before.trim()} ${claimText}` };
  }
  // What follows the cut must still fit the noun before it: a relative clause
  // ("…, where I build …") would hang off the wrong word.
  const restOk = /^\s*(?:[.;:!?]|$)/.test(after) || (/^\s*,/.test(after) && !/^\s*,\s*(?:where|which|who|whose|whom|when|whereby|that|during|through|in\s+which|from\s+which)\b/i.test(after));
  const gerund = /^\s+\p{L}+ing\b/u.test(after);
  // A modifier after a noun: "Software engineer currently on a placement at X, building Y."
  if (/^(?:currently|now)\b/i.test(claimText) && before.trim() && !DANGLING_WORDS.has(lastWord(before)) && (restOk || gerund)) {
    return { text: lead + tidy(`${before.trimEnd()}${gerund ? "," : ""} ${after.trimStart()}`), span: claimText };
  }
  // A coordinated clause that is nothing but the claim: "…, and I am currently on a placement."
  if (/^\s*(?:[.!?;]|$)/.test(after)) {
    const coords = [...before.matchAll(COORDINATOR_RE)];
    const c = coords[coords.length - 1];
    if (c && c.index !== undefined) {
      const between = before.slice(c.index + c[0].length).trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (between.every((w) => SUBJECT_WORDS.has(w))) {
        return { text: lead + tidy(`${before.slice(0, c.index)}${after.trimStart()}`), span: sentence.slice(lead.length + c.index, end).replace(/^[\s,;]+/, "") };
      }
    }
  }
  return null;
}

export function guardRoleStatus(text: string, master: string, opts: { keep?: (sentence: string) => boolean; now?: Date } = {}): RoleStatusResult {
  const out: RoleStatusResult = { text, removed: [], flagged: [] };
  if (typeof text !== "string" || !text.trim()) return out;
  const now = opts.now ?? new Date();
  const kinds = ROLE_KINDS.map((k) => ({
    state: roleState(master || "", k.inMaster, now),
    completed: new RegExp(String.raw`\b${anyCase(String.raw`(?:completed|finished|concluded|wrapped\s+up)`)}\s+${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}`),
    current: new RegExp(String.raw`\b${anyCase(String.raw`(?:currently|now)\s+(?:on|in|doing|completing|undertaking)`)}\s+${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}`),
    own: new RegExp(
      // "on placement" only with the candidate as its subject: "I mentored two students on placement" is about them.
      String.raw`\b${anyCase(String.raw`(?:during|throughout|in)\s+my\s+`)}(?:\w+\s+){0,2}${k.noun}\b${ROLE_TAIL}|\b${anyCase(String.raw`my\s+`)}(?:\w+\s+){0,2}${k.noun}\b${ROLE_TAIL}|\b${anyCase(String.raw`(?:i\s+(?:am|was)|i['’]m|while|whilst|when\s+i\s+was)\s+(?:currently\s+)?on\s+`)}${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}|\b${anyCase(String.raw`(?:completed|finished|concluded|undertook|undertaken|undertaking|spent\s+\w+\s+\w+\s+on)\s+`)}${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}`
    ),
  }));
  // The clause that makes the sentence false, or null.
  const claim = (sentence: string): RegExpMatchArray | null => {
    for (const k of kinds) {
      const patterns = k.state.absent ? [k.current, k.completed, k.own] : k.state.ongoing && !k.state.ended ? [k.completed] : k.state.ended && !k.state.ongoing ? [k.current] : [];
      for (const re of patterns) {
        const m = sentence.match(re);
        if (!m || m.index === undefined) continue;
        if (INTENT_RE.test(clauseAround(sentence, m.index, m.index + m[0].length))) continue;
        return m;
      }
    }
    return null;
  };
  out.text = text
    .split("\n")
    .map((line) => {
      // Letter furniture is never a claim.
      if (!line.trim() || /^\s*(?:dear\b|kind regards|best regards|yours (?:sincerely|faithfully))/i.test(line)) return line;
      const kept: string[] = [];
      for (const sentence of sentencesOf(line)) {
        const m = claim(sentence);
        if (!m || m.index === undefined) {
          kept.push(sentence);
          continue;
        }
        const cut = cutClause(sentence, m.index, m.index + m[0].length);
        const lead = (sentence.match(/^\s*\d{1,2}[.)]\s*/) ?? [""])[0];
        if (cut && wordCount(cut.text.slice(lead.length)) >= 4 && !claim(cut.text)) {
          const body = cut.text.slice(lead.length);
          kept.push(/^[a-z](?![A-Z])/.test(body) ? lead + body.charAt(0).toUpperCase() + body.slice(1) : cut.text);
          out.removed.push(cut.span.trim());
        } else if (opts.keep?.(sentence)) {
          kept.push(sentence);
          out.flagged.push(sentence.trim());
        } else {
          out.removed.push(sentence.trim());
        }
      }
      // A line that held nothing but the claim goes with it.
      return kept.length ? kept.join(" ") : null;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return out;
}

export type FactGuardReport = { degrees: string[]; droppedTools: string[]; liftedPhrases: string[]; roleStatus: string[]; roleStatusCheck: string[] };

export type GuardOptions = {
  // The user's own skills list (see dropUnbackedTools).
  skillNames?: readonly string[];
  // How the skills block is read (lib/formatStyles); flat when absent.
  skillsShape?: SkillsShape;
};

export function guardFacts(
  sections: { summary: unknown; skills: unknown },
  master: string,
  jd: string,
  opts: GuardOptions = {}
): { summary: unknown; skills: unknown; report: FactGuardReport; leadTools: LeadToolsFix } {
  const report: FactGuardReport = { degrees: [], droppedTools: [], liftedPhrases: [], roleStatus: [], roleStatusCheck: [] };
  let leadTools: LeadToolsFix = { moved: [], dropped: [] };
  let summary = sections.summary;
  let skills = sections.skills;
  if (typeof summary === "string") {
    const d = fixDegreeLabels(summary, master);
    summary = d.text;
    report.degrees.push(...d.fixed);
    report.liftedPhrases = liftedSummaryPhrases(d.text, master, jd);
  }
  if (typeof skills === "string") {
    const t = dropUnbackedTools(skills, master, opts.skillNames);
    report.droppedTools = t.dropped;
    const lead = keepOutOfLead(t.text, opts.skillsShape);
    skills = lead.text;
    leadTools = lead.fix;
  }
  return { summary, skills, report, leadTools };
}

// ── The notice on /app (30 Oct) ─────────────────────────────────────────────
// What the guard did, said above "Download CV" before anyone sends it: one
// line per non-empty list, each item with its own OK. Never blocks the
// download — a flag, not a lock.

export type FactGuardKind = keyof FactGuardReport;
export type FactGuardNotice = { kind: FactGuardKind; label: string; items: string[] };

// Lifted phrases first: they are the ones that need the user's own check.
export const FACT_GUARD_LABELS: Record<FactGuardKind, string> = {
  roleStatus: "Removed, as your master CV describes the role differently:",
  roleStatusCheck: "Still in your summary, check it against your master CV:",
  liftedPhrases: "Summary lines copied from the job ad, check they are true:",
  droppedTools: "Removed tools not in your master CV:",
  degrees: "Degree name corrected to your master CV:",
};
const NOTICE_ORDER: FactGuardKind[] = ["roleStatusCheck", "roleStatus", "liftedPhrases", "droppedTools", "degrees"];
const MAX_NOTICE_ITEMS = 10;

/** A report from the response (or a stored workspace) re-bounded: strings only. */
export function normalizeFactGuard(raw: unknown): FactGuardReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 160)).slice(0, MAX_NOTICE_ITEMS) : [];
  return { degrees: list(r.degrees), droppedTools: list(r.droppedTools), liftedPhrases: list(r.liftedPhrases), roleStatus: list(r.roleStatus), roleStatusCheck: list(r.roleStatusCheck) };
}

/** The key an item's OK is remembered by. */
export function factGuardItemKey(kind: FactGuardKind, item: string): string {
  return `${kind}:${item}`;
}

/** The notice's lines: the non-empty lists, items already OK'd left out. */
export function factGuardNotices(report: FactGuardReport | null, acknowledged: ReadonlySet<string> = new Set()): FactGuardNotice[] {
  if (!report) return [];
  return NOTICE_ORDER.map((kind) => ({
    kind,
    label: FACT_GUARD_LABELS[kind],
    items: report[kind].filter((item) => !acknowledged.has(factGuardItemKey(kind, item))),
  })).filter((n) => n.items.length > 0);
}

export { DEGREES };
