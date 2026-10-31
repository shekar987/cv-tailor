// The header line under the candidate's name, built deterministically per run
// from a whitelist of three slots — nothing else can reach it:
//
//   Software Engineer · 2 years' experience · Python, FastAPI, React
//
// - role: the posting's core title ONLY when it plainly describes the
//   candidate (lib/roleTitle titleAsIdentity — the route decides and passes
//   `identityTitle`); otherwise the candidate's own role, the first found in
//   the positioning variant's headline, the saved tagline, then their most
//   recent job title on the master CV. Never the posting's full title: until
//   30 Sep 2026 it printed "Python Developer - Data & Analytics Team - Options
//   Market Making" under a name as if it were the candidate's identity. A
//   candidate role must name a role noun; a bracket that lists tools goes (the
//   stack has its own slot) and a repeated bracket is said once
// - years: the user's own eligibility answer, "N years' experience", never
//   inferred from dates and never "production" (the answer does not say so)
// - stack: ONE phrase of up to TAGLINE_STACK_ITEMS posting terms the claims
//   registry holds at PRODUCTION level, in posting order, registry spelling,
//   none the role already names — a project-level or learning skill never
//   headlines
//
// The line is one printed line: past MAX_TAGLINE_CHARS the stack gives up its
// last items, then the years (tests/taglineSnapshot builds the real PDF and
// checks the row). Until 24 Oct (Chunk 2) UKJI led with the degree and
// CareerSet carried up to five tools beside a variant headline that already
// listed them in brackets ("Full stack engineer (Python, FastAPI, React,
// TypeScript) | … | Python · FastAPI · React · TypeScript"); the degree now
// lives in Education, and a skills group label ("Languages & Frameworks:")
// can never print (lib/profile cleanTagline, the renderers' last guard too).
//
// Imports only its import-free siblings (relative .ts paths), so it runs
// under node:test.
import { matchAtsKeywords } from "./atsMatch.ts";
import { ROLE_NOUN_RE } from "./roleTitle.ts";
import { cleanTagline, dedupeParentheticals, stripSkillGroupLabels } from "./profile.ts";
import type { RenderOptions } from "./formatStyles/ids.ts";
import { isLanguageName } from "./summaryFallback.ts";

export type HeadlineEducation = { degree?: string; dates?: string; note?: string };
export type HeadlineClaims = { skills: { name: string; level: string }[] } | null | undefined;

export type HeadlineInput = {
  claims: HeadlineClaims;
  requiredSkills: unknown;
  keywords: unknown;
  yearsExperience: number | null | undefined;
  // The posting's core title, passed only when it plainly describes the
  // candidate (lib/roleTitle titleAsIdentity); null otherwise.
  identityTitle?: string | null;
  // The picked positioning variant's headline (lib/variants), the user's words.
  positioning?: string | null;
  // The tagline saved on Customize (the extracted one, as edited).
  savedTagline?: string | null;
  // The master CV's job titles, most recent first (lib/bulletIds headers).
  heldTitles?: string[];
  // CareerSet (31 Oct, Chunk 6): the master CV's top three production
  // languages (lib/summaryFallback topLanguages). The stack's first
  // technology must be one of them: a language outside the CV's list leaves
  // the stack (Burendo's "Java"), a listed one moves to the front, else the
  // first is added — never one the registry holds below production level.
  // Absent → the posting's order alone (UKJI).
  leadLanguages?: string[];
};

export type HeadlineParts = { role: string; years: string; stack: string };

export const HEADLINE_SEP = " · ";
export const TAGLINE_STACK_ITEMS = 3;
// One printed line at the header's 10 pt across the narrowest text column
// (lib/cvDensity's roomiest margins), with room to spare.
export const MAX_TAGLINE_CHARS = 90;
const MAX_ROLE = 60;

const IN_PROGRESS_RE = /\b(?:present|current(?:ly)?|expected|ongoing|in progress|anticipated|due)\b/i;

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

function termList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
}

// The first `max` posting terms that name a production-level registry
// skill, in posting order, each registry name once; the registry's own
// spelling is used. Empty when there is no registry or no match. A registry
// name that is a label ("Languages & Frameworks:") is never a skill.
export function topProductionSkills(claims: HeadlineClaims, requiredSkills: unknown, keywords: unknown, max = 1): string[] {
  const production = (claims?.skills ?? []).filter((s) => s.level === "production" && s.name.trim() && !s.name.includes(":"));
  if (production.length === 0) return [];
  const out: string[] = [];
  for (const term of [...termList(requiredSkills), ...termList(keywords)]) {
    if (out.length >= max) break;
    const hit = production.find((s) => matchAtsKeywords(s.name, [term]).matched > 0);
    if (hit && !out.includes(hit.name.trim())) out.push(hit.name.trim());
  }
  return out;
}

export function yearsLabel(years: number | null | undefined): string {
  if (typeof years !== "number" || !Number.isFinite(years) || years < 0) return "";
  const n = Math.round(years);
  if (n === 0) return "";
  return `${n} year${n === 1 ? "" : "s"}' experience`;
}

// A bracket kept on a role is a short qualifier ("Product Engineer (Full
// Stack)"): no list, no figure, three words at most. Anything else — a tool
// list, "(2027 intake)" — goes; the stack slot says the tools.
function keepsBracket(inner: string): boolean {
  const s = inner.trim();
  return !!s && !/[,;/·&+]|\d/.test(s) && s.split(/\s+/).length <= 3;
}

// The role in a free-text line (a variant headline, a saved tagline, a job
// title): the first segment that names a role noun once its labels and
// tool brackets are gone, at most one short bracket kept. "" when none.
export function rolePhrase(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const segments = stripSkillGroupLabels(raw)
    .split(/\s*[|·•;]\s*|\s+[/—–-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    let kept = 0;
    let role = dedupeParentheticals(seg).replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => (keepsBracket(inner) && kept++ === 0 ? whole : ""));
    // An unmatched bracket left by a nested or cut-off aside goes; a kept pair stays.
    if ((role.match(/\(/g) ?? []).length !== (role.match(/\)/g) ?? []).length) role = role.replace(/[()]/g, " ");
    role = role.replace(/\s+/g, " ").trim();
    if (!role || !ROLE_NOUN_RE.test(role) || role.split(/\s+/).length > 8) continue;
    if (role.length <= MAX_ROLE) return role;
    const cut = role.slice(0, MAX_ROLE);
    return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : MAX_ROLE).trim();
  }
  return "";
}

// A saved tagline held to one printed line: whole segments while they fit
// MAX_TAGLINE_CHARS, else the first segment cut at a word.
export function capTagline(tagline: string): string {
  const t = tagline.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_TAGLINE_CHARS) return t;
  // The outermost separator only ("Role | Python · FastAPI | …" splits at the
  // pipes), so a segment keeps its own inner separators.
  const sep = [" | ", " · ", " • "].find((s) => t.includes(s))?.trim() ?? "|";
  const segments = t.split(` ${sep} `);
  let out = "";
  for (const s of segments) {
    const next = out ? `${out} ${sep} ${s}` : s;
    if (next.length > MAX_TAGLINE_CHARS) break;
    out = next;
  }
  if (out) return out;
  const cut = t.slice(0, MAX_TAGLINE_CHARS);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : MAX_TAGLINE_CHARS).trim();
}

// The CareerSet header's language check (31 Oct, Chunk 6): the header's first
// technology must be one of the master CV's top three languages
// (lib/summaryFallback topLanguages). buildHeadline's `leadLanguages` makes it
// so whenever the CV lists one; only a header still leading with something
// else — the CV lists no production language at all — falls back to the
// master tagline (cleaned by lib/profile cleanTagline as every renderer
// would, and held to one line). The 30 Oct Burendo header was "Java, CI/CD &
// Cloud Deployment, AWS" for a master CV that leads with Python. A header
// with no technology, or no master tagline to fall back to, stays as built.
export function guardTaglineLanguage(
  built: { headline: string; parts: HeadlineParts },
  topLanguages: string[],
  masterTagline: string | null | undefined
): { headline: string; replaced: { from: string; firstTechnology: string } | null } {
  const first = built.parts.stack.split(/\s*,\s*/)[0]?.trim() ?? "";
  if (!first) return { headline: built.headline, replaced: null };
  if (topLanguages.some((l) => l.trim().toLowerCase() === first.toLowerCase())) return { headline: built.headline, replaced: null };
  const fallback = capTagline(cleanTagline(typeof masterTagline === "string" ? masterTagline : ""));
  if (!fallback) return { headline: built.headline, replaced: null };
  return { headline: fallback, replaced: { from: built.headline, firstTechnology: first } };
}

// `render` (lib/formatStyles RenderOptions) gives only the separator: UKJI
// " · ", CareerSet " | " — the same three slots in both. A slot with nothing
// is left out, never a dangling separator.
export function buildHeadline(input: HeadlineInput, render?: Pick<RenderOptions, "headlineSeparator">): { headline: string; parts: HeadlineParts } {
  const sep = render?.headlineSeparator ?? HEADLINE_SEP;
  const role =
    [input.identityTitle, input.positioning, input.savedTagline, ...(input.heldTitles ?? [])]
      .map(rolePhrase)
      .find(Boolean) ?? "";
  const years = yearsLabel(input.yearsExperience);
  const roleWords = role.toLowerCase();
  const inRole = (name: string) => roleWords.includes(name.toLowerCase()) || matchAtsKeywords(role, [name]).matched > 0;
  let stackItems = topProductionSkills(input.claims, input.requiredSkills, input.keywords, TAGLINE_STACK_ITEMS + 4).filter((name) => !inRole(name));
  if (input.leadLanguages) {
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const belowProduction = (lang: string) => (input.claims?.skills ?? []).some((s) => same(s.name, lang) && s.level !== "production");
    const leads = input.leadLanguages.filter((l) => !belowProduction(l) && !inRole(l));
    // A language the CV does not list (at production level) never headlines.
    stackItems = stackItems.filter((n) => !isLanguageName(n) || leads.some((l) => same(l, n)));
    const present = stackItems.find((n) => leads.some((l) => same(l, n)));
    const lead = present ?? leads[0];
    if (lead) stackItems = [lead, ...stackItems.filter((n) => !same(n, lead))];
  }
  stackItems = stackItems.slice(0, TAGLINE_STACK_ITEMS);

  const line = (items: string[], withYears: boolean) =>
    cleanTagline([role, withYears ? years : "", items.join(", ")].filter(Boolean).join(sep));
  let items = stackItems;
  let withYears = true;
  while (line(items, withYears).length > MAX_TAGLINE_CHARS && items.length > 0) items = items.slice(0, -1);
  if (line(items, withYears).length > MAX_TAGLINE_CHARS) withYears = false;

  const parts: HeadlineParts = { role, years: withYears ? years : "", stack: items.join(", ") };
  return { headline: line(items, withYears), parts };
}
