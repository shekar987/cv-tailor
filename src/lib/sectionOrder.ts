// Per-user CV section ordering.
//
// One shared resolver so the preview, the .docx and the PDF can never disagree
// about section order. All three call resolveSectionOrder() and iterate its
// result — there is no second copy of this logic to drift.
//
// SAFETY CONTRACT (the whole point of this module):
//   - null / undefined / malformed input  -> the exact DEFAULT_SECTION_ORDER
//   - unknown ids in a saved order        -> ignored
//   - sections missing from a saved order -> appended in default order
//   - duplicates                          -> de-duplicated, first wins
// So a section can never be dropped or rendered twice, whatever is in the DB.
// A user who never opens Customize has section_order = null and gets output
// byte-identical to before this feature existed.

export type SectionId = "summary" | "skills" | "experience" | "projects" | "education";

// The order the app hardcoded before this feature. Changing this changes the
// default for every user who has not customised — keep it in sync with the
// render order in CvPreview.tsx and api/download/route.ts.
export const DEFAULT_SECTION_ORDER: SectionId[] = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
];

// Sections that are NOT reorderable and are deliberately excluded here:
// the contact header (always first), and certifications / right-to-work /
// pass-through extras (always after the reorderable block, in that order).
// Only the five above are user-facing in Customize.

export const SECTION_LABELS: Record<SectionId, string> = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
};

function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && (DEFAULT_SECTION_ORDER as string[]).includes(value);
}

/**
 * Turn whatever is stored in profiles.section_order into a complete, ordered,
 * duplicate-free list of the five sections. Never throws.
 */
export function resolveSectionOrder(stored: unknown): SectionId[] {
  if (!Array.isArray(stored)) return [...DEFAULT_SECTION_ORDER];

  const seen = new Set<SectionId>();
  const ordered: SectionId[] = [];
  for (const entry of stored) {
    if (isSectionId(entry) && !seen.has(entry)) {
      seen.add(entry);
      ordered.push(entry);
    }
  }

  // Nothing usable in the stored value — treat it as unset rather than
  // rendering an empty CV.
  if (ordered.length === 0) return [...DEFAULT_SECTION_ORDER];

  // Append anything the saved order didn't mention, in default order. This is
  // what makes the feature forward-compatible: if a new section is added to
  // DEFAULT_SECTION_ORDER later, users with an older saved order still get it
  // rather than silently losing that section from their CV.
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!seen.has(id)) ordered.push(id);
  }

  return ordered;
}

/**
 * Validate a client-submitted order before persisting it. Stricter than the
 * read path: we only store something we would have produced ourselves, so bad
 * data never reaches the database in the first place.
 */
export function isValidSectionOrderPayload(value: unknown): value is SectionId[] {
  if (!Array.isArray(value)) return false;
  if (value.length !== DEFAULT_SECTION_ORDER.length) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isSectionId(entry) || seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/** True when the given order is the default — used to store null instead. */
export function isDefaultOrder(order: SectionId[]): boolean {
  return (
    order.length === DEFAULT_SECTION_ORDER.length &&
    order.every((id, i) => id === DEFAULT_SECTION_ORDER[i])
  );
}
