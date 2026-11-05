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
//      dates is current;
//   3. "currently on" one, where every such role it dates has ended.
// Never a sentence about the future or the job applied for ("I am applying
// for the Industrial Placement", "I hope to spend my placement year with
// you"). The claim's own clause goes first; the sentence only when nothing
// sound is left of it, and not even then when `keep` says it must stay (the
// summary's title sentence) — then it is reported for the user to check.
const ROLE_KINDS: { noun: string; inMaster: RegExp }[] = [
  { noun: String.raw`(?:placements?|year\s+in\s+industry|sandwich\s+year)`, inMaster: /\bplacements?\b|\byear\s+in\s+industry\b|\bsandwich\s+year\b/i },
  { noun: String.raw`internships?`, inMaster: /\bintern(?:ship|ed|ing)?s?\b/i },
  { noun: String.raw`apprenticeships?`, inMaster: /\bapprentice(?:ship)?s?\b/i },
  { noun: String.raw`secondments?`, inMaster: /\bsecond(?:ment|ed)\b/i },
];
const ROLE_ADJ = String.raw`(?:(?:an?|my|the|his|her|their)\s+)?(?:(?:industrial|professional|research|industry|technical|engineering|software|data|work|summer|paid|graduate|year[-\s]long|\d{1,2}[-\s]month|one[-\s]year|12[-\s]month)\s+){0,3}`;
// The rest of the claim: where and when ("at Example Lab", "in 2025").
const ROLE_TAIL = String.raw`(?:\s+(?:at|with|in)\s+[^,.;:!?]{1,60})?`;
const ONGOING_RE = /\b(?:present|current|now|ongoing|to\s+date)\b/i;
const DATED_RE = /\b(?:19|20)\d{2}\b/;
// A sentence about the future or the job applied for is never a claim about a past role.
const INTENT_RE = /\b(?:apply|applying|keen|hope|hoping|would|will|looking\s+(?:for|to)|seeking|eager|want|wish|plan|planning|aim|aiming|interested|excited|opportunity|joining|join)\b/i;
// Sentence ends that are not abbreviations ("Ltd. ", "e.g. ").
const SENTENCE_SPLIT = /(?<!\b(?:Ltd|Inc|Co|Corp|e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St|No)\.)(?<=[.!?])\s+/;
// The claim is the predicate ("…, and I am currently on a placement."): cutting
// the clause alone would leave "I am.", so the cut runs back to the coordinator.
const COPULA_BEFORE_RE = /\b(?:am|is|are|was|were|been|being)\s*$|['’](?:m|s|re)\s*$/i;
const COORDINATOR_RE = /(?:,\s*(?:and|but)\s+|;\s*)(?![\s\S]*(?:,\s*(?:and|but)\s+|;\s*))/i;

type RoleState = { absent: boolean; ongoing: boolean; ended: boolean };
function roleState(master: string, inMaster: RegExp): RoleState {
  const lines = master.split(/\r?\n/).filter((l) => inMaster.test(l));
  const dated = lines.filter((l) => DATED_RE.test(l));
  return { absent: lines.length === 0, ongoing: dated.some((l) => ONGOING_RE.test(l)), ended: dated.some((l) => !ONGOING_RE.test(l)) };
}

export type RoleStatusResult = { text: string; removed: string[]; flagged: string[] };

const wordCount = (s: string) => (s.match(/[A-Za-z0-9]+/g) ?? []).length;

function sentencesOf(line: string): string[] {
  // A numbered point stays whole: "2. During my placement …" is one sentence.
  const out: string[] = [];
  for (const part of line.split(SENTENCE_SPLIT)) {
    if (out.length > 0 && /^\s*\d{1,2}[.)]$/.test(out[out.length - 1])) out[out.length - 1] = `${out[out.length - 1]} ${part}`;
    else out.push(part);
  }
  return out;
}

export function guardRoleStatus(text: string, master: string, opts: { keep?: (sentence: string) => boolean } = {}): RoleStatusResult {
  const out: RoleStatusResult = { text, removed: [], flagged: [] };
  if (typeof text !== "string" || !text.trim()) return out;
  const kinds = ROLE_KINDS.map((k) => ({
    state: roleState(master || "", k.inMaster),
    completed: new RegExp(String.raw`\b(?:completed|finished|concluded|wrapped\s+up)\s+${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}`, "i"),
    current: new RegExp(String.raw`\b(?:currently|now)\s+(?:on|in|doing|completing|undertaking)\s+${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}`, "i"),
    own: new RegExp(String.raw`\b(?:during|throughout|in)\s+my\s+(?:\w+\s+){0,2}${k.noun}\b${ROLE_TAIL}|\bmy\s+(?:\w+\s+){0,2}${k.noun}\b${ROLE_TAIL}|\bon\s+${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}|\b(?:completed|finished|concluded|undertook|undertaken|undertaking|spent\s+\w+\s+\w+\s+on)\s+${ROLE_ADJ}${k.noun}\b${ROLE_TAIL}`, "i"),
  }));
  // The clause that makes the sentence false, or null.
  const claim = (sentence: string): RegExpMatchArray | null => {
    if (INTENT_RE.test(sentence)) return null;
    for (const k of kinds) {
      const m = k.state.absent
        ? (sentence.match(k.current) ?? sentence.match(k.completed) ?? sentence.match(k.own))
        : k.state.ongoing && !k.state.ended
          ? sentence.match(k.completed)
          : k.state.ended && !k.state.ongoing
            ? sentence.match(k.current)
            : null;
      if (m) return m;
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
        if (!m) {
          kept.push(sentence);
          continue;
        }
        // The clause first: "Software Engineer currently on an industrial placement at X, building Y."
        const at = m.index ?? sentence.indexOf(m[0]);
        const before = sentence.slice(0, at);
        let from = at;
        if (COPULA_BEFORE_RE.test(before)) {
          const c = before.match(COORDINATOR_RE);
          from = c?.index ?? -1;
        }
        const span = from < 0 ? sentence : sentence.slice(from, at + m[0].length);
        const cut = (from < 0 ? "" : `${sentence.slice(0, from)} ${sentence.slice(at + m[0].length)}`)
          .replace(/\s+([,;:.!?])/g, "$1")
          .replace(/([,;:])\s*([,;:.!?])/g, "$2")
          .replace(/^\s*(?:\d{1,2}[.)]\s*)?[,;:]\s*/, (s) => s.replace(/[,;:]\s*/, ""))
          .replace(/\s{2,}/g, " ")
          .trim();
        const lead = (sentence.match(/^\s*\d{1,2}[.)]\s*/) ?? [""])[0];
        if (wordCount(cut.slice(lead.length)) >= 4 && !claim(cut)) {
          kept.push(/^[a-z](?![A-Z])/.test(cut.slice(lead.length)) ? lead + cut.charAt(lead.length).toUpperCase() + cut.slice(lead.length + 1) : cut);
          out.removed.push(span.replace(/^[\s,;]+/, "").trim());
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
