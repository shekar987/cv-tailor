// Free-text search over the application tracker: company, role and the date
// applied. One matcher for the page and the CSV export, so the file always
// holds exactly the rows on screen.
//
// Import-free (tests/ runs it under node:test with no `@/` alias). The date
// spellings mirror the page's formatDate() ("18 Sep 2026") so whatever the
// user reads in the sheet, they can type.

export const MAX_SEARCH_CHARS = 100;

const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTHS_LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Lowercase, accents stripped (Zürich → zurich), whitespace collapsed.
export function foldText(s: unknown): string {
  return (typeof s === "string" ? s : "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// The spellings of one YYYY-MM-DD date a user might type. Invalid → [].
export function dateForms(iso: unknown): string[] {
  if (typeof iso !== "string") return [];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return [];
  const [, y, mm, dd] = m;
  const month = Number(mm);
  if (month < 1 || month > 12) return [];
  const d = String(Number(dd));
  const short = MONTHS_SHORT[month - 1];
  const long = MONTHS_LONG[month - 1];
  return [
    `${y}-${mm}-${dd}`,
    `${d} ${short} ${y}`,
    `${d} ${long} ${y}`,
    `${dd}/${mm}/${y}`,
    `${dd}-${mm}-${y}`,
    `${short} ${y}`,
    `${long} ${y}`,
  ];
}

export type SearchableRow = { company_name?: unknown; role?: unknown; date_applied?: unknown };

// Every whitespace-separated token of the query must occur somewhere in the
// row's company, role or date spellings. An empty query matches every row.
export function matchesSearch(row: SearchableRow, query: unknown): boolean {
  const q = foldText(typeof query === "string" ? query.slice(0, MAX_SEARCH_CHARS) : "");
  if (!q) return true;
  const haystack = [foldText(row.company_name), foldText(row.role), ...dateForms(row.date_applied)].join(" ");
  return q.split(" ").every((token) => haystack.includes(token));
}
