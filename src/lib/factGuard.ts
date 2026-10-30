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
//      list names it (the claims registry, seeded from the CV's skills
//      section) — a bullet that once called the API is not a listed skill;
//      and "GitHub Actions" never sits in the first TOOLS_LEAD_SLOTS
//      Technical Tools: it moves behind them, or leaves a list too short to
//      hold it anywhere else.
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
    // "A, OpenAI API, B" / "OpenAI API, B" / "A, OpenAI API" / "A | OpenAI API"
    const t = esc(tool);
    out = out
      .replace(new RegExp(`\\s*[,|;]\\s*${t}(?=\\s*(?:[,|;]|$|\\n))`, "gim"), "")
      .replace(new RegExp(`(^|[:\\n]\\s*)${t}\\s*[,|;]\\s*`, "gim"), "$1");
    if (!mentions(out, tool)) dropped.push(tool);
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
      text = addToolItem(parseSkillsBlock(writeToolLines(block, without), shape), item, "Other");
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
