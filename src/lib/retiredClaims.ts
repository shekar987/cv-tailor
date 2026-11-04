// Phrases a CV or letter must never carry (4 Nov 2026, Chunk 12). Import-free,
// tests/retiredClaims.
//
// CareerSet runs on 3 and 4 Nov printed wording the owner had taken out of their CV.
// Each user keeps their own list (user_settings.preferences.retiredClaims, on
// Customize), because the wording is theirs: a rule written into the code would put
// one person's job title on another person's CV. The list only ever removes or
// replaces what the user named. No model call and no prompt change.
//
// /api/tailor fixes what it can on the finished text; /app and the download routes
// hold the file while anything on the list is still there, so an edit in the preview
// or an old tracker snapshot cannot bring it back. BUILT_IN holds the two phrases no
// CV should ever print, for every user: both come from a removed letter point, not
// from anyone's history.

export type RetiredClaim = { phrase: string; replacement: string | null };

export const MAX_RETIRED_CLAIMS = 40;
export const MAX_RETIRED_CHARS = 200;
const ARROW_RE = /\s*(?:=>|→)\s*/;

export const BUILT_IN_RULES: readonly RetiredClaim[] = [
  { phrase: "listed in my functional competencies", replacement: null },
  { phrase: "these are the one areas", replacement: "this is the one area" },
  { phrase: "the one areas", replacement: "the one area" },
];

/** One rule a line: "phrase", or "phrase => what to write instead". */
export function parseRetiredClaims(text: unknown): RetiredClaim[] {
  if (typeof text !== "string") return [];
  const out: RetiredClaim[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const [phrasePart, ...rest] = raw.split(ARROW_RE);
    const phrase = phrasePart.trim().slice(0, MAX_RETIRED_CHARS);
    if (phrase.length < 3) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const replacement = rest.join(" ").trim().slice(0, MAX_RETIRED_CHARS);
    out.push({ phrase, replacement: replacement || null });
    if (out.length >= MAX_RETIRED_CLAIMS) break;
  }
  return out;
}

export function formatRetiredClaims(rules: readonly RetiredClaim[]): string {
  return rules.map((r) => (r.replacement ? `${r.phrase} => ${r.replacement}` : r.phrase)).join("\n");
}

/** A stored value re-bounded on read: the user can write their own row. */
export function normalizeRetiredClaims(value: unknown): RetiredClaim[] {
  if (!Array.isArray(value)) return [];
  const lines = value
    .filter((v): v is { phrase: unknown; replacement?: unknown } => !!v && typeof v === "object")
    .map((v) => {
      const phrase = typeof v.phrase === "string" ? v.phrase.replace(/\s+/g, " ").trim() : "";
      const replacement = typeof v.replacement === "string" ? v.replacement.replace(/\s+/g, " ").trim() : "";
      return replacement ? `${phrase} => ${replacement}` : phrase;
    });
  return parseRetiredClaims(lines.join("\n"));
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A space or hyphen in a phrase matches either, and bold markers between words are
// ignored: "exactly once" is "exactly-once", "idempotent **Stripe**" is the phrase.
function phraseRe(phrase: string): RegExp {
  const body = phrase.trim().split(/[\s-]+/).map(esc).join("[\\s\\-*]+");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
}

// Longest first, so "these are the one areas" is read before "the one areas".
function allRules(rules: readonly RetiredClaim[]): RetiredClaim[] {
  return [...rules, ...BUILT_IN_RULES].sort((a, b) => b.phrase.length - a.phrase.length);
}

/** The phrases still present in a text. */
export function findRetired(text: string, rules: readonly RetiredClaim[]): string[] {
  const t = text ?? "";
  const out: string[] = [];
  for (const rule of allRules(rules)) {
    if (phraseRe(rule.phrase).test(t) && !out.some((p) => p.toLowerCase() === rule.phrase.toLowerCase())) out.push(rule.phrase);
  }
  return out;
}

function matchCase(replacement: string, found: string): string {
  return /^[A-Z]/.test(found) && /^[a-z]/.test(replacement) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

const BULLET_RE = /^(\s*(?:[•\-*·▪◦–]|\d{1,2}[.)])\s+)/;
// A job header (two pipes, or the preview's marker) is never deleted: the check
// reports it instead, and the user decides.
const isHeaderLine = (line: string) => line.includes("@@JOB@@") || ((line.match(/\|/g) ?? []).length >= 2 && /\b(?:19|20)\d{2}\b|\bpresent\b/i.test(line.slice(line.lastIndexOf("|"))));
// "Label: a, b, c": one item goes, not the line.
const LIST_ITEM_SEPARATORS = /\s*[,|;]\s*/;
const MAX_LIST_ITEM_WORDS = 6;

function dropFromList(line: string, re: RegExp): string | null {
  const m = /^(\s*\*{0,2}[^:,|]{1,40}:\*{0,2}\s*)(.+)$/.exec(line);
  if (!m || /[.!?]\s*$/.test(m[2])) return null;
  const items = m[2].split(LIST_ITEM_SEPARATORS);
  if (items.length < 2 || items.some((item) => item.trim().split(/\s+/).length > MAX_LIST_ITEM_WORDS)) return null;
  const separator = m[2].includes("|") ? " | " : ", ";
  const kept = items.filter((item) => {
    re.lastIndex = 0;
    return !re.test(item);
  });
  if (kept.length === items.length || kept.length === 0) return null;
  return m[1] + kept.join(separator);
}

function dropSentences(line: string, re: RegExp): string {
  const bullet = BULLET_RE.exec(line)?.[1] ?? "";
  const body = line.slice(bullet.length);
  const kept = body.split(/(?<=[.!?])\s+/).filter((sentence) => {
    re.lastIndex = 0;
    return !re.test(sentence);
  });
  return kept.length > 0 ? bullet + kept.join(" ") : "";
}

export type RetiredReport = { replaced: { from: string; to: string }[]; removed: string[] };

/**
 * The text with each rule applied: a replacement where the rule gives one; otherwise
 * the list item, the sentence, or the bullet that says it goes. A job header is left
 * for the check to report.
 */
export function applyRetired(text: string, rules: readonly RetiredClaim[]): { text: string; report: RetiredReport } {
  const report: RetiredReport = { replaced: [], removed: [] };
  let out = text ?? "";
  for (const rule of allRules(rules)) {
    const re = phraseRe(rule.phrase);
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    if (rule.replacement !== null) {
      const to = rule.replacement;
      out = out.replace(re, (found) => matchCase(to, found));
      report.replaced.push({ from: rule.phrase, to });
      continue;
    }
    let removed = false;
    out = out
      .split("\n")
      .flatMap((line) => {
        re.lastIndex = 0;
        if (!re.test(line) || isHeaderLine(line)) return [line];
        removed = true;
        const trimmed = dropFromList(line, re) ?? dropSentences(line, re);
        return trimmed.trim() ? [trimmed] : [];
      })
      .join("\n");
    if (removed) report.removed.push(rule.phrase);
  }
  return { text: out, report };
}

/** Project bullets, keyed by index: a bullet that says nothing else goes. */
export function applyRetiredToBullets(projects: Record<string, unknown> | null | undefined, rules: readonly RetiredClaim[]): { projects: Record<string, unknown>; report: RetiredReport } {
  const report: RetiredReport = { replaced: [], removed: [] };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(projects ?? {})) {
    if (!Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    out[key] = value.flatMap((bullet) => {
      if (typeof bullet !== "string") return [bullet];
      const r = applyRetired(bullet, rules);
      report.replaced.push(...r.report.replaced);
      report.removed.push(...r.report.removed);
      return r.text.trim() ? [r.text] : [];
    });
  }
  return { projects: out, report };
}

export function mergeReports(...reports: RetiredReport[]): RetiredReport {
  const replaced = new Map<string, { from: string; to: string }>();
  const removed = new Set<string>();
  for (const r of reports) {
    for (const item of r.replaced) replaced.set(item.from.toLowerCase(), item);
    for (const phrase of r.removed) removed.add(phrase);
  }
  return { replaced: [...replaced.values()], removed: [...removed] };
}

/** The sentence beside a held download. */
export function retiredBlockMessage(phrases: readonly string[]): string {
  const list = phrases.slice(0, 3).map((p) => `"${p}"`).join(", ");
  return `This still says ${list}, which your list on Customize rules out. Edit it in the preview, then download.`;
}
