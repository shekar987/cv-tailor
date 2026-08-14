// Projects have no structured date field (unlike Education's `dates`) — a
// project's name is free text, and some users write a trailing date into it
// directly (e.g. "CV Tailor — Full-Stack LLM Application | 2026"). This
// splits that trailing date OFF the display title so it can be right-aligned
// the same way Experience/Education dates are, without touching the stored
// name, the profile schema, the extraction prompt, or the Customize UI —
// display-only parsing, called fresh by each renderer.
//
// Recognizes a trailing " | 2026", "— 2025", "- Jan 2025 – Jan 2027", or
// "| 2024 – Present" style suffix. Titles with no such suffix are returned
// unchanged with an empty date, so a project with no embedded date renders
// exactly as it always has.

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+";
const YEAR_PIECE = `(?:${MONTH})?(?:19|20)\\d{2}`;
const TRAILING_DATE = new RegExp(
  `\\s*[|\\u2014-]\\s*(${YEAR_PIECE}(?:\\s*[\\u2013\\u2014-]\\s*(?:${YEAR_PIECE}|present))?)\\s*$`,
  "i"
);

export function splitTrailingDate(name: string): { title: string; date: string } {
  const source = name || "";
  const match = source.match(TRAILING_DATE);
  if (!match) return { title: source, date: "" };
  return {
    title: source.slice(0, match.index).trim(),
    date: match[1].trim(),
  };
}
