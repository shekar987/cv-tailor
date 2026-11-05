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
//   label      an applicant tracker's own level field, as the posting prints it
//              ("Minimum experience: Mid-level" on BambooHR, "Seniority level:
//              Mid-Senior level" on LinkedIn) — decisive, like the title
//   band+duty  (5 Nov 2026) a GBP salary floor of SALARY_FLOOR_MID or more
//              beside mentoring or architecture duties reads as mid-level:
//              Seccl's "£55K – £75K" with "Mentoring engineers" and
//              "Architecting … infrastructure" tied mid and senior and was
//              read as senior, which no posting at that band is
//
// The title is decisive when present; the rest add up. Nothing here reads
// the candidate's CV — only the posting and, for the fit, their stated years.

export type Level = "junior" | "mid" | "senior";
export type SignalKind = "title" | "years" | "ownership" | "salary" | "label";
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
// A GBP floor at or above this, with mentoring or architecture duties, is a mid-level band.
export const SALARY_FLOOR_MID = 55_000;

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

// An applicant tracker's level field, as printed in the posting. BambooHR's
// values (Entry-level, Mid-level, Experienced, Manager/Supervisor, Senior
// Manager/Supervisor, Executive, Student) and LinkedIn's (Internship, Entry
// level, Associate, Mid-Senior level, Director, Executive).
// A label is a line of its own ("Minimum experience: Mid-level"), never prose that happens to say the words.
const LABEL_RE = /^\s*(?:[-•*]\s*)?(?:minimum\s+experience|experience\s+level|seniority\s+level|career\s+level|job\s+level)\s*[:：-]\s*([A-Za-z][A-Za-z /-]{2,40}?)\s*$/im;
function labelLevel(value: string): Level | null {
  const v = value.toLowerCase();
  if (/\b(?:entry|student|intern|graduate|junior|trainee|apprentice)/.test(v)) return "junior";
  if (/\bassociate\b/.test(v) && !/\bdirector\b/.test(v)) return "junior";
  if (/\bmid\b|mid[-\s]|\bintermediate\b/.test(v)) return "mid";
  if (/\b(?:experienced|senior|manager|supervisor|director|executive|lead|principal)\b/.test(v)) return "senior";
  return null;
}
// Duties that go with a mid-level band: mentoring others, or owning the architecture.
// The verb, not the job title: "work alongside our architects" is no duty.
const ARCHITECTURE_RE =
  /\barchitect(?:ing|ed)\b|\b(?:own|owns|owning|lead|leads|leading|drive|drives|driving|make|makes|making|shape|shapes|shaping|define|defines|defining)\s+(?:the\s+|our\s+)?(?:key\s+)?(?:platform\s+|system\s+|technical\s+|solution\s+)?architectur(?:e|al\s+decisions?)\b/i;

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
  // A tracker's level label ("Seniority level: Mid-Senior level") is read below, never as the title.
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !LABEL_RE.test(l)) ?? "";
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

  const label = LABEL_RE.exec(text);
  const labelled = label ? labelLevel(label[1]) : null;
  if (label && labelled) signals.push({ kind: "label", text: label[0].replace(/\s+/g, " ").trim(), level: labelled, weight: 3 });

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
    const shown = m[0].replace(/\s+/g, " ").trim();
    signals.push({ kind: "salary", text: shown, level, weight: 1 });
    // A mid-level floor with the duties that go with it: decisive, like a title,
    // except against a junior title — graduate schemes at £55k+ are common.
    const duty = OWNERSHIP_RES[0].re.test(text) ? "mentoring" : ARCHITECTURE_RE.test(text) ? "architecture" : null;
    if (cur === "GBP" && level === "mid" && low >= SALARY_FLOOR_MID && duty && title?.level !== "junior") {
      signals.push({ kind: "salary", text: `${shown} with ${duty} duties`, level: "mid", weight: 3 });
    }
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
// earlyCareerOnly (Customize → Eligibility, 5 Nov 2026): the user looks for
// junior and early-career roles only, so a mid-level or senior read never
// fits, whatever their years say.
export function seniorityFit(read: SeniorityRead, yearsExperience: number | null, opts: { earlyCareerOnly?: boolean } = {}): SeniorityFit {
  const { level, signals } = read;
  const label = LEVEL_LABEL[level];
  if (level === "unknown") return { level, fits: null, reason: "The posting doesn't say which level it is written for.", signals };
  if (level === "junior") return { level, fits: true, reason: `This reads as ${label}.`, signals };
  if (opts.earlyCareerOnly) {
    return { level, fits: false, reason: `This reads as ${label} — tailoring anyway will spend a credit. You look for junior and early-career roles only (Customize → Eligibility).`, signals };
  }
  const need = level === "senior" ? SENIOR_MIN_YEARS : MID_MIN_YEARS;
  if (yearsExperience === null) {
    return { level, fits: null, reason: `This reads as ${label} (roles at this level usually expect ${need}+ years) and your years of experience are not set in Customize → Eligibility, so it cannot be checked — set them. Tailoring anyway spends a credit.`, signals };
  }
  if (yearsExperience >= need) return { level, fits: true, reason: `This reads as ${label}; your ${yearsExperience} years cover it.`, signals };
  return {
    level,
    fits: false,
    reason: `This reads as ${label} — tailoring anyway will spend a credit. Roles at this level usually expect ${need}+ years; you have ${yearsExperience}.`,
    signals,
  };
}
