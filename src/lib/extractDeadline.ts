// Reads a deadline out of an email's text (4 Nov 2026, Chunk 12). Pure and
// deterministic: no model call, and the Action Centre's quick add shows the result
// for editing before anything is saved. Imports only ./planTime.ts, so node:test can
// run it (tests/extractDeadline).
//
// The rules that matter:
//   - It never guesses: no phrase it can read means null, not a date.
//   - A stated date needs a word saying it is a deadline ("by", "due", "closes") or a
//     clock time ("on Thu 5 Nov at 08:30"), so "Posted 3 November" is never a deadline.
//   - A window ("within 48 hours") counts only for something the candidate does, or
//     when the words stand alone: "you will have 25 days holiday" and "you will receive
//     feedback within 5 working days" are not deadlines, nor is the employer's own
//     promise, nor a window that starts when the candidate starts.
//   - The earliest deadline wins, a stated date and a window alike: an email saying
//     "complete the test within 72 hours; applications close on 30 November" means the
//     72 hours. A date with only a clock time counts only when nothing else does.
//   - A time with no zone is London time. A date with no time is the end of that day
//     in London, with dateOnly set, so the app never prints a time nobody gave.
//   - A zone people use loosely (CET in summer, GMT during BST) takes the earlier of
//     its two readings and says it is approximate: a deadline read an hour early costs
//     nothing, one read an hour late can cost the job. IST is India's. A zone it does
//     not know reads as London and says it is approximate.
import { DEFAULT_TIMEZONE, HOUR_MS, addDays, clockTime, dayKey, daysBetween, isDayKey, weekdayOf, zonedTimeToMs } from "./planTime.ts";

export type DeadlineRead = {
  /** The instant, as an ISO string in UTC. */
  dueAt: string;
  /** A day with no stated time: dueAt is 23:59 that day in London. */
  dateOnly: boolean;
  /** Read with some doubt: "~", a loose or unknown zone, two readings of a date, a wrong weekday. */
  approximate: boolean;
  /** The words it was read from. */
  matched: string;
  /** The zone as written, upper case, or null. */
  zone: string | null;
};

const LONDON = DEFAULT_TIMEZONE;
const END_OF_DAY = "23:59";
// A date in the past by more than this is next year's ("by 3 Jan" read in December).
const YEAR_ROLLOVER_DAYS = 180;
// A window with no action beside it counts only when it is nearly all the clause says.
const BARE_WINDOW_MAX_WORDS = 6;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEKDAY = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
// Standing alone a weekday must be spelt out: "Sun Life" is a company.
const WEEKDAY_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// A literal zone, and the wall clock the same word often means in practice.
const ZONES: Record<string, { tz: string; loose?: string }> = {
  GMT: { tz: "Etc/GMT", loose: LONDON },
  UTC: { tz: "Etc/UTC" },
  BST: { tz: "Etc/GMT-1", loose: LONDON },
  "UK TIME": { tz: LONDON },
  "LONDON TIME": { tz: LONDON },
  IST: { tz: "Asia/Kolkata" },
  "INDIA STANDARD TIME": { tz: "Asia/Kolkata" },
  "INDIAN STANDARD TIME": { tz: "Asia/Kolkata" },
  CET: { tz: "Etc/GMT-1", loose: "Europe/Paris" },
  CEST: { tz: "Etc/GMT-2", loose: "Europe/Paris" },
  "CENTRAL EUROPEAN TIME": { tz: "Etc/GMT-1", loose: "Europe/Paris" },
  EST: { tz: "Etc/GMT+5", loose: "America/New_York" },
  EDT: { tz: "Etc/GMT+4", loose: "America/New_York" },
  ET: { tz: "America/New_York" },
  PST: { tz: "Etc/GMT+8", loose: "America/Los_Angeles" },
  PDT: { tz: "Etc/GMT+7", loose: "America/Los_Angeles" },
  PT: { tz: "America/Los_Angeles" },
  SGT: { tz: "Asia/Singapore" },
  HKT: { tz: "Asia/Hong_Kong" },
  JST: { tz: "Asia/Tokyo" },
  AEST: { tz: "Etc/GMT-10", loose: "Australia/Sydney" },
  AEDT: { tz: "Etc/GMT-11", loose: "Australia/Sydney" },
};
const ZONE_RE = /^\s*,?\s*\(?\s*((?:GMT|UTC)\s*[+-]\s*\d{1,2}(?::\d{2})?|GMT|UTC|BST|UK time|London time|IST|India(?:n)? Standard Time|CEST|CET|Central European Time|EST|EDT|ET|PST|PDT|PT|SGT|HKT|JST|AEST|AEDT)\b\s*\)?/i;
// Capitals right after a clock time that may be a zone it does not know.
const UNKNOWN_ZONE_RE = /^\s*,?\s*\(?\s*([A-Z]{2,5})\b\s*\)?/;
const NOT_A_ZONE: ReadonlySet<string> = new Set(["ON", "AT", "BY", "AND", "THE", "TO", "OR", "IN", "FOR", "OF", "AM", "PM", "UK"]);

const CUE_RE = /\b(?:by|before|until|till|no later than|due|deadline|closes?|closing|expires?|expiry|complete|submit|latest)\b/i;
const APPROX_RE = /(?:~|≈|\b(?:about|around|approx(?:imately)?|circa|roughly)\b)\s*$/i;
// The company's own promise about itself, read up to where the deadline would be, so
// "complete it by 6 Nov and we will review it" still counts.
const PROMISE_RE = /\b(?:we|our (?:team|recruiters?)|the (?:team|recruiter|hiring team)|someone|you(?:'ll| will) hear)\b[^.]*\b(?:respond|reply|get back|be in touch|contact you|review|come back|hear|update you|let you know|from us)\b/i;
const ASKS_THE_CANDIDATE_RE = /\bwe\s+(?:need|ask|require|would like|invite|request|encourage|expect)\b/i;
// The clock starts when they start, so the email's date says nothing.
const AFTER_START_RE = /\b(?:once|after|when|from when)\s+(?:you\s+)?(?:start|begin|open|have started|started|starting)|\bfrom\s+(?:the\s+)?(?:start|time you|chosen start|when you)\b/i;
// A window about something else: the employer's process, or the terms of a job.
const NOT_A_WINDOW_RE = /\b(?:hear|feedback|receive|reviewed?|notified|notify|contacted|informed|updated?|holidays?|leave|annual|allowance|per year|a year|training|onboarding|probation|notice|refund|invoice|salary|pay|payment|bonus|benefits?|expenses?|commute|office|on-?site|remote|appeal)\b|\bof (?:joining|starting|your start)\b/i;
// What a window is for, when it is one.
const CANDIDATE_ACTION_RE = /\b(?:complete[ds]?|completing|finish(?:ed)?|submit(?:ted)?|respond|reply|record|attempt|take|do|return|upload|accept|confirm|book|schedule|register|sit|expires?|closes?|due|valid|open|available|active|link|test|assessment|challenge)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, twenty: 20, thirty: 30,
};
const AMOUNT = "\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|twenty|thirty";
const UNIT = "hours?|hrs?|h|days?|weeks?|working days?|business days?";
const RELATIVE_RES = [
  new RegExp(`\\bwithin\\s+(?:the\\s+next\\s+)?(${AMOUNT})[\\s-]*(${UNIT})\\b`, "i"),
  new RegExp(`\\byou(?:\\s+will|'ll|\\s+now)?\\s+(?:have|get)\\s+(?:up\\s+to\\s+)?(${AMOUNT})[\\s-]*(${UNIT})\\b`, "i"),
  new RegExp(`\\byou've\\s+got\\s+(${AMOUNT})[\\s-]*(${UNIT})\\b`, "i"),
  new RegExp(`\\b(?:expires?|closes?|due|valid|open|available|active)\\s+(?:in|for)\\s+(?:the\\s+next\\s+)?(${AMOUNT})[\\s-]*(${UNIT})\\b`, "i"),
  new RegExp(`\\bin\\s+the\\s+next\\s+(${AMOUNT})[\\s-]*(${UNIT})\\b`, "i"),
  new RegExp(`\\b(${AMOUNT})[\\s-]*(${UNIT})\\s+to\\s+(?:complete|finish|submit|respond|reply|record)\\b`, "i"),
];
const FROM_DATE_RE = new RegExp(`\\b(${AMOUNT})[\\s-]*(${UNIT})\\s+from\\s+`, "i");

const pad = (n: number) => String(n).padStart(2, "0");

function toMs(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

function amountOf(raw: string): number {
  return /^\d/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw.toLowerCase()] ?? NaN);
}

// ── Dates ───────────────────────────────────────────────────────────────────

type DateHit = { start: number; end: number; key: string; approximate: boolean };

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

function weekdayIndex(word: string): number {
  return WEEKDAYS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
}

/** The day a date with no year means: this year, or next when it is long past. */
function resolveYear(month: number, day: number, year: number | null, receivedKey: string): string | null {
  const y = year ?? Number(receivedKey.slice(0, 4));
  const key = `${y}-${pad(month + 1)}-${pad(day)}`;
  if (!isDayKey(key)) return null;
  if (year === null && daysBetween(key, receivedKey) > YEAR_ROLLOVER_DAYS) return `${y + 1}-${pad(month + 1)}-${pad(day)}`;
  return key;
}

function checkWeekday(word: string | undefined, key: string): boolean {
  return !!word && weekdayIndex(word) !== weekdayOf(key);
}

/** Every stated date in a sentence, longest forms first; a later form never reads inside an earlier one. */
function findDates(sentence: string, receivedKey: string): DateHit[] {
  const hits: DateHit[] = [];
  const free = (start: number, end: number) => hits.every((h) => end <= h.start || start >= h.end);
  const scan = (re: RegExp, read: (m: RegExpExecArray) => { key: string | null; approximate?: boolean }) => {
    for (const m of sentence.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const { key, approximate } = read(m as RegExpExecArray);
      if (key) hits.push({ start, end, key, approximate: !!approximate });
    }
  };
  scan(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => ({ key: isDayKey(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null }));
  // The lookbehind keeps a clock time out of the day: "17:30 Nov 5" is not the 30th.
  scan(new RegExp(`\\b(?:(${WEEKDAY})[,\\s]+)?(?:the\\s+)?(?<![:.\\d])(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH})\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi"), (m) => {
    const key = resolveYear(monthIndex(m[3]), Number(m[2]), m[4] ? Number(m[4]) : null, receivedKey);
    return { key, approximate: !!key && checkWeekday(m[1], key) };
  });
  scan(new RegExp(`\\b(?:(${WEEKDAY})[,\\s]+)?(${MONTH})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi"), (m) => {
    const key = resolveYear(monthIndex(m[2]), Number(m[3]), m[4] ? Number(m[4]) : null, receivedKey);
    return { key, approximate: !!key && checkWeekday(m[1], key) };
  });
  scan(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    // UK order unless only the US one is a real date. Two real readings are flagged.
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    return { key: resolveYear(month - 1, day, year, receivedKey), approximate: a <= 12 && b <= 12 && a !== b };
  });
  scan(/\btomorrow\b/gi, () => ({ key: addDays(receivedKey, 1) }));
  scan(/\btoday\b/gi, () => ({ key: receivedKey }));
  scan(new RegExp(`\\b(next\\s+)?(${WEEKDAY_FULL})\\b(?!\\s*\\d)`, "gi"), (m) => {
    const wanted = weekdayIndex(m[2]);
    const ahead = (wanted - weekdayOf(receivedKey) + 7) % 7;
    return { key: addDays(receivedKey, ahead), approximate: !!m[1] };
  });
  return hits;
}

// ── Times ───────────────────────────────────────────────────────────────────

type TimeHit = { start: number; end: number; time: string | null; zone: string | null; approximate: boolean };
type TimeRead = { time: string | null; approximate?: boolean } | null;

const NOT_A_TIME_BEFORE = "(?<![\\d:.,£$€])";
const hhmm = (h: string, m: string): TimeRead => (Number(h) < 24 && Number(m) < 60 ? { time: `${pad(Number(h))}:${m}` } : null);

// Earlier in the list wins when two start at the same place.
const TIME_RES: { re: RegExp; read: (m: RegExpExecArray) => TimeRead }[] = [
  { re: /\b(?:by\s+)?(?:the\s+)?(?:end of (?:the )?day|eod)\b/i, read: () => ({ time: null }) },
  { re: /\bclose of business\b|\bcob\b/i, read: () => ({ time: "17:00", approximate: true }) },
  { re: /\bmidnight\b/i, read: () => ({ time: END_OF_DAY }) },
  { re: /\b(?:noon|midday)\b/i, read: () => ({ time: "12:00" }) },
  { re: new RegExp(`${NOT_A_TIME_BEFORE}(\\d{1,2})[:.](\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![a-z])`, "i"), read: (m) => to24(Number(m[1]), Number(m[2]), m[3]) },
  { re: new RegExp(`${NOT_A_TIME_BEFORE}(\\d{1,2})\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![a-z])`, "i"), read: (m) => to24(Number(m[1]), 0, m[2]) },
  {
    re: new RegExp(`${NOT_A_TIME_BEFORE}(\\d{1,2}):(\\d{2})(?:\\s*hrs?\\b|(?![\\d:]))`, "i"),
    read: (m) => (Number(m[1]) === 24 && Number(m[2]) === 0 ? { time: END_OF_DAY } : hhmm(m[1], m[2])),
  },
  // "17.00" is how UK emails write it. Never a price or a part of a longer number.
  { re: new RegExp(`${NOT_A_TIME_BEFORE}(\\d{1,2})\\.(\\d{2})(?:\\s*hrs?\\b|(?![\\d.]))`, "i"), read: (m) => hhmm(m[1], m[2]) },
  { re: /(?<![\d:.])(\d{2})(\d{2})\s*hrs?\b/i, read: (m) => hhmm(m[1], m[2]) },
  // Bare "at 1700". A number starting 19 or 20 is a year.
  { re: /\b(?:at|by|before)\s+((?!19|20)\d{2})(\d{2})\b/i, read: (m) => hhmm(m[1], m[2]) },
];

function to24(hour: number, minute: number, meridiem: string): TimeRead {
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = /^p/i.test(meridiem);
  return { time: `${pad((hour % 12) + (pm ? 12 : 0))}:${pad(minute)}` };
}

/** The clock time nearest a date in its sentence: after it first, then before it. */
function findTime(sentence: string, date: DateHit): TimeHit | null {
  const after = sentence.slice(date.end, date.end + 40);
  const offsetBefore = Math.max(0, date.start - 40);
  const before = sentence.slice(offsetBefore, date.start);
  for (const [text, offset] of [[after, date.end], [before, offsetBefore]] as const) {
    let best: TimeHit | null = null;
    for (const { re, read } of TIME_RES) {
      const m = re.exec(text);
      if (!m) continue;
      const parsed = read(m);
      if (!parsed) continue;
      const end = m.index + m[0].length;
      const rest = text.slice(end);
      const zone = ZONE_RE.exec(rest);
      const unknown = zone ? null : UNKNOWN_ZONE_RE.exec(rest);
      const unknownZone = unknown && !NOT_A_ZONE.has(unknown[1]) ? unknown : null;
      const hit: TimeHit = {
        start: offset + m.index,
        end: offset + end + (zone ? zone[0].length : unknownZone ? unknownZone[0].length : 0),
        time: parsed.time,
        zone: zone ? zone[1] : unknownZone ? unknownZone[1] : null,
        approximate: !!parsed.approximate || !!unknownZone,
      };
      if (!best || hit.start < best.start) best = hit;
    }
    if (best) return best;
  }
  return null;
}

/** The instant a wall-clock time means, and whether the zone's word left any doubt. */
function resolveZone(key: string, time: string, zoneWord: string | null): { ms: number; doubtful: boolean } {
  if (!zoneWord) return { ms: zonedTimeToMs(key, time, LONDON), doubtful: false };
  const numeric = /^(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/i.exec(zoneWord);
  if (numeric) {
    const offset = (Number(numeric[2]) + Number(numeric[3] ?? 0) / 60) * HOUR_MS * (numeric[1] === "-" ? -1 : 1);
    return { ms: zonedTimeToMs(key, time, "Etc/UTC") - offset, doubtful: false };
  }
  const zone = ZONES[zoneWord.toUpperCase().replace(/\s+/g, " ")];
  if (!zone) return { ms: zonedTimeToMs(key, time, LONDON), doubtful: false };
  const literal = zonedTimeToMs(key, time, zone.tz);
  if (!zone.loose) return { ms: literal, doubtful: false };
  const loose = zonedTimeToMs(key, time, zone.loose);
  return { ms: Math.min(literal, loose), doubtful: literal !== loose };
}

// ── Relative windows ────────────────────────────────────────────────────────

function addWorkingDays(key: string, days: number): string {
  let out = key;
  for (let left = days; left > 0; ) {
    out = addDays(out, 1);
    if (weekdayOf(out) <= 5) left--;
  }
  return out;
}

/** N hours is exact; N days keeps the clock time across a clock change. */
function addSpan(fromMs: number, amount: number, unit: string): number {
  const u = unit.toLowerCase();
  if (/^h/.test(u)) return fromMs + amount * HOUR_MS;
  const key = dayKey(fromMs, LONDON);
  const clock = clockTime(fromMs, LONDON);
  if (/^(?:working|business)/.test(u)) return zonedTimeToMs(addWorkingDays(key, amount), clock, LONDON);
  const days = /^week/.test(u) ? amount * 7 : amount;
  return zonedTimeToMs(addDays(key, days), clock, LONDON);
}

function clauseAround(sentence: string, start: number, end: number): string {
  const lower = sentence.toLowerCase();
  const before = sentence.slice(0, start);
  const cut = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), lower.slice(0, start).lastIndexOf(" and "), lower.slice(0, start).lastIndexOf(" so "));
  const after = /[,;]|\s(?:and|so)\s/i.exec(sentence.slice(end));
  return sentence.slice(cut < 0 ? 0 : cut + 1, after ? end + after.index : sentence.length).trim();
}

/** A window is a deadline only when it is about something the candidate does, or stands alone. */
function windowCounts(clause: string): boolean {
  if (NOT_A_WINDOW_RE.test(clause)) return false;
  return CANDIDATE_ACTION_RE.test(clause) || clause.split(/\s+/).length <= BARE_WINDOW_MAX_WORDS;
}

// ── The read ────────────────────────────────────────────────────────────────

type Candidate = DeadlineRead & { rank: number; ms: number };

function sentencesOf(text: string): string[] {
  return text
    .replace(/[   ]/g, " ")
    // A link's numbers are not a date: ".../12/11" is no 12 November.
    .replace(/\bhttps?:\/\/[^\s<>()[\]{}"'“”]+/gi, " ")
    // "Deadline:" on a line of its own heads the line under it.
    .replace(/:[ \t]*\r?\n+/g, ": ")
    .split(/\r?\n+|(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isPromise(sentence: string, upTo: number): boolean {
  const prefix = sentence.slice(0, upTo);
  return PROMISE_RE.test(prefix) && !ASKS_THE_CANDIDATE_RE.test(prefix);
}

/** The deadline an email's text states, or null when it states none. See the rules above. */
export function extractDeadline(text: string, receivedAt: Date | string | number): DeadlineRead | null {
  const received = toMs(receivedAt);
  if (!Number.isFinite(received) || typeof text !== "string" || !text.trim()) return null;
  const receivedKey = dayKey(received, LONDON);
  const candidates: Candidate[] = [];

  for (const sentence of sentencesOf(text)) {
    const dates = findDates(sentence, receivedKey);
    const from = FROM_DATE_RE.exec(sentence);
    if (from) {
      // "10 days from 30 Oct": counted from the date it names.
      const base = dates.find((d) => d.start >= (from.index ?? 0) + from[0].length - 1);
      if (base && !isPromise(sentence, base.end)) {
        const amount = amountOf(from[1]);
        const ms = Number.isFinite(amount) ? addSpan(zonedTimeToMs(base.key, END_OF_DAY, LONDON), amount, from[2]) : NaN;
        if (Number.isFinite(ms) && ms >= received) {
          candidates.push({ rank: 2, ms, dueAt: new Date(ms).toISOString(), dateOnly: true, approximate: APPROX_RE.test(sentence.slice(0, from.index)), matched: sentence.slice(from.index, base.end), zone: null });
          continue;
        }
      }
    }

    for (const date of dates) {
      if (isPromise(sentence, date.end)) continue;
      const time = findTime(sentence, date);
      const hasCue = CUE_RE.test(sentence.slice(0, date.start)) || CUE_RE.test(sentence.slice(date.end, date.end + 12));
      if (!hasCue && !time?.time) continue;
      const nearby = sentence.slice(Math.max(0, date.start - 12), date.start);
      const approximate = date.approximate || APPROX_RE.test(nearby) || !!time?.approximate;
      const matchStart = time ? Math.min(date.start, time.start) : date.start;
      const matchEnd = time ? Math.max(date.end, time.end) : date.end;
      const matched = sentence.slice(matchStart, matchEnd).trim();
      if (time?.time) {
        const { ms, doubtful } = resolveZone(date.key, time.time, time.zone);
        if (!Number.isFinite(ms) || ms < received) continue;
        candidates.push({ rank: hasCue ? 2 : 1, ms, dueAt: new Date(ms).toISOString(), dateOnly: false, approximate: approximate || doubtful, matched, zone: time.zone ? time.zone.toUpperCase() : null });
      } else {
        const ms = zonedTimeToMs(date.key, END_OF_DAY, LONDON);
        if (!Number.isFinite(ms) || ms < received) continue;
        candidates.push({ rank: 2, ms, dueAt: new Date(ms).toISOString(), dateOnly: true, approximate, matched, zone: null });
      }
    }

    if (AFTER_START_RE.test(sentence)) continue;
    for (const re of RELATIVE_RES) {
      const m = re.exec(sentence);
      if (!m) continue;
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const amount = amountOf(m[1]);
      if (!Number.isFinite(amount) || amount <= 0 || isPromise(sentence, end) || !windowCounts(clauseAround(sentence, start, end))) continue;
      const ms = addSpan(received, amount, m[2]);
      if (Number.isFinite(ms)) candidates.push({ rank: 2, ms, dueAt: new Date(ms).toISOString(), dateOnly: false, approximate: false, matched: m[0], zone: null });
      break;
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.rank - a.rank || a.ms - b.ms);
  const { dueAt, dateOnly, approximate, matched, zone } = candidates[0];
  return { dueAt, dateOnly, approximate, matched, zone };
}
