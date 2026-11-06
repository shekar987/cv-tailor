// One date style on every screen (6 Nov 2026, Chunk 19): "6 Nov 2026".
//
// The browser's own formatting is what made three styles: a bare
// toLocaleDateString() follows the viewer's locale ("06/11/2026"), and en-GB's
// short month prints "Sept" in current ICU ("30 Sept 2026"). So the month names
// are fixed here, and every screen that prints a date calls formatDate.
//
// A plain YYYY-MM-DD (date_applied, followup_date) is printed as written, never
// through a Date, so the day cannot shift with the viewer's timezone. A
// timestamp is the day it was in `timeZone` (London unless the caller says).
//
// Import-free, so it runs under node:test and in client components alike.

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const DATE_ZONE = "Europe/London";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

type DateParts = { year: number; month: number; day: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, timeZone: string): DateParts | null {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
    } catch {
      f = new Intl.DateTimeFormat("en-GB", { timeZone: DATE_ZONE, year: "numeric", month: "numeric", day: "numeric" });
    }
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const year = Number(p.year), month = Number(p.month), day = Number(p.day);
  return Number.isFinite(year) && month >= 1 && month <= 12 && day >= 1 ? { year, month, day } : null;
}

function partsOf(value: string | number | Date, timeZone: string): DateParts | null {
  if (typeof value === "string") {
    const m = DATE_ONLY_RE.exec(value.trim());
    if (m) {
      const month = Number(m[2]), day = Number(m[3]);
      return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year: Number(m[1]), month, day } : null;
    }
  }
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? partsIn(ms, timeZone) : null;
}

/**
 * "6 Nov 2026" — or "6 Nov" with `{ year: false }`. A value it cannot read
 * prints as "" (never "Invalid Date").
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  opts: { timeZone?: string; year?: boolean } = {}
): string {
  if (value === null || value === undefined || value === "") return "";
  const p = partsOf(value, opts.timeZone ?? DATE_ZONE);
  if (!p) return "";
  const dayMonth = `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
  return opts.year === false ? dayMonth : `${dayMonth} ${p.year}`;
}
