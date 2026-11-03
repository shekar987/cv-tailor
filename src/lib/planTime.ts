// Dates and times for the "What's next" plan (3 Nov 2026). Import-free so
// node:test can run it (tests/planTime). Every instant is a UTC millisecond
// count; a "day key" is YYYY-MM-DD in a named time zone. All zone arithmetic goes
// through Intl, so the BST/GMT change is the runtime's, not a table of ours.

export const DEFAULT_TIMEZONE = "Europe/London";
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(ms: number, tz: string): Parts {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(ms)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out as unknown as Parts;
}

// How far a zone's wall clock is ahead of UTC at an instant.
function offsetAt(ms: number, tz: string): number {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function isClockTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = TIME_RE.exec(value);
  return !!m && +m[1] < 24 && +m[2] < 60;
}

/**
 * The instant a wall-clock date and time mean in a zone. A time the clocks skip
 * in spring moves forward past the gap; one they repeat in autumn is the first,
 * so a 01:30 on the October change is the BST 01:30.
 */
export function zonedTimeToMs(date: string, time: string, tz: string): number {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return NaN;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const offsets = new Set([offsetAt(wall - DAY_MS, tz), offsetAt(wall + DAY_MS, tz)]);
  const matches = [...offsets].map((o) => wall - o).filter((ms) => wall - offsetAt(ms, tz) === ms);
  if (matches.length) return Math.min(...matches);
  return wall - offsetAt(wall - DAY_MS, tz);
}

export function dayKey(ms: number, tz: string): string {
  const p = partsIn(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function clockTime(ms: number, tz: string): string {
  const p = partsIn(ms, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
  const m = DATE_RE.exec(key);
  if (!m) return key;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days)).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(key: string): number {
  const m = DATE_RE.exec(key);
  if (!m) return 1;
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(key: string): string {
  return addDays(key, 1 - weekdayOf(key));
}

/** The whole calendar days from one key to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Wed 4 Nov". */
export function shortDay(key: string): string {
  const m = DATE_RE.exec(key);
  if (!m) return key;
  return `${WEEKDAYS_SHORT[weekdayOf(key) - 1]} ${+m[3]} ${MONTHS_SHORT[+m[2] - 1]}`;
}

/** "Wednesday 4 November". */
export function longDay(key: string): string {
  const m = DATE_RE.exec(key);
  if (!m) return key;
  return `${WEEKDAYS_LONG[weekdayOf(key) - 1]} ${+m[3]} ${MONTHS_LONG[+m[2] - 1]}`;
}

export function monthName(key: string): string {
  const m = DATE_RE.exec(key);
  return m ? `${MONTHS_LONG[+m[2] - 1]} ${m[1]}` : key;
}

/** "Wed 4 Nov, 10:10", or "Tue 10 Nov" for a deadline with no stated time. */
export function formatWhen(ms: number, tz: string, dateOnly = false): string {
  const day = shortDay(dayKey(ms, tz));
  return dateOnly ? day : `${day}, ${clockTime(ms, tz)}`;
}

/** "45m", "3h 20m", "2 days". */
export function span(diffMs: number): string {
  const minutes = Math.round(diffMs / MINUTE_MS);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * "in 3h 20m", "due in 2 days", "2h overdue". A deadline with no stated time
 * counts in days, because its hours would be made up.
 */
export function countdown(ms: number, now: number, opts: { due?: boolean; dateOnly?: boolean; tz?: string } = {}): string {
  const tz = opts.tz ?? DEFAULT_TIMEZONE;
  if (opts.dateOnly) {
    const days = daysBetween(dayKey(now, tz), dayKey(ms, tz));
    if (days < 0) return days === -1 ? "1 day overdue" : `${-days} days overdue`;
    if (days === 0) return "due today";
    if (days === 1) return "due tomorrow";
    return `due in ${days} days`;
  }
  const diff = ms - now;
  if (diff < 0) return `${span(-diff)} overdue`;
  // Past a day, count the days on the calendar, so "Tomorrow" never says "in 2 days".
  if (diff >= DAY_MS) {
    const days = daysBetween(dayKey(now, tz), dayKey(ms, tz));
    return `${opts.due ? "due in" : "in"} ${days === 1 ? "1 day" : `${days} days`}`;
  }
  return `${opts.due ? "due in" : "in"} ${span(diff)}`;
}
