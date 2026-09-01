// Titles that belong to the CV's own structured sections. The pass-through
// `extraSections` list (RECOGNITIONS, AWARDS, etc.) must never reproduce one of
// these: if the profile extractor mis-files e.g. "EXPERIENCE" into extraSections,
// it renders a duplicate section at the END of the document (after Right to Work).
// Filtering here fixes already-saved profiles without needing re-extraction, on
// both the preview and the .docx render paths.

const RESERVED_SECTION_TITLES = new Set([
  "summary", "professional summary", "profile", "objective", "about", "about me",
  "skills", "technical skills", "core competencies", "competencies", "technical tools",
  "experience", "work experience", "professional experience", "employment",
  "employment history", "work history", "career history",
  "projects", "personal projects", "project", "portfolio",
  "education", "academic background", "academics", "qualifications",
  "certifications", "certificates", "certification",
  "right to work", "work authorization", "work authorisation", "visa", "visa status",
]);

export function isReservedSectionTitle(title: string): boolean {
  return RESERVED_SECTION_TITLES.has((title || "").trim().toLowerCase());
}

// A model sometimes echoes a bare section heading ("SKILLS", "EDUCATION")
// inside a section's own text; every renderer drops such lines. ONE regex so
// the three renderers can't drift — the preview used to filter more titles
// than the two document builders did, which let an echoed "CERTIFICATIONS"
// line show up in the downloads but not on screen.
export const SECTION_HEADING_LINE_RE =
  /^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE|EDUCATION|CERTIFICATIONS)\s*:?\s*$/i;

export type ExtraSectionLike = { title?: string; bullets?: string[] };
export type ExtraSection = { title: string; bullets: string[] };

// Keep only well-formed extra sections that don't collide with a reserved title.
// Returns a narrowed type: title/bullets are guaranteed present by the predicate.
export function filterExtraSections(list: ExtraSectionLike[] | undefined | null): ExtraSection[] {
  return (list || []).filter(
    (s): s is ExtraSection =>
      !!s?.title && Array.isArray(s.bullets) && s.bullets.length > 0 && !isReservedSectionTitle(s.title)
  );
}
