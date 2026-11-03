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
import { ownsWork } from "./jdCopyGuard.ts";

const DEGREES = ["BTech", "B.Tech", "BSc", "B.Sc", "BEng", "BA", "MSc", "MEng", "MA", "MBA", "PhD"] as const;
const UNDERGRAD = /\b(?:BTech|B\.Tech|BSc|B\.Sc|BEng|BA)\b/g;

// Tools models add from the JD or from habit. Only removed when the master
// CV does not name them anywhere.
export const OVERCLAIMED_TOOLS = [
  "OpenAI API",
  "GraphQL",
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

// Tools kept only when the user's skills list names them AND a role or project
// shows them: the master CV's prose is not a listed skill, and a listed skill
// nothing backs is what you cannot defend in an interview. The 3 Nov Navan and V7
// CVs carried "OpenAI API" because the owner's skills list names it, while no
// role or project does.
export const SKILLS_LIST_ONLY_TOOLS = ["OpenAI API", "GraphQL"] as const;

// Whether a skills list names the tool: the item itself, or the vendor alone
// ("OpenAI" lists the OpenAI API).
export function listNames(skillNames: readonly string[], tool: string): boolean {
  const vendor = tool.replace(/\s+API$/i, "").trim().toLowerCase();
  return skillNames.some((n) => {
    const k = n.trim().toLowerCase();
    return k === tool.toLowerCase() || k === vendor || mentions(n, tool);
  });
}

const isListOnly = (tool: string, skillNames?: readonly string[]) => skillNames !== undefined && (SKILLS_LIST_ONLY_TOOLS as readonly string[]).includes(tool);
// A vendor stands for its API: "OpenAI" on a line, or in a role, is the OpenAI API.
const vendorOf = (tool: string) => (/\sAPI$/i.test(tool) ? tool.replace(/\s+API$/i, "").trim() : null);

// `skillNames`: the user's own skills list (the claims registry's names, or
// the CV's skills section when it has none). Without it the master CV's text
// decides every tool, as before. `evidenceText`: what the CV says outside that
// list, the second half of the test for SKILLS_LIST_ONLY_TOOLS.
function toolIsBacked(tool: string, master: string, skillNames?: readonly string[], evidenceText?: string): boolean {
  if (!isListOnly(tool, skillNames)) return mentions(master, tool);
  if (!listNames(skillNames as readonly string[], tool)) return false;
  if (evidenceText === undefined) return true;
  const vendor = vendorOf(tool);
  return mentions(evidenceText, tool) || (!!vendor && mentions(evidenceText, vendor));
}

/** The over-claimed tools a text names that the master CV doesn't back. */
export function unbackedToolsIn(text: string, master: string, skillNames?: readonly string[], evidenceText?: string): string[] {
  return OVERCLAIMED_TOOLS.filter((tool) => {
    const vendor = isListOnly(tool, skillNames) ? vendorOf(tool) : null;
    return (mentions(text, tool) || (!!vendor && mentions(text, vendor))) && !toolIsBacked(tool, master, skillNames, evidenceText);
  });
}

/** Why a tool left: said truthfully, since a tool can go for three different reasons. */
export function dropReason(tool: string, master: string, skillNames?: readonly string[]): string {
  if (!isListOnly(tool, skillNames)) return "your master CV does not name it";
  if (listNames(skillNames as readonly string[], tool)) return "no role or project on your master CV shows it";
  return mentions(master, tool) ? "it is not on your master CV's skills list" : "your master CV does not name it";
}

// A line's items with the separator before each, outside brackets, so the line can
// be put back as it was written ("Python, Java | FastAPI, React").
function splitTop(body: string): { sep: string; item: string }[] {
  const out: { sep: string; item: string }[] = [];
  let depth = 0;
  let cur = "";
  let sep = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,|;]/.test(ch)) {
      out.push({ sep, item: cur });
      const ws = /^\s*/.exec(body.slice(i + 1))?.[0] ?? "";
      const before = /\s*$/.exec(cur)?.[0] ?? "";
      sep = before + ch + ws;
      cur = "";
      i += ws.length;
    } else cur += ch;
  }
  out.push({ sep, item: cur });
  return out.map((p) => ({ sep: p.sep, item: p.item.trim() })).filter((p) => p.item);
}

// The user's own practice phrase ("REST & GraphQL API Design", word for word on
// their CV) is a competency, not the tool.
const PRACTICE_PHRASE = /\b(?:development|design|engineering|architecture|integration|testing)\s*$/i;

// One item without the tool: gone when it names it ("GraphQL APIs", "**GraphQL**",
// or the vendor alone), or only its own part cut ("LLM (OpenAI API, Claude)",
// "Docker/Kubernetes").
function itemWithout(item: string, tool: string, vendor: string | null, master: string): string {
  const plain = item.replace(/\*/g, "").trim().toLowerCase();
  if (vendor && plain === vendor.toLowerCase()) return "";
  if (PRACTICE_PHRASE.test(plain) && master.toLowerCase().includes(plain)) return item;
  const bracket = /^(.*?)\s*\((.*)\)\s*$/.exec(item);
  if (bracket && !mentions(bracket[1], tool) && mentions(bracket[2], tool)) {
    const inner = splitTop(bracket[2]).map((p) => p.item).filter((i) => !mentions(i, tool));
    return inner.length ? `${bracket[1]} (${inner.join(", ")})` : bracket[1];
  }
  if (item.includes("/") && mentions(item, tool)) {
    const parts = item.split("/");
    const left = parts.filter((p) => !mentions(p, tool));
    if (left.length > 0 && left.length < parts.length) return left.join("/");
  }
  return mentions(item, tool) ? "" : item;
}

// Line by line, item by item, so a bold label or a bold first item is still seen.
// A line whose only item it was ("Languages: Java") goes; other lines keep every byte.
function removeToolItems(skills: string, tool: string, vendor: string | null, master: string): string {
  return skills
    .split("\n")
    .flatMap((line) => {
      const m = /^(\s*(?:[•*-]\s+)?\*{0,2}[^:\n*]{1,60}\*{0,2}:\*{0,2}\s*)(.*)$/.exec(line);
      const label = m ? m[1] : "";
      const body = m ? m[2] : line;
      const parts = splitTop(body);
      const kept = parts.map((p) => ({ sep: p.sep, item: itemWithout(p.item, tool, vendor, master) }));
      if (kept.every((k, i) => k.item === parts[i].item)) return [line];
      if (!kept.some((k) => k.item)) return [];
      // The item after a removed one takes its separator: "A | X, B" without X is "A | B".
      let text = "";
      let carried: string | null = null;
      for (const k of kept) {
        if (!k.item) {
          carried ??= k.sep;
          continue;
        }
        text += text ? (carried ?? k.sep) + k.item : k.item;
        carried = null;
      }
      return [label + text];
    })
    .join("\n");
}

export function dropUnbackedTools(skills: string, master: string, skillNames?: readonly string[], evidenceText?: string): { text: string; dropped: string[] } {
  if (typeof skills !== "string") return { text: skills, dropped: [] };
  const dropped: string[] = [];
  let out = skills;
  for (const tool of OVERCLAIMED_TOOLS) {
    if (toolIsBacked(tool, master, skillNames, evidenceText)) continue;
    const before = out;
    out = removeToolItems(out, tool, isListOnly(tool, skillNames) ? vendorOf(tool) : null, master);
    if (out !== before) dropped.push(tool);
  }
  return { text: out, dropped };
}

// "I have not yet worked with GraphQL" is the honest gap the letter is asked to state.
const GAP_WORDING = /\b(?:have not|haven't|haven’t|not yet|no experience|never used|yet to|would expect to learn|do not have|don't have|don’t have|new to me)\b/i;
// "I used Python at Acme, where other teams ran GraphQL": the tool's own clause is someone else's.
const ASIDE_CLAUSE = /^(?:where|while|whereas|although|though|but|which)\b/i;
const toolIsAnAside = (sentence: string, tool: string) =>
  sentence.split(/,\s+/).some((clause) => mentions(clause, tool) && ASIDE_CLAUSE.test(clause.trim()) && !ownsWork(clause));
const BARE_NUMBER = /^\s*\d+[.)]\s*$/;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/;

/**
 * A tool the skills lost can't stay in the prose: the sentence claiming it goes.
 * The summary is about the candidate by construction; the letter must own the work
 * ("your team's GraphQL platform" stays). `keep` protects the role-title sentence, and
 * a text is never emptied.
 */
export function dropUnbackedSentences(
  text: string,
  section: "summary" | "coverLetter",
  master: string,
  opts: { skillNames?: readonly string[]; evidenceText?: string; keep?: (sentence: string) => boolean }
): { text: string; tools: string[] } {
  const tools = new Set<string>();
  const lines = text.split("\n").flatMap((line) => {
    if (/^\s*dear\b/i.test(line)) return [line];
    const parts = line.split(SENTENCE_BREAK);
    const kept = parts.filter((s) => {
      const hit = unbackedToolsIn(s, master, opts.skillNames, opts.evidenceText).filter((t) => !toolIsAnAside(s, t));
      if (hit.length === 0 || GAP_WORDING.test(s) || opts.keep?.(s)) return true;
      if (section === "coverLetter" && !ownsWork(s)) return true;
      hit.forEach((t) => tools.add(t));
      return false;
    });
    if (kept.length === parts.length) return [line];
    // "1. I built a GraphQL gateway." leaves no bare "1." behind.
    return kept.some((p) => !BARE_NUMBER.test(p)) ? [kept.join(" ")] : [];
  });
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out ? { text: out, tools: [...tools] } : { text, tools: [] };
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

export type FactGuardReport = { degrees: string[]; droppedTools: string[]; liftedPhrases: string[] };

export type GuardOptions = {
  // The user's own skills list (see dropUnbackedTools).
  skillNames?: readonly string[];
  // What the master CV's roles and projects say (see dropUnbackedTools).
  evidenceText?: string;
  // How the skills block is read (lib/formatStyles); flat when absent.
  skillsShape?: SkillsShape;
};

export function guardFacts(
  sections: { summary: unknown; skills: unknown },
  master: string,
  jd: string,
  opts: GuardOptions = {}
): { summary: unknown; skills: unknown; report: FactGuardReport; leadTools: LeadToolsFix } {
  const report: FactGuardReport = { degrees: [], droppedTools: [], liftedPhrases: [] };
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
    const t = dropUnbackedTools(skills, master, opts.skillNames, opts.evidenceText);
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
  liftedPhrases: "Summary lines copied from the job ad, check they are true:",
  droppedTools: "Removed tools not in your master CV:",
  degrees: "Degree name corrected to your master CV:",
};
const NOTICE_ORDER: FactGuardKind[] = ["liftedPhrases", "droppedTools", "degrees"];
const MAX_NOTICE_ITEMS = 10;

/** A report from the response (or a stored workspace) re-bounded: strings only. */
export function normalizeFactGuard(raw: unknown): FactGuardReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 160)).slice(0, MAX_NOTICE_ITEMS) : [];
  return { degrees: list(r.degrees), droppedTools: list(r.droppedTools), liftedPhrases: list(r.liftedPhrases) };
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
