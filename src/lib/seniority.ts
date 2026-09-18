// Seniority classifier for the pre-check — runs before a tailor credit is
// spent. Reads the posting for four kinds of signal and says which level it
// is written for, then compares that with the candidate's years so the gate
// card can warn: "This reads as mid-level — tailoring anyway will spend a
// credit." Deterministic, import-free, unit-tested.
//
//   title      senior / staff / principal / lead / head of / architect,
//              level suffixes (Engineer I = junior, II = mid, III+ = senior),
//              junior / graduate / associate / intern / entry level
//   years      the stated minimum ("3+ years", "at least 5 years")
//   ownership  mentoring others, owning the roadmap, setting technical
//              direction, line management, writing the RFCs
//   salary     the midpoint of a posted annual band (GBP / USD / EUR); day and
//              hourly rates are ignored
//
// The title is decisive when present; the rest add up. Nothing here reads
// the candidate's CV — only the posting and, for the fit, their stated years.

export type Level = "junior" | "mid" | "senior";
export type SignalKind = "title" | "years" | "ownership" | "salary";
export type Signal = { kind: SignalKind; text: string; level: Level; weight: number };
export type SeniorityRead = {
  level: Level | "unknown";
  signals: Signal[];
  score: Record<Level, number>;
};
export type SeniorityFit = {
  level: Level | "unknown";
  // true = the candidate's years cover this level; false = they don't (the
  // blocking warning); null = years unknown or nothing to compare.
  fits: boolean | null;
  reason: string;
  signals: Signal[];
};

// Years a posting at each level usually expects. A mid-level read against a
// candidate with fewer than MID_MIN_YEARS is the warning the owner asked for.
export const MID_MIN_YEARS = 3;
export const SENIOR_MIN_YEARS = 5;

export const LEVEL_LABEL: Record<Level | "unknown", string> = {
  junior: "junior / early-career",
  mid: "mid-level",
  senior: "senior",
  unknown: "unclear",
};

const TITLE_SENIOR_RE = /\b(?:senior|staff|principal|distinguished|lead|head\s+of|director|architect|sr\.?)\b|\b(?:engineer|developer|scientist|analyst|manager)\s+(?:III|IV|V)\b|\bL[5-8]\b/i;
const TITLE_MID_RE = /\b(?:engineer|developer|scientist|analyst|manager)\s+II\b|\bL4\b|\bmid[-\s]?level\b|\bintermediate\b/i;
const TITLE_JUNIOR_RE =
  /\b(?:junior|graduate|associate|intern|internship|entry[-\s]level|early[-\s]career|early[-\s]careers|apprentice|trainee|placement|jr\.?)\b|\b(?:engineer|developer|scientist|analyst)\s+I\b|\bL[1-3]\b/i;

// "3+ years", "at least 5 years' experience", "minimum of 2 years", "2-4 years".
const YEARS_RE =
  /\b(?:(?:minimum|min\.?|at\s+least|over|more\s+than)\s+(?:of\s+)?)?(\d{1,2})\s*(?:\+|-|–|to\s+\d{1,2})?\s*(?:\d{1,2})?\s*\+?\s*(?:years?|yrs?)(?:['’]s?)?\s+(?:of\s+)?(?:(?:professional|commercial|industry|relevant|hands[-\s]on|software|engineering|development|backend|frontend|full[-\s]stack|production)\s+){0,3}(?:experience|exp\b)/gi;

// Active ownership: the reader will mentor, own, set direction, manage or
// write the RFCs. "You'll be mentored by senior engineers" is the opposite
// and must not match.
const OWNERSHIP_RES: { re: RegExp; text: string }[] = [
  { re: /(?<!\bbe\s|\bbeing\s|\breceive\s|\bget\s|\bgets\s)\bmentor(?:s|ing)?\s+(?!by\b|from\b)(?:junior|other|the|our|new|less[-\s]experienced|engineers|developers|team|colleagues|members)/i, text: "mentoring others" },
  { re: /\bown(?:s|ing)?\s+(?:the\s+)?(?:technical\s+|product\s+|engineering\s+)?roadmap\b/i, text: "owning the roadmap" },
  { re: /\b(?:set|sets|setting|define|defines|defining|drive|drives|driving|own|owns|owning)\s+(?:the\s+)?(?:overall\s+)?technical\s+(?:direction|strategy|vision)\b/i, text: "setting technical direction" },
  { re: /\bline[-\s]manag(?:e|es|ing|ement)\b|\bmanage\s+(?:a\s+team|the\s+team|\d+\s+engineers|direct\s+reports)\b/i, text: "line management" },
  { re: /\b(?:write|writes|writing|author|authors|authoring|own|owns|owning)\s+(?:the\s+)?(?:design\s+docs?|rfcs?|adrs?|architecture\s+decision\s+records)\b/i, text: "writing the RFCs / design docs" },
  { re: /\btechnical\s+leadership\b|\blead\s+(?:a|the|our)\s+(?:team|squad|pod)\b|\btech\s+lead\b/i, text: "technical leadership" },
];

// Annual bands. Day and hourly rates say nothing about level.
const SALARY_RE = /(£|\$|€|\bGBP\s?|\bUSD\s?|\bEUR\s?)\s?(\d{2,3}(?:,\d{3})+|\d{2,3}\s?k\b|\d{5,6})(?:\s*(?:-|–|to)\s*(?:£|\$|€|GBP\s?|USD\s?|EUR\s?)?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}\s?k\b|\d{5,6}))?/gi;
const RATE_RE = /\b(?:per|a|\/)\s*(?:day|hour|hr)\b|\bday\s+rate\b|\bhourly\b|\bp\.?\s?d\.?\b/i;
const SALARY_BANDS: Record<"GBP" | "USD" | "EUR", { junior: number; senior: number }> = {
  GBP: { junior: 40_000, senior: 75_000 },
  USD: { junior: 95_000, senior: 165_000 },
  EUR: { junior: 45_000, senior: 85_000 },
};

function amount(s: string): number {
  const t = s.toLowerCase().replace(/\s+/g, "");
  return t.endsWith("k") ? parseInt(t, 10) * 1000 : parseInt(t.replace(/,/g, ""), 10);
}
function currency(sym: string): "GBP" | "USD" | "EUR" {
  const s = sym.trim().toUpperCase();
  if (s === "$" || s === "USD") return "USD";
  if (s === "€" || s === "EUR") return "EUR";
  return "GBP";
}

function titleSignal(title: string): Signal | null {
  const t = title.trim();
  if (!t) return null;
  // Junior first: "Senior" never appears in a graduate title, but "Associate
  // Director" exists — the more specific junior token wins the rare tie only
  // when no senior token is present.
  const senior = TITLE_SENIOR_RE.exec(t);
  const junior = TITLE_JUNIOR_RE.exec(t);
  const mid = TITLE_MID_RE.exec(t);
  if (senior && !junior) return { kind: "title", text: senior[0], level: "senior", weight: 3 };
  if (junior && !senior) return { kind: "title", text: junior[0], level: "junior", weight: 3 };
  if (mid) return { kind: "title", text: mid[0], level: "mid", weight: 3 };
  if (senior && junior) return { kind: "title", text: senior[0], level: "senior", weight: 2 };
  return null;
}

export function classifySeniority(jd: string, roleTitle?: string | null): SeniorityRead {
  const text = jd || "";
  const signals: Signal[] = [];
  // The analyser's role title when given, else the posting's first line.
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const title = titleSignal(roleTitle?.trim() || firstLine.slice(0, 120)) ?? (roleTitle ? titleSignal(firstLine.slice(0, 120)) : null);
  if (title) signals.push(title);

  let minYears: { n: number; text: string } | null = null;
  for (const m of text.matchAll(YEARS_RE)) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n > 30) continue;
    if (!minYears || n > minYears.n) minYears = { n, text: m[0].replace(/\s+/g, " ").trim() };
  }
  if (minYears) {
    const level: Level = minYears.n >= SENIOR_MIN_YEARS ? "senior" : minYears.n >= MID_MIN_YEARS ? "mid" : "junior";
    signals.push({ kind: "years", text: minYears.text, level, weight: 2 });
  }

  let ownership = 0;
  for (const o of OWNERSHIP_RES) {
    if (ownership >= 2) break;
    if (o.re.test(text)) {
      signals.push({ kind: "ownership", text: o.text, level: "senior", weight: 1 });
      ownership++;
    }
  }

  for (const m of text.matchAll(SALARY_RE)) {
    const around = text.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + m[0].length + 24);
    if (RATE_RE.test(around)) continue;
    const cur = currency(m[1]);
    // The midpoint of a band (a £60k-£80k posting is a mid-level one; its
    // top is what a strong hire negotiates), the figure itself otherwise.
    const low = amount(m[2]);
    const mid = m[3] ? (low + amount(m[3])) / 2 : low;
    if (!Number.isFinite(mid) || mid < 10_000 || mid > 1_000_000) continue;
    const band = SALARY_BANDS[cur];
    const level: Level = mid > band.senior ? "senior" : mid < band.junior ? "junior" : "mid";
    signals.push({ kind: "salary", text: m[0].replace(/\s+/g, " ").trim(), level, weight: 1 });
    break;
  }

  // Ownership language on its own is not a level: a junior consultancy
  // posting says "as you grow you'll mentor junior developers". It counts
  // only beside a title, years or salary signal, or when two phrases agree.
  const ownershipOnly = signals.length > 0 && signals.every((s) => s.kind === "ownership");
  const kept = ownershipOnly && signals.length < 2 ? [] : signals;
  const score: Record<Level, number> = { junior: 0, mid: 0, senior: 0 };
  for (const s of kept) score[s.level] += s.weight;
  if (kept.length === 0) return { level: "unknown", signals: kept, score };
  let level: Level = "mid";
  let best = -1;
  for (const l of ["senior", "mid", "junior"] as Level[]) {
    if (score[l] > best) {
      best = score[l];
      level = l;
    }
  }
  // A tie is settled by the title when there is one.
  const tied = (["junior", "mid", "senior"] as Level[]).filter((l) => score[l] === best);
  if (tied.length > 1 && title && tied.includes(title.level)) level = title.level;
  return { level, signals, score };
}

// Compare the read with the candidate's stated years. A false `fits` is the
// blocking warning; the read never blocks on its own when years are unknown.
export function seniorityFit(read: SeniorityRead, yearsExperience: number | null): SeniorityFit {
  const { level, signals } = read;
  const label = LEVEL_LABEL[level];
  if (level === "unknown") return { level, fits: null, reason: "The posting doesn't say which level it is written for.", signals };
  if (level === "junior") return { level, fits: true, reason: `This reads as ${label}.`, signals };
  const need = level === "senior" ? SENIOR_MIN_YEARS : MID_MIN_YEARS;
  if (yearsExperience === null) {
    return { level, fits: null, reason: `This reads as ${label} (roles at this level usually expect ${need}+ years). Add your years of experience in Customize to check it.`, signals };
  }
  if (yearsExperience >= need) return { level, fits: true, reason: `This reads as ${label}; your ${yearsExperience} years cover it.`, signals };
  return {
    level,
    fits: false,
    reason: `This reads as ${label} — tailoring anyway will spend a credit. Roles at this level usually expect ${need}+ years; you have ${yearsExperience}.`,
    signals,
  };
}
