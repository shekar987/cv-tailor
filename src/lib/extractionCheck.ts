// Did profile extraction drop anything? (Brief 3, Bug C.) The audited
// account's CV listed four projects; extraction returned two and nothing
// said so. This reads the raw CV deterministically - section headings, then
// entry-shaped lines under them - and compares the counts with what the
// model extracted. A shortfall is flagged for the user to confirm or fix;
// nothing is auto-corrected. Heuristic by nature (CV layouts vary), so every
// unrecognised layout answers null ("couldn't tell") rather than a number.
// Import-free, unit-tested.

export type SectionKey = "projects" | "education" | "certifications";
export type ExpectedCounts = Record<SectionKey, number | null>;
export type ExtractionFlag = { section: SectionKey; label: string; expected: number; got: number };

const HEADINGS: Record<SectionKey, RegExp> = {
  projects: /^(?:personal\s+|side\s+|selected\s+|key\s+|technical\s+)?projects?(?:\s*(?:and|&)\s*portfolio)?|portfolio$/i,
  education: /^education(?:\s*(?:and|&)\s*(?:qualifications|training))?|academic\s+(?:background|history)|qualifications$/i,
  certifications: /^certifications?(?:\s*(?:and|&)\s*(?:training|courses|licen[cs]es))?|certificates|licen[cs]es\s*(?:and|&)\s*certifications?$/i,
};
// A heading ends the current section. ALL CAPS lines always are; a Title
// Case line only when it names a section a CV actually has - otherwise a
// project called "Portfolio Site" or a degree line would end the section.
const ALL_CAPS_RE = /^[A-Z][A-Z\s&/,()-]{2,50}:?\s*$/;
const TITLE_CASE_RE = /^[A-Z][A-Za-z]+(?:\s+(?:[A-Z&][A-Za-z]*|and|of|&))*:?\s*$/;
const OTHER_SECTION_RE =
  /^(?:(?:professional\s+|work\s+)?(?:summary|profile|experience|employment|history)|about(?:\s+me)?|objective|(?:technical\s+|core\s+|key\s+)?(?:skills|competencies|tools)|employment\s+history|work\s+history|career\s+history|interests|hobbies|languages|references|awards|recognitions?|publications|volunteering|volunteer\s+work|right\s+to\s+work|work\s+authori[sz]ation|visa(?:\s+status)?|training|courses|achievements|activities|leadership|summary\s+of\s+qualifications|extracurricular(?:\s+activities)?)$/i;
const BULLET_RE = /^[-•*▪●◦]\s+/;
const META_LINE_RE = /^(?:tech(?:nologies|\s*stack)?|stack|tools|built\s+with|links?|live|code|demo|repo|github|url|website)\s*:/i;
const URL_RE = /^(?:https?:\/\/|www\.)/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const DEGREE_RE = /\b(?:b\.?sc|m\.?sc|b\.?a|m\.?a|b\.?eng|m\.?eng|mba|phd|ph\.d|bachelor|master|diploma|degree|a[- ]levels?|gcse|btec|hnd|hnc|foundation)\b/i;

function headingKey(line: string): SectionKey | "other" | null {
  const t = line.trim();
  if (!t || t.length > 60 || BULLET_RE.test(t) || /[.!?]$/.test(t)) return null;
  const allCaps = ALL_CAPS_RE.test(t) && /[A-Z]{3}/.test(t);
  const titleCase = TITLE_CASE_RE.test(t);
  if (!allCaps && !titleCase) return null;
  const h = t.replace(/:$/, "").trim();
  for (const key of ["projects", "education", "certifications"] as SectionKey[]) {
    if (HEADINGS[key].test(h)) return key;
  }
  if (allCaps || OTHER_SECTION_RE.test(h)) return "other";
  return null; // a Title Case content line (a project name, a degree)
}

function sectionLines(cvText: string): Record<SectionKey, string[] | null> {
  const out: Record<SectionKey, string[] | null> = { projects: null, education: null, certifications: null };
  let current: SectionKey | null = null;
  for (const raw of (cvText || "").split(/\r?\n/)) {
    const key = headingKey(raw);
    if (key !== null) {
      current = key === "other" ? null : key;
      if (current && out[current] === null) out[current] = [];
      continue;
    }
    if (current) out[current]!.push(raw.trim());
  }
  return out;
}

// Entry-shaped lines: for projects, a non-bullet title line that is not a
// tech/links/URL line and starts with a capital or a digit; for education,
// a non-bullet line with a degree word or a year; for certifications, every
// non-empty line (one per certificate is how CVs write them).
function countEntries(key: SectionKey, lines: string[]): number {
  let n = 0;
  for (const line of lines) {
    if (!line) continue;
    const isBullet = BULLET_RE.test(line);
    if (key === "certifications") {
      n++;
      continue;
    }
    if (isBullet || META_LINE_RE.test(line) || URL_RE.test(line)) continue;
    if (key === "projects") {
      if (/^[A-Z0-9]/.test(line) && line.length <= 120) n++;
    } else if (key === "education") {
      if (DEGREE_RE.test(line) || YEAR_RE.test(line)) n++;
    }
  }
  return n;
}

export function expectedCounts(cvText: string): ExpectedCounts {
  const sections = sectionLines(cvText);
  const out: ExpectedCounts = { projects: null, education: null, certifications: null };
  for (const key of ["projects", "education", "certifications"] as SectionKey[]) {
    const lines = sections[key];
    if (!lines) continue;
    const n = countEntries(key, lines);
    // Education lines often pair a degree line with a dates line; a year-only
    // line under a degree line is the same entry.
    if (key === "education") {
      let entries = 0;
      let lastWasDegree = false;
      for (const line of lines) {
        if (!line || BULLET_RE.test(line)) { lastWasDegree = false; continue; }
        const degree = DEGREE_RE.test(line);
        const year = YEAR_RE.test(line);
        if (degree) { entries++; lastWasDegree = true; }
        else if (year && !lastWasDegree) { entries++; lastWasDegree = false; }
        else if (year && lastWasDegree) { lastWasDegree = false; }
      }
      out[key] = entries;
    } else {
      out[key] = n;
    }
  }
  return out;
}

const LABEL: Record<SectionKey, string> = { projects: "Projects", education: "Education", certifications: "Certifications" };

// Flags where the CV seems to list more entries than extraction returned.
// One-off differences in projects and education are reported too (that is
// exactly the audited failure: 4 listed, 2 extracted); certifications get a
// one-entry tolerance because a wrapped line reads as two.
export function extractionFlags(cvText: string, got: { projects: number; education: number; certifications: number }): ExtractionFlag[] {
  const expected = expectedCounts(cvText);
  const flags: ExtractionFlag[] = [];
  for (const key of ["projects", "education", "certifications"] as SectionKey[]) {
    const e = expected[key];
    if (e === null || e === 0) continue;
    const tolerance = key === "certifications" ? 1 : 0;
    if (got[key] + tolerance < e) flags.push({ section: key, label: LABEL[key], expected: e, got: got[key] });
  }
  return flags;
}

// Re-running extraction must not wipe what the user typed into the eight
// editable fields: the current non-empty value wins over the fresh read.
export function mergeProfileEdits<T extends Record<string, unknown>>(current: T | null, fresh: T): T {
  if (!current) return fresh;
  const keep = ["name", "tagline", "location", "phone", "email", "linkedin", "github", "website"] as const;
  const out: Record<string, unknown> = { ...fresh };
  for (const k of keep) {
    const cur = current[k];
    if (typeof cur === "string" && cur.trim()) out[k] = cur;
  }
  return out as T;
}
