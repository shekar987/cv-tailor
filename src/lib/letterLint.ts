// The cover letter's shape, in code (30 Sep audit, Phase 2). Three things
// the prompt asks for and the letters kept doing:
// - the second person about the reader's needs ("… that prepares you for
//   the role", "your team needs someone who …"): relevance narration in a
//   different grammar — the sentence goes;
// - the posting restated back to the reader ("Your job builds …", "You are
//   looking for …"): the reader wrote it — the sentence goes;
// - the honest gap: when the posting's essential requirement is absent from
//   the master CV, one plain sentence should say so ("I have not yet worked
//   with exchange market data or options pricing, and I would expect to
//   learn that domain from your team.") — reported, never invented.
// The opening sentence (the role by name) is never removed.
//
// Four more rules since 30 Oct 2026 (Chunk 5), reported in `rules`:
// - banned phrases: "I am writing to express my interest in" → "I am
//   applying for", "passionate about" → "interested in", "at your company"
//   removed; a sentence with "eager to learn", "contribute to its
//   development" or "I believe I would be a great fit" goes;
// - at most ONE gap sentence, and only one naming an essential gap the
//   route found (`essentialGaps`): any other "I have not …" / "although I
//   have not …" sentence goes ("Although I have not used X, I built Y" keeps
//   "I built Y");
// - no fact twice: a figure (lib/claims extractFigures) or a project name
//   that an earlier paragraph already gave — the later sentence goes;
// - a project the master CV names with a bracketed description ("RideX
//   (personal portfolio project modelled on a real-world brief)") is written
//   with that description at its first mention, whatever the model wrote.
//
// Imports only its import-free siblings (relative .ts paths): runs under
// node:test.
import { matchAtsKeywords } from "./atsMatch.ts";
import { extractFigures } from "./claims.ts";

export type LetterLint = { secondPerson: string[]; restatedJd: string[] };
// The 30 Oct rules, apart from LetterLint so its shape (and its readers)
// stay as they were.
export type LetterRules = { bannedPhrases: string[]; extraGaps: string[]; repeatedFacts: string[]; projectDescriptors: string[] };
export type LetterLintOptions = {
  /** The essential requirements the master CV never shows: the only terms a gap sentence may name. Absent = the gap rule is off. */
  essentialGaps?: string[];
  /** Project names as the master CV writes them, a bracketed description included. */
  projects?: string[];
};

const SECOND_PERSON_RE =
  /\b(?:prepares?|prepared|equips?|equipped|positions?|positioned|gives?|offers?|brings?|allows?|helps?|enables?|makes?|sets?)\s+(?:me\s+)?(?:up\s+)?(?:for\s+)?you\b|\byou(?:r\s+(?:team|company|organi[sz]ation|business|role|platform|product|customers|clients|engineers|stack))?\s+(?:need|needs|require|requires|want|wants|will\s+(?:get|find|have|benefit)|would\s+(?:get|find|have|benefit)|can\s+(?:rely|count|expect)|are\s+looking\s+for|is\s+looking\s+for|deserve|deserves)\b|\bwhat\s+you(?:'re|\s+are)\s+(?:looking\s+for|after|seeking)\b/i;
const RESTATES_JD_RE =
  /^(?:your|the)\s+(?:job\s+description|job\s+(?:posting|advert|listing|spec|specification)|job|role|posting|advert|advertisement|description|listing|vacancy|opening|position|team)\s+(?:builds?|involves?|requires?|asks?|mentions?|says?|states?|describes?|calls?|needs?|is|will|focuses|seeks?|emphasi[sz]es?|lists?)\b|^you(?:'re|\s+are)\s+(?:looking\s+for|hiring|seeking|after|building|recruiting)\b|\bas\s+(?:the|your)\s+(?:posting|job\s+description|advert|listing)\s+(?:says|states|mentions|notes|describes|makes\s+clear)\b/i;
const HONEST_GAP_RE =
  /\bI\s+(?:have\s+not|haven't|haven’t|have\s+never|do\s+not\s+yet\s+have|don't\s+yet\s+have|have\s+no)\s+(?:yet\s+)?(?:worked\s+(?:with|on|in)|used|built|had|done|direct\s+experience|experience|hands-on\s+experience|delivered|shipped|run|managed)\b|\bI\s+would\s+(?:expect|need|have)\s+to\s+learn\b|\bnot\s+(?:something|a\s+technology|a\s+domain|an\s+area)\s+I\s+have\s+(?:worked|used)\b/i;
const ALTHOUGH_GAP_RE = /\b(?:although|though|while)\s+I\s+(?:have\s+not|haven't|haven’t|have\s+never|do\s+not|don't|don’t|lack)\b/i;
// "Although I have not used X, I built Y." — the candidate's own clause.
const ALTHOUGH_CLAUSE_RE = /^(?:although|though|while)\b[^,]*,\s*((?:I|I've|I’ve|my)\b.*)$/i;

const SALUTATION_RE = /^dear\b/i;
const SIGNOFF_RE = /^(?:kind|best|warm|warmest)\s+regards,?$|^regards,?$|^yours\s+(?:sincerely|faithfully|truly),?$|^sincerely,?$/i;

// [pattern, replacement, reported as]. A rewrite keeps the sentence.
const BANNED_REWRITES: [RegExp, string, string][] = [
  [/\bI am writing to express (?:my )?(?:(?:strong|keen|sincere|great|genuine|deep) )?interest in\b/i, "I am applying for", "I am writing to express"],
  [/\bpassionate about\b/i, "interested in", "passionate about"],
  [/\s*\bat your company\b/i, "", "at your company"],
];
// A sentence carrying one of these goes (the opening loses only the clause).
const BANNED_DROPS: [RegExp, string][] = [
  [/\beager to learn\b/i, "eager to learn"],
  [/\bcontribute to its development\b/i, "contribute to its development"],
  [/\bI believe I would be a great fit\b/i, "I believe I would be a great fit"],
  [/\bI am writing to express\b/i, "I am writing to express"],
];

function sentencesOf(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSecondPerson(sentence: string): boolean {
  return SECOND_PERSON_RE.test(sentence);
}
export function restatesJd(sentence: string): boolean {
  return RESTATES_JD_RE.test(sentence.trim());
}
export function hasHonestGap(letter: string): boolean {
  return HONEST_GAP_RE.test(letter || "");
}
export function isGapSentence(sentence: string): boolean {
  return HONEST_GAP_RE.test(sentence) || ALTHOUGH_GAP_RE.test(sentence);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function rewriteKeepingCase(s: string, re: RegExp, to: string): string {
  return s.replace(re, (m) => (to && /^[A-Z]/.test(m.trim()) ? capitalise(to) : to)).replace(/\s+([,.;:!?])/g, "$1");
}

// The opening sentence is never removed: a banned clause in it goes alone,
// when another clause is left to carry the sentence.
function trimOpeningClauses(s: string, report: string[]): string {
  const hit = BANNED_DROPS.find(([re]) => re.test(s));
  if (!hit) return s;
  const end = /[.!?]$/.exec(s)?.[0] ?? ".";
  const clauses = s.replace(/[.!?]$/, "").split(/,\s+(?:and\s+)?/);
  const kept = clauses.filter((c) => !BANNED_DROPS.some(([re]) => re.test(c)));
  if (kept.length === 0 || kept.length === clauses.length) return s;
  report.push(hit[1]);
  return kept.join(", ") + end;
}

/** A project's name as the letter writes it: the master CV's bracketed description and any " | date" tail removed. */
export function coreProjectName(fullName: string): string {
  return fullName.split("|")[0].replace(/\s*\([^()]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A project's description from the master CV's own name line ("RideX
 * (personal portfolio project modelled on a real-world brief)" → "a personal
 * portfolio project modelled on a real-world brief"). Three words at least,
 * and not a stack list; null otherwise.
 */
export function projectDescriptor(fullName: string): { name: string; descriptor: string } | null {
  const m = /^(.+?)\s*\(([^()]+)\)/.exec(fullName.split("|")[0].trim());
  if (!m) return null;
  const q = m[2].trim().replace(/\s+/g, " ");
  if (q.split(" ").length < 3 || q.includes(",")) return null;
  const descriptor = /^(?:a|an|the|my)\s/i.test(q) ? q : `${/^[aeiou]/i.test(q) ? "an" : "a"} ${q}`;
  return { name: m[1].trim(), descriptor };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nameRe(name: string, flags = "i"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, `${flags}u`);
}

// The facts a sentence states: its figures, and the projects it names.
function factsOf(sentence: string, projectNames: string[]): string[] {
  const keys = extractFigures(sentence).map((f) => `figure:${f.key}`);
  for (const name of projectNames) if (nameRe(name).test(sentence)) keys.push(`project:${name.toLowerCase()}`);
  return keys;
}

// At the first mention of each described project in the body, the master
// CV's description replaces whatever the model wrote after the name (an
// appositive starting with an article, or a bracket) or is added.
function describeProjects(body: string, projects: { name: string; descriptor: string }[], report: string[]): string {
  let out = body;
  for (const { name, descriptor } of projects) {
    const m = nameRe(name).exec(out);
    if (!m) continue;
    const at = m.index + m[0].length;
    const after = out.slice(at);
    if (after.toLowerCase().startsWith(`, ${descriptor.toLowerCase()}`)) continue;
    const span = /^\s*\([^()]{1,160}\)|^,\s+(?:a|an|the|my|our)\s+[^,.;!?\n]{1,120}?,/i.exec(after);
    const rest = span ? after.slice(span[0].length) : after;
    const closes = /^\s*(?:[.!?;:]|$)/.test(rest) || rest.startsWith(",");
    out = out.slice(0, at) + `, ${descriptor}` + (closes ? "" : ",") + rest;
    report.push(name);
  }
  return out;
}

// ── The final tidy (31 Oct 2026, Chunk 6) ────────────────────────────────────
// Three rules run once on the FINISHED letter (after the fact check, the
// right-to-work insert and the page fit, any of which can move what they
// read), reported as `tidy` — apart from LetterRules, whose shape is pinned:
// - "N areas" says the number of numbered points the letter really has: a
//   removal left three points under "these are the four areas" (CareerSet's
//   fixed line; "reasons" the same);
// - modules stay with their degree: a sentence about the MSc names only the
//   MSc's modules as the master CV lists them; a module the master lists
//   under another degree is taken out of the list (the sentence goes when no
//   module of the named degree is left);
// - one full stop: "Acme Inc.." (a company name ending in a stop, then the
//   sentence's own) loses the second; an ellipsis is left alone.

export type LetterTidy = {
  areasCount: { from: string; to: string } | null;
  otherDegreeModules: string[];
  doubleStops: number;
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const AREAS_RE = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})(\s+)(areas|reasons|ways)\b/i;
// The same numbered-point line lib/letterStyle counts.
const POINT_RE = /^\s*\d{1,2}\.\s+\S/;

// An item of the list under the intro line: numbered ("1. …"), a bullet
// ("• …", "- …") or labelled ("Backend delivery: …" — a short label, then a
// colon and the text).
const LIST_ITEM_RE = /^\s*(?:\d{1,2}[.)]\s+\S|[•\-*]\s+\S|[A-Z][^:.!?]{1,60}:\s+\S)/;

/** "these are the four areas" said with the number of areas the letter really lists. */
export function fixAreasCount(letter: string): { text: string; fixed: { from: string; to: string } | null } {
  const lines = letter.replace(/\r/g, "").split("\n");
  // Only the line that introduces the list (it ends with a colon): "I worked
  // in three areas of the platform" in the body is a fact, never a count.
  const at = lines.findIndex((l) => AREAS_RE.test(l) && !POINT_RE.test(l) && /:\s*$/.test(l));
  if (at < 0) return { text: letter, fixed: null };
  // The items right under it (blank lines between them allowed); else every
  // numbered point in the letter.
  let points = 0;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim()) continue;
    if (!LIST_ITEM_RE.test(l)) break;
    points++;
  }
  if (points === 0) points = lines.filter((l) => POINT_RE.test(l)).length;
  if (points === 0) return { text: letter, fixed: null };
  const m = AREAS_RE.exec(lines[at])!;
  const stated = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS.indexOf(m[1].toLowerCase());
  if (stated === points) return { text: letter, fixed: null };
  let to = /^\d+$/.test(m[1]) || points > 10 ? String(points) : NUMBER_WORDS[points];
  if (/^[A-Z]/.test(m[1])) to = capitalise(to);
  lines[at] = lines[at].replace(AREAS_RE, `${to}$2$3`);
  return { text: lines.join("\n"), fixed: { from: m[1], to } };
}

/** "Inc.." → "Inc."; an ellipsis ("...") is never touched. */
export function fixDoubleStops(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/(?<!\.)\.\.(?!\.)/g, () => {
    count++;
    return ".";
  });
  return { text: out, count };
}

// "LLM" is left out: in a tech CV it is a language model far more often than
// a Master of Laws, and reading it as a degree hid the real one beside it.
const DEGREE_RE = /\b(B\.?Tech|B\.?Sc|B\.?Eng|B\.?A|M\.?Sc|M\.?Eng|M\.?Tech|M\.?A|MBA|Ph\.?D|MRes|LLB)\b/g;
const MODULES_LINE_RE = /^\s*(?:[•\-*]\s*)?(?:(?:key|relevant|core|selected|main|optional)\s+)?(?:modules?|coursework|courses?)(?:\s+(?:include|included|including|studied|taken))?\s*:?\s+(.+)$/i;

const degreeKey = (d: string) => d.replace(/\./g, "").toLowerCase();

// An education entry as the extracted profile stores it (lib/profile
// Education): its degree line and the note that may carry its modules.
export type EducationEntry = { degree?: string; note?: string };

const splitModules = (list: string) => list.split(/\s*[,;|·]\s*|\s+and\s+/).map((s) => s.replace(/[.\s]+$/, "").trim()).filter((s) => s.length >= 3);

/**
 * The modules listed under each degree, keyed by the degree's abbreviation
 * ("msc"): from the master CV's own lines, and from each education entry
 * (education[i].note "Modules: …" belongs to education[i].degree only).
 */
export function modulesByDegree(masterCv: string, education: readonly EducationEntry[] = []): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (deg: string, items: string[]) => {
    const have = out.get(deg) ?? [];
    out.set(deg, [...have, ...items.filter((m) => !have.some((h) => h.toLowerCase() === m.toLowerCase()))]);
  };
  for (const e of education) {
    const degrees = [...(e?.degree ?? "").matchAll(DEGREE_RE)].map((m) => degreeKey(m[1]));
    if (degrees.length !== 1) continue;
    for (const part of (e?.note ?? "").split(/\n|(?<=\.)\s+(?=[A-Z])/)) {
      const mods = MODULES_LINE_RE.exec(part.trim());
      if (mods) add(degrees[0], splitModules(mods[1]));
    }
  }
  let current: string | null = null;
  for (const raw of (masterCv || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const mods = MODULES_LINE_RE.exec(line);
    if (mods && current) {
      add(current, splitModules(mods[1]));
      continue;
    }
    const degrees = [...line.matchAll(DEGREE_RE)].map((m) => degreeKey(m[1]));
    if (degrees.length === 1) current = degrees[0];
    else if (degrees.length > 1) current = null;
  }
  return out;
}

// The words that open a module list: "modules", "my modules in", "coursework
// such as", "courses including", "modules: …".
const MODULE_LIST_RE = /\b(?:modules?|coursework|courses?)\b(?:\s+(?:in|on|such as|including|included|include|includes|like|covering|covered|were|was|are|cover)\b)*\s*:?\s*/gi;
const LIST_SEP_RE = /^(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)/i;

// The module list right after its opening words: known module names (any
// degree's), one after another with ", " / " and " between them; the list
// ends at the first text that is not a known module. Nothing outside it —
// "two years of production work with databases" — is ever read as a module
// (review of PR #6, 31 Oct).
function moduleListAt(s: string, from: number, known: string[]): { start: number; end: number; items: { name: string; text: string }[] } | null {
  const items: { name: string; text: string }[] = [];
  let pos = from;
  let start = -1;
  let end = -1;
  for (;;) {
    const rest = s.slice(pos);
    const hit = known
      .filter((m) => rest.toLowerCase().startsWith(m.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest.charAt(m.length)))
      .sort((a, b) => b.length - a.length)[0];
    if (!hit) break;
    if (start < 0) start = pos;
    items.push({ name: hit, text: rest.slice(0, hit.length) });
    end = pos + hit.length;
    const sep = LIST_SEP_RE.exec(s.slice(end));
    if (!sep) break;
    pos = end + sep[0].length;
  }
  return items.length > 0 ? { start, end, items } : null;
}

const joinList = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Modules named next to a degree are that degree's own (see the header). */
export function keepDegreeModules(letter: string, masterCv: string, education: readonly EducationEntry[] = []): { text: string; removed: string[] } {
  const byDegree = modulesByDegree(masterCv, education);
  const removed: string[] = [];
  if (byDegree.size === 0) return { text: letter, removed };
  const all = [...byDegree.entries()].flatMap(([deg, mods]) => mods.map((m) => ({ deg, m })));
  const known = [...new Set(all.map((x) => x.m))];
  const lines = letter.replace(/\r/g, "").split("\n").map((line) => {
    if (!/\b(?:modules?|coursework|courses?)\b/i.test(line)) return line;
    const kept = sentencesOf(line).flatMap((s) => {
      const named = new Set([...s.matchAll(DEGREE_RE)].map((m) => degreeKey(m[1])));
      if (named.size === 0) return [s];
      const own = new Set(all.filter((x) => named.has(x.deg)).map((x) => x.m.toLowerCase()));
      let out = s;
      let emptied = false;
      // Each list, last first, so the earlier positions stay valid.
      const lists = [...s.matchAll(MODULE_LIST_RE)].map((m) => moduleListAt(s, (m.index ?? 0) + m[0].length, known)).filter((l): l is NonNullable<typeof l> => !!l);
      for (const list of lists.reverse()) {
        const foreign = list.items.filter((i) => !own.has(i.name.toLowerCase()));
        if (foreign.length === 0) continue;
        removed.push(...foreign.map((i) => i.name));
        const keep = list.items.filter((i) => own.has(i.name.toLowerCase())).map((i) => i.text);
        if (keep.length === 0) emptied = true;
        out = out.slice(0, list.start) + joinList(keep) + out.slice(list.end);
      }
      // No module of the named degree left: the sentence says nothing true about it.
      return emptied ? [] : [out];
    });
    return kept.join(" ");
  });
  if (removed.length === 0) return { text: letter, removed };
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n"), removed };
}

/** The three final rules, in order: modules, the stop, then the count. */
export function tidyFinishedLetter(letter: string, masterCv: string, education: readonly EducationEntry[] = []): { text: string; tidy: LetterTidy } {
  const tidy: LetterTidy = { areasCount: null, otherDegreeModules: [], doubleStops: 0 };
  if (!letter || !letter.trim()) return { text: letter, tidy };
  const mods = keepDegreeModules(letter, masterCv, education);
  tidy.otherDegreeModules = mods.removed;
  const stops = fixDoubleStops(mods.text);
  tidy.doubleStops = stops.count;
  const areas = fixAreasCount(stops.text);
  tidy.areasCount = areas.fixed;
  return { text: areas.text, tidy };
}

// The letter with the offending sentences removed (paragraphs kept, an
// emptied one dropped), the 30 Oct rules applied, and what changed. The
// first body sentence — the role by name — is never removed, nor anything
// after the sign-off.
export function applyLetterLint(letter: string, opts: LetterLintOptions = {}): { text: string; lint: LetterLint; rules: LetterRules } {
  const lint: LetterLint = { secondPerson: [], restatedJd: [] };
  const rules: LetterRules = { bannedPhrases: [], extraGaps: [], repeatedFacts: [], projectDescriptors: [] };
  if (!letter || !letter.trim()) return { text: letter, lint, rules };
  const projectNames = [...new Set((opts.projects ?? []).map(coreProjectName).filter((n) => n.length >= 3))];
  const described = (opts.projects ?? []).map(projectDescriptor).filter((p): p is { name: string; descriptor: string } => !!p);
  const gapTerms = opts.essentialGaps;
  let gapKept = false;
  const factFirstParagraph = new Map<string, number>();

  const lines = letter.replace(/\r/g, "").split("\n");
  let bodySeen = false;
  let afterSignoff = false;
  let paragraph = -1;
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || afterSignoff) return line;
    if (SIGNOFF_RE.test(t)) {
      afterSignoff = true;
      return line;
    }
    if (SALUTATION_RE.test(t)) return line;
    paragraph++;
    const kept = sentencesOf(t).flatMap((original) => {
      const first = !bodySeen;
      bodySeen = true;
      let s = original;
      for (const [re, to, label] of BANNED_REWRITES) {
        if (!re.test(s)) continue;
        s = rewriteKeepingCase(s, re, to);
        rules.bannedPhrases.push(label);
      }
      const remember = (sentence: string) => {
        for (const k of factsOf(sentence, projectNames)) if (!factFirstParagraph.has(k)) factFirstParagraph.set(k, paragraph);
      };
      if (first) {
        s = trimOpeningClauses(s, rules.bannedPhrases);
        remember(s);
        return [s];
      }
      if (restatesJd(s)) {
        // "The team is building X, and I built Y." — the posting's half goes,
        // the candidate's own clause stays (review, 1 Oct).
        const own = /,\s*(?:and\s+|but\s+|while\s+|so\s+)?((?:I|I've|I’ve|I'm|I’m|I'd|I’d|my|we|we've|we’ve)\b.*)$/.exec(s);
        lint.restatedJd.push(s);
        if (own) return [capitalise(own[1])];
        return [];
      }
      if (isSecondPerson(s)) {
        lint.secondPerson.push(s);
        return [];
      }
      const drop = BANNED_DROPS.find(([re]) => re.test(s));
      if (drop) {
        rules.bannedPhrases.push(drop[1]);
        return [];
      }
      if (gapTerms && isGapSentence(s)) {
        const namesEssential = gapTerms.some((term) => term.trim() && matchAtsKeywords(s, [term]).matched > 0);
        if (!gapKept && namesEssential) {
          gapKept = true;
        } else {
          rules.extraGaps.push(s);
          const own = ALTHOUGH_CLAUSE_RE.exec(s);
          if (!own) return [];
          s = capitalise(own[1]);
        }
      }
      // A fact an earlier paragraph already gave: the later telling goes.
      if (factsOf(s, projectNames).some((k) => (factFirstParagraph.get(k) ?? paragraph) < paragraph)) {
        rules.repeatedFacts.push(s);
        return [];
      }
      remember(s);
      return [s];
    });
    // A paragraph every sentence left goes with them (null, filtered below).
    return kept.length > 0 ? kept.join(" ") : null;
  });

  const changes = lint.secondPerson.length + lint.restatedJd.length + rules.bannedPhrases.length + rules.extraGaps.length + rules.repeatedFacts.length;
  let text = changes > 0 ? out.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim() : letter;
  if (described.length > 0) {
    // Only the body: never the salutation or anything after the sign-off.
    const all = text.split("\n");
    const start = all.findIndex((l) => SALUTATION_RE.test(l.trim())) + 1;
    let end = all.findIndex((l) => SIGNOFF_RE.test(l.trim()));
    if (end < 0) end = all.length;
    const body = describeProjects(all.slice(start, end).join("\n"), described, rules.projectDescriptors);
    if (rules.projectDescriptors.length > 0) text = [...all.slice(0, start), body, ...all.slice(end)].join("\n");
  }
  return { text, lint, rules };
}
