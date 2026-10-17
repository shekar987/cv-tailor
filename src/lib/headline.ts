// The header line under the candidate's name, built deterministically per run
// in the UKJI shape a recruiter scans in two seconds:
//
//   MSc Computer Science (in progress, expected 2026) · React · 2 years' experience · Backend engineer (Java, Spring Boot)
//
// Every piece comes from something the user stated, or is omitted:
// - qualification: the profile's first education entry, with its status read
//   off the entry's own dates/note ("Present", "expected", a completion year)
// - skill: the first of the posting's required skills, then its keywords,
//   that the claims registry holds at PRODUCTION level — a project-level or
//   learning skill never headlines
// - years: the user's own eligibility answer, never inferred from dates
// - positioning: the headline of the positioning variant picked for this
//   run (lib/variants) — the user's own words. Until 30 Sep 2026 the last
//   slot was the posting's title, literally, which put "Python Developer -
//   Data & Analytics Team - Options Market Making" under a candidate's name
//   as if it were their identity; the summary carries the title for search,
//   the header never does
//
// Imports only ./atsMatch.ts (the same matcher that scores the CV), so it
// runs under node:test.
import { matchAtsKeywords } from "./atsMatch.ts";
import type { RenderOptions } from "./formatStyles/ids.ts";

export type HeadlineEducation = { degree?: string; dates?: string; note?: string };
export type HeadlineClaims = { skills: { name: string; level: string }[] } | null | undefined;

export type HeadlineInput = {
  education: HeadlineEducation[] | undefined;
  claims: HeadlineClaims;
  requiredSkills: unknown;
  keywords: unknown;
  yearsExperience: number | null | undefined;
  positioning: string | null | undefined;
  // CareerSet only: the role family in the user's own words when no variant is
  // picked — the first role their saved tagline names (lib/roleTitle).
  roleFamily?: string | null;
};

export type HeadlineParts = { qualification: string; skill: string; years: string; positioning: string };

export const HEADLINE_SEP = " · ";
const MAX_POSITIONING = 70;
const MAX_DEGREE = 60;

const IN_PROGRESS_RE = /\b(?:present|current(?:ly)?|expected|ongoing|in progress|anticipated|due)\b/i;
const EXPECTED_YEAR_RE = /\b(?:expected|anticipated|due|graduat\w*)\b\D{0,16}((?:19|20)\d{2})\b/i;

function lastYear(s: string): string | null {
  const years = s.match(/\b(?:19|20)\d{2}\b/g);
  return years ? years[years.length - 1] : null;
}

// "MSc Computer Science (in progress, expected 2026)" / "BSc Computing (2023)" /
// "MSc Computer Science (in progress)" / "MSc Computer Science". In progress =
// the entry says so ("Present", "expected"…) or its end year has not passed;
// the expected year is only one the entry states as such, or that end year.
// A start year before "Present" is never called the expected year.
// The degrees still in progress, by the entries' own dates to the month
// ("Jan 2025 – Jan 2027" is in progress in September 2026; "Sep 2025 – Jun
// 2026" is not): what a summary or letter must never state as held
// (lib/supportCheck fixHeldDegrees). A year with no month counts to December.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function endMonthIndex(dates: string): number | null {
  let last: number | null = null;
  for (const m of dates.matchAll(/\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+|(\d{1,2})\/)?((?:19|20)\d{2})\b/gi)) {
    const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : m[2] ? Math.min(11, Math.max(0, Number(m[2]) - 1)) : 11;
    last = Number(m[3]) * 12 + month;
  }
  return last;
}
export function degreesInProgress(education: HeadlineEducation[] | undefined, now: Date = new Date()): string[] {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  return (Array.isArray(education) ? education : [])
    .filter((e) => {
      if (!(e?.degree ?? "").trim()) return false;
      const dates = (e.dates ?? "").trim();
      if (IN_PROGRESS_RE.test(dates) || IN_PROGRESS_RE.test((e.note ?? "").trim())) return true;
      const end = endMonthIndex(dates);
      return end !== null && end >= nowIdx;
    })
    .map((e) => (e.degree ?? "").trim());
}

export function qualificationLabel(e: HeadlineEducation | undefined, now: number = new Date().getFullYear()): string {
  const degree = (e?.degree ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_DEGREE);
  if (!degree) return "";
  const dates = (e?.dates ?? "").trim();
  const note = (e?.note ?? "").trim();
  const endYear = lastYear(dates);
  const explicit = EXPECTED_YEAR_RE.exec(dates)?.[1] ?? EXPECTED_YEAR_RE.exec(note)?.[1] ?? null;
  const saysSo = IN_PROGRESS_RE.test(dates) || IN_PROGRESS_RE.test(note);
  const inProgress = saysSo || (endYear !== null && Number(endYear) >= now);
  if (inProgress) {
    const expected = explicit ?? (endYear !== null && Number(endYear) >= now ? endYear : null);
    return expected ? `${degree} (in progress, expected ${expected})` : `${degree} (in progress)`;
  }
  return endYear ? `${degree} (${endYear})` : degree;
}

function termList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
}

// The first `max` posting terms that name a production-level registry
// skill, in posting order, each registry name once; the registry's own
// spelling is used. Empty when there is no registry or no match.
export function topProductionSkills(claims: HeadlineClaims, requiredSkills: unknown, keywords: unknown, max = 1): string[] {
  const production = (claims?.skills ?? []).filter((s) => s.level === "production" && s.name.trim());
  if (production.length === 0) return [];
  const out: string[] = [];
  for (const term of [...termList(requiredSkills), ...termList(keywords)]) {
    if (out.length >= max) break;
    const hit = production.find((s) => matchAtsKeywords(s.name, [term]).matched > 0);
    if (hit && !out.includes(hit.name.trim())) out.push(hit.name.trim());
  }
  return out;
}

// The first posting term that names a production-level registry skill; the
// registry's own spelling is used. null when there is no registry or no match.
export function topProductionSkill(claims: HeadlineClaims, requiredSkills: unknown, keywords: unknown): string | null {
  return topProductionSkills(claims, requiredSkills, keywords, 1)[0] ?? null;
}

export function yearsLabel(years: number | null | undefined): string {
  if (typeof years !== "number" || !Number.isFinite(years) || years < 0) return "";
  const n = Math.round(years);
  if (n === 0) return "";
  return `${n} year${n === 1 ? "" : "s"}' experience`;
}

// CareerSet's tools slot: up to this many posting terms the registry holds at
// production level.
export const CAREERSET_HEADLINE_TOOLS = 5;

// `render` (lib/formatStyles RenderOptions): the separator, and the slots.
// UKJI: qualification · skill · years · positioning, as always. CareerSet:
// "<positioning> | <years> | <tool · tool · …>" — the positioning is the
// variant's own headline, else the role family the user's saved tagline
// names (lib/roleTitle taglineRoles, read by the route; decided 17 Oct 2026),
// never the posting's title; the years are the stated years in the one
// wording the app uses (never "2+", never "production" — the answer does
// not say so); the tools are posting terms at PRODUCTION level, registry
// spelling. A slot with nothing is left out.
export function buildHeadline(input: HeadlineInput, render?: Pick<RenderOptions, "headlineSeparator" | "headlineShape">): { headline: string; parts: HeadlineParts } {
  const positioning = typeof input.positioning === "string" ? input.positioning.trim().replace(/\s+/g, " ").slice(0, MAX_POSITIONING) : "";
  if (render?.headlineShape === "careerset") {
    const family = typeof input.roleFamily === "string" ? input.roleFamily.trim().replace(/\s+/g, " ").slice(0, MAX_POSITIONING) : "";
    const parts: HeadlineParts = {
      qualification: "",
      skill: topProductionSkills(input.claims, input.requiredSkills, input.keywords, CAREERSET_HEADLINE_TOOLS).join(" · "),
      years: yearsLabel(input.yearsExperience),
      positioning: positioning || family,
    };
    return { headline: [parts.positioning, parts.years, parts.skill].filter(Boolean).join(render.headlineSeparator), parts };
  }
  const parts: HeadlineParts = {
    qualification: qualificationLabel(input.education?.[0]),
    skill: topProductionSkill(input.claims, input.requiredSkills, input.keywords) ?? "",
    years: yearsLabel(input.yearsExperience),
    positioning,
  };
  const headline = [parts.qualification, parts.skill, parts.years, parts.positioning].filter(Boolean).join(render?.headlineSeparator ?? HEADLINE_SEP);
  return { headline, parts };
}
