// Pure helpers for the "Applied" snapshot — what the tracker row gets when a
// finished tailoring run is saved. Everything here is string assembly from
// data the pipeline already produced or the user already pasted. Nothing is
// inferred and no model is called.

export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ── Salary ──────────────────────────────────────────────────────────────────
// Only a salary the posting literally states is returned. Three shapes:
//   A  currency-led:   £65,000 · $120k–$140k · €55.000 · INR 12,00,000 p.a.
//   B  range + period: 65,000 - 75,000 per annum · 12-15 LPA
//   C  single + period: 40,000 per year · 12 LPA · £25 per hour
// A match must also look like pay (see isPlausible) and, ideally, sit near a
// compensation word; otherwise it's dropped and salary stays blank.

const AMOUNT = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const CURRENCY = String.raw`(?:[£$€₹]|(?:GBP|USD|EUR|INR|AUD|CAD)\s?)`;
const RANGE = String.raw`\s?(?:-|–|—|to)\s?`;
const PERIOD = String.raw`(?:per\s+(?:annum|year|month|hour|day)|p\.?\s?a\.?(?![a-z])|an?\s+(?:year|month|hour)|annually|monthly|hourly|\/\s?(?:year|yr|annum|month|mo|hour|hr)|LPA|lakhs?(?:\s+per\s+annum)?)`;
const NOT_MAGNITUDE = String.raw`(?!\s?(?:m|mm|million|bn|billion|%)\b)`;

const SALARY_RE = new RegExp(
  [
    // A: currency-led, optional range, optional period
    String.raw`${CURRENCY}\s?(${AMOUNT})(\s?[kK]\b)?${NOT_MAGNITUDE}(?:${RANGE}${CURRENCY}?(?:${AMOUNT})(?:\s?[kK]\b)?)?(?:\s?${PERIOD})?`,
    // B: number range + period
    String.raw`(?<![\d.,£$€₹])(${AMOUNT})(\s?[kK]\b)?${RANGE}(?:${AMOUNT})(?:\s?[kK]\b)?\s?${PERIOD}`,
    // C: single number + period
    String.raw`(?<![\d.,£$€₹])(${AMOUNT})(\s?[kK]\b)?\s?${PERIOD}`,
  ].join("|"),
  "gi"
);

const PAY_CONTEXT_RE = /\b(salary|salaries|compensation|comp|pay|package|remuneration|ote|base|stipend|rate|wage|ctc)\b/i;
// A figure described by one of these is money, but not the salary.
const NOT_PAY_CONTEXT_RE = /\b(bonus|sign[- ]?on|equity|options|credit|fee|fees|funding|raised|revenue|budget|discount|voucher|allowance)\b/i;
const PERIOD_RE = new RegExp(PERIOD, "i");

type Candidate = { text: string; index: number; end: number; strong: boolean };

function isPlausible(m: RegExpExecArray): Candidate | null {
  const text = m[0].trim();
  const amountStr = m[1] ?? m[3] ?? m[5] ?? "";
  const hasK = Boolean(m[2] ?? m[4] ?? m[6]);
  const value = Number(amountStr.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) return null;
  const hasPeriod = PERIOD_RE.test(text);
  // A bare currency figure below 10,000 is far more often a bonus, fee or
  // credit than a salary; with a k suffix or a period marker it's explicit.
  const strong = hasK || hasPeriod || value >= 10_000;
  if (!strong && value < 1_000) return null;
  return { text: text.slice(0, 100), index: m.index, end: m.index + m[0].length, strong };
}

// The words around a figure, limited to its own sentence so a neighbouring
// sentence's "salary" can't vouch for this figure.
function contextBefore(text: string, index: number): string {
  const s = text.slice(Math.max(0, index - 60), index);
  const cut = Math.max(s.lastIndexOf("."), s.lastIndexOf("!"), s.lastIndexOf("?"), s.lastIndexOf("\n"));
  return cut >= 0 ? s.slice(cut + 1) : s;
}
function contextAfter(text: string, end: number): string {
  const s = text.slice(end, end + 30);
  const cut = s.search(/[.!?\n]/);
  return cut >= 0 ? s.slice(0, cut) : s;
}

export function extractSalary(jd: string): string | null {
  if (!jd) return null;
  const candidates: Candidate[] = [];
  SALARY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SALARY_RE.exec(jd)) !== null) {
    if (m[0].length === 0) {
      SALARY_RE.lastIndex++;
      continue;
    }
    const c = isPlausible(m);
    if (c) candidates.push(c);
  }

  // First pass: a figure its own sentence calls pay. A pay word before the
  // figure ("Compensation: $120k ... plus equity") settles it; otherwise a
  // bonus/equity/fee word on either side drops the figure entirely.
  const remaining: Candidate[] = [];
  for (const c of candidates) {
    const before = contextBefore(jd, c.index);
    const after = contextAfter(jd, c.end);
    if (PAY_CONTEXT_RE.test(before)) return c.text;
    if (NOT_PAY_CONTEXT_RE.test(before) || NOT_PAY_CONTEXT_RE.test(after)) continue;
    if (PAY_CONTEXT_RE.test(after)) return c.text;
    remaining.push(c);
  }
  // Otherwise the first figure that is unambiguous on its own (k suffix,
  // period marker, or five-plus digits).
  const strong = remaining.find((c) => c.strong);
  return strong ? strong.text : null;
}

// ── Notes ───────────────────────────────────────────────────────────────────

export type AtsScoreLike = {
  keyword_coverage?: string;
  required_skill_coverage?: string;
  overall_assessment?: string;
  misses?: string[];
} | null | undefined;

const MAX_NOTES = 2000;

// ── Second person ───────────────────────────────────────────────────────────
// The scorer is asked to address the user as "you" but drifts into "the
// candidate". These are the user's own notes, so they should read that way.
// Only explicit "the/this candidate" phrasings are touched; "a strong
// candidate for this role" is left alone.

const IRREGULAR_VERBS: Record<string, string> = {
  has: "have",
  is: "are",
  does: "do",
  was: "were",
  "hasn't": "haven't",
  "isn't": "aren't",
  "doesn't": "don't",
  "wasn't": "weren't",
};
const ADVERBS = new Set([
  "also", "already", "clearly", "currently", "only", "still", "never", "not",
  "now", "then", "likely", "probably", "certainly", "generally", "mostly", "largely",
]);

// Third-person-singular verb → base form ("lacks" → "lack"); null when the
// word doesn't look like such a verb, so nouns and adverbs pass through.
function baseVerb(word: string): string | null {
  const lower = word.toLowerCase();
  if (IRREGULAR_VERBS[lower]) return IRREGULAR_VERBS[lower];
  if (lower.length < 4 || !lower.endsWith("s") || /(ss|us|is|os)$/.test(lower)) return null;
  if (/(ches|shes|sses|xes|zes|oes)$/.test(lower)) return word.slice(0, -2);
  if (/[^aeiou]ies$/.test(lower)) return `${word.slice(0, -3)}y`;
  return word.slice(0, -1);
}

// `rest` is up to two words following "candidate", whitespace included.
// Conjugates the first verb-looking word, skipping over a leading adverb.
function conjugateTail(rest: string): string {
  const parts = rest.match(/^(\s+)(\S+)(?:(\s+)(\S+))?$/);
  if (!parts) return rest;
  const [, sp1, w1, sp2 = "", w2 = ""] = parts;
  const first = baseVerb(w1);
  if (first) return `${sp1}${first}${sp2}${w2}`;
  if (ADVERBS.has(w1.toLowerCase()) || /ly$/i.test(w1)) {
    const second = w2 ? baseVerb(w2) : null;
    if (second) return `${sp1}${w1}${sp2}${second}`;
  }
  return rest;
}

export function toSecondPerson(text: string): string {
  const you = (word: string) => (/^[A-Z]/.test(word) ? "You" : "you");
  const your = (word: string) => (/^[A-Z]/.test(word) ? "Your" : "your");
  return text
    .replace(/\b(the|this) candidate's\b/gi, (_m, det: string) => your(det))
    .replace(/\b(the|this) candidate\b((?:\s+[\w']+){0,2})/gi, (_m, det: string, rest: string) => you(det) + conjugateTail(rest))
    // Bare "candidate has …", as in "…not mentioned; candidate has generic AWS experience".
    .replace(/(?<!\b(?:a|an|strong|ideal|good|suitable)\s)\b(candidate)\b((?:\s+[\w']+){0,2})/gi, (_m, word: string, rest: string) =>
      you(word) + conjugateTail(rest)
    )
    .replace(/\bcandidate's\b/gi, "your");
}

// Cut at a word boundary with an ellipsis, never mid-word.
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max - 1);
  return `${text.slice(0, cut > max / 2 ? cut : max - 1).trimEnd()}…`;
}

// Two to three lines: the scorer's own assessment, the coverage numbers, and
// the gaps it flagged — from the run's real output, only re-addressed to "you".
export function buildAppliedNotes(atsScore: AtsScoreLike): string | null {
  if (!atsScore) return null;
  const lines: string[] = [];

  const assessment = toSecondPerson((atsScore.overall_assessment ?? "").trim());
  if (assessment) {
    const firstTwo = assessment.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    lines.push(clip(firstTwo, 300));
  }

  const coverage: string[] = [];
  const kw = (atsScore.keyword_coverage ?? "").trim();
  const req = (atsScore.required_skill_coverage ?? "").trim();
  if (kw) coverage.push(`${kw} keywords`);
  if (req) coverage.push(`${req} required skills`);
  if (coverage.length) lines.push(`ATS match: ${coverage.join(", ")}`);

  const misses = Array.isArray(atsScore.misses)
    ? atsScore.misses.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 3)
    : [];
  if (misses.length) {
    lines.push(`Gaps flagged: ${misses.map((x) => clip(toSecondPerson(x.trim()), 140)).join("; ")}`);
  }

  if (lines.length === 0) return null;
  return lines.join("\n").slice(0, MAX_NOTES);
}
