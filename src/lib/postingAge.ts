// How old a posting was when the user applied, read off the job description
// text itself ("Posted 3 days ago", "Posted today", "Date posted: 12
// September 2026", "Posted on 12/09/2026") against the applied date. null
// when the text says nothing — never guessed. Stored with the Applied
// snapshot (postingAgeDays) for the tracker's "what's working" view: a
// recruiter's pipeline fills in the first days, so the age at application
// is one of the few things the user can actually control.
//
// Import-free, unit-tested.

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const POSTED_AGO_RE = /\b(?:posted|listed|published|advertised|date posted:?)\s*(?:on\s+)?(\d{1,2})\s*\+?\s*(day|days|week|weeks|hour|hours|month|months)\s+ago\b/i;
const POSTED_WORD_RE = /\b(?:posted|listed|published|advertised)\s*(?:on\s+)?(today|yesterday|just now)\b/i;
const POSTED_DATE_RE =
  /\b(?:posted|listed|published|advertised|date posted|posting date|closing date|closes)\s*:?\s*(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+((?:19|20)\d{2})\b|\b(?:posted|listed|published|advertised|date posted|posting date)\s*:?\s*(?:on\s+)?(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b|\b(?:posted|listed|published|advertised|date posted|posting date)\s*:?\s*(?:on\s+)?((?:19|20)\d{2})-(\d{2})-(\d{2})\b/i;

function daysBetween(from: Date, to: Date): number {
  return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000);
}

// appliedOn: the date the user applied (YYYY-MM-DD or a Date).
export function postingAgeDays(jd: string, appliedOn: string | Date): number | null {
  if (!jd) return null;
  const applied = typeof appliedOn === "string" ? new Date(appliedOn + "T12:00:00") : appliedOn;
  if (Number.isNaN(applied.getTime())) return null;
  const ago = POSTED_AGO_RE.exec(jd);
  if (ago) {
    const n = Number(ago[1]);
    const unit = ago[2].toLowerCase();
    const days = unit.startsWith("hour") ? 0 : unit.startsWith("week") ? n * 7 : unit.startsWith("month") ? n * 30 : n;
    return clamp(days);
  }
  const word = POSTED_WORD_RE.exec(jd);
  if (word) return word[1].toLowerCase() === "yesterday" ? 1 : 0;
  const m = POSTED_DATE_RE.exec(jd);
  if (m) {
    // A closing date says nothing about the posting date.
    if (/^(?:closing date|closes)/i.test(m[0])) return null;
    let posted: Date | null = null;
    if (m[1] && m[2] && m[3]) {
      const month = MONTHS[m[2].toLowerCase()];
      if (month === undefined) return null;
      posted = new Date(Number(m[3]), month, Number(m[1]), 12);
    } else if (m[4] && m[5] && m[6]) {
      // UK order: day/month/year.
      posted = new Date(Number(m[6]), Number(m[5]) - 1, Number(m[4]), 12);
    } else if (m[7] && m[8] && m[9]) {
      posted = new Date(Number(m[7]), Number(m[8]) - 1, Number(m[9]), 12);
    }
    if (!posted || Number.isNaN(posted.getTime())) return null;
    const days = daysBetween(posted, applied);
    return days < 0 ? null : clamp(days);
  }
  return null;
}

function clamp(days: number): number {
  return Math.max(0, Math.min(365, Math.round(days)));
}

export type PostingAgeBand = "fresh" | "week" | "old";
export const POSTING_AGE_BANDS: { key: PostingAgeBand; label: string; test: (d: number) => boolean }[] = [
  { key: "fresh", label: "Applied within 3 days of posting", test: (d) => d <= 3 },
  { key: "week", label: "Applied 4–14 days after posting", test: (d) => d > 3 && d <= 14 },
  { key: "old", label: "Applied 15+ days after posting", test: (d) => d > 14 },
];
