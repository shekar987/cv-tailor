// A minimal, valid iCalendar (.ics) builder (Chunk JH-1, 19 Nov 2026). "Add to calendar"
// on the interviews panel writes one of these; JH-2B will reuse it for a calendar feed
// (FIX NOTE, 22 Nov), so it lives in lib/ with its own tests, not inside a component.
//
// It follows RFC 5545 where it matters: CRLF line endings, lines folded at 75 octets,
// text values with backslash / semicolon / comma / newline escaped, a UTC DTSTART
// (…Z) for a timed event and VALUE=DATE for a date-only one, and the required UID and
// DTSTAMP. No dependency, no Date.now() — the stamp is passed in (or derived from the
// start) so the output is deterministic and testable.
//
// Relative imports only (there are none); runs under node:test (tests/ics).

export type IcsEvent = {
  /** Globally unique; the panel uses the event's own id plus a host. */
  uid: string;
  /** SUMMARY. */
  title: string;
  /** ISO instant ("2026-11-24T14:00:00Z" / with offset) or a YYYY-MM-DD for a date-only item. */
  start: string;
  /** A day with no time: VALUE=DATE, no clock invented. */
  dateOnly?: boolean;
  /** ISO end instant. Ignored for a date-only event (DTEND is the next day). */
  end?: string | null;
  /** When no end is given: a default length for a timed event. */
  durationMinutes?: number;
  description?: string;
  location?: string;
  url?: string;
  /** DTSTAMP, as an ISO instant. Defaults to the start (or today, for a date-only start). */
  stamp?: string;
};

const PRODID = "-//Jobhuntz//Interview tracker//EN";

/** An ISO instant → the iCalendar UTC basic form "20261124T140000Z". */
export function toIcsUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`ics: invalid instant ${iso}`);
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A YYYY-MM-DD → the iCalendar DATE form "20261124". */
export function toIcsDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) throw new Error(`ics: invalid date ${day}`);
  return `${m[1]}${m[2]}${m[3]}`;
}

/** Escape a TEXT value: backslash first, then semicolon, comma and newline (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// TextEncoder/TextDecoder work in both Node and the browser (buildIcs runs in the browser
// on "Add to calendar"), so the builder needs no Buffer and stays universal.
const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** Fold a content line to 75 octets, continued with CRLF + a single space (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const bytes = ENC.encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  // First line takes 75 octets; each continuation 74 (the leading space is one octet).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 sequence: back up off a continuation byte (10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(DEC.decode(bytes.subarray(start, end)));
    start = end;
    limit = 74;
  }
  return out.join("\r\n ");
}

function line(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function vevent(ev: IcsEvent): string[] {
  const lines: string[] = ["BEGIN:VEVENT", line("UID", ev.uid)];
  const stampIso = ev.stamp ?? (ev.dateOnly ? `${ev.start.slice(0, 10)}T00:00:00Z` : ev.start);
  lines.push(line("DTSTAMP", toIcsUtc(stampIso)));
  if (ev.dateOnly) {
    const startDay = toIcsDate(ev.start);
    const endMs = Date.parse(`${ev.start.slice(0, 10)}T00:00:00Z`) + 86_400_000;
    lines.push(`DTSTART;VALUE=DATE:${startDay}`);
    lines.push(`DTEND;VALUE=DATE:${new Date(endMs).toISOString().slice(0, 10).replace(/-/g, "")}`);
  } else {
    lines.push(line("DTSTART", toIcsUtc(ev.start)));
    const endIso = ev.end ?? new Date(Date.parse(ev.start) + (ev.durationMinutes ?? 60) * 60_000).toISOString();
    lines.push(line("DTEND", toIcsUtc(endIso)));
  }
  lines.push(line("SUMMARY", escapeText(ev.title)));
  if (ev.description) lines.push(line("DESCRIPTION", escapeText(ev.description)));
  if (ev.location) lines.push(line("LOCATION", escapeText(ev.location)));
  if (ev.url) lines.push(line("URL", ev.url));
  lines.push("END:VEVENT");
  return lines;
}

/** One or more events as a complete iCalendar object, CRLF-terminated. */
export function buildIcs(events: IcsEvent | readonly IcsEvent[]): string {
  const list = Array.isArray(events) ? events : [events as IcsEvent];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...list.flatMap(vevent),
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** A safe download file name from a title: letters, digits and dashes, ending ".ics". */
export function icsFilename(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
  return `${slug}.ics`;
}
