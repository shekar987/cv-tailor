// The header line under the candidate's name, built deterministically per run
// in the UKJI shape a recruiter scans in two seconds:
//
//   MSc Computer Science (in progress, expected 2026) · React · 2 years' experience · Software Engineer
//
// Every piece comes from something the user stated, or is omitted:
// - qualification: the profile's first education entry, with its status read
//   off the entry's own dates/note ("Present", "expected", a completion year)
// - skill: the first of the posting's required skills, then its keywords,
//   that the claims registry holds at PRODUCTION level — a project-level or
//   learning skill never headlines
// - years: the user's own eligibility answer, never inferred from dates
// - title: the posting's title, literally, as the search term it is
//
// Imports only ./atsMatch.ts (the same matcher that scores the CV), so it
// runs under node:test.
import { matchAtsKeywords } from "./atsMatch.ts";

export type HeadlineEducation = { degree?: string; dates?: string; note?: string };
export type HeadlineClaims = { skills: { name: string; level: string }[] } | null | undefined;

export type HeadlineInput = {
  education: HeadlineEducation[] | undefined;
  claims: HeadlineClaims;
  requiredSkills: unknown;
  keywords: unknown;
  yearsExperience: number | null | undefined;
  roleTitle: unknown;
};

export type HeadlineParts = { qualification: string; skill: string; years: string; title: string };

export const HEADLINE_SEP = " · ";
const MAX_TITLE = 70;
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

// The first posting term that names a production-level registry skill; the
// registry's own spelling is used. null when there is no registry or no match.
export function topProductionSkill(claims: HeadlineClaims, requiredSkills: unknown, keywords: unknown): string | null {
  const production = (claims?.skills ?? []).filter((s) => s.level === "production" && s.name.trim());
  if (production.length === 0) return null;
  for (const term of [...termList(requiredSkills), ...termList(keywords)]) {
    const hit = production.find((s) => matchAtsKeywords(s.name, [term]).matched > 0);
    if (hit) return hit.name.trim();
  }
  return null;
}

export function yearsLabel(years: number | null | undefined): string {
  if (typeof years !== "number" || !Number.isFinite(years) || years < 0) return "";
  const n = Math.round(years);
  if (n === 0) return "";
  return `${n} year${n === 1 ? "" : "s"}' experience`;
}

export function buildHeadline(input: HeadlineInput): { headline: string; parts: HeadlineParts } {
  const parts: HeadlineParts = {
    qualification: qualificationLabel(input.education?.[0]),
    skill: topProductionSkill(input.claims, input.requiredSkills, input.keywords) ?? "",
    years: yearsLabel(input.yearsExperience),
    title: typeof input.roleTitle === "string" ? input.roleTitle.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE) : "",
  };
  const headline = [parts.qualification, parts.skill, parts.years, parts.title].filter(Boolean).join(HEADLINE_SEP);
  return { headline, parts };
}
