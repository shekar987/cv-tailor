// Writing a tracker row's notes safely (10 Nov 2026, Chunk 21). Imports only ./planTime.ts.
//
// On 10 Nov an automation wrote "new line + old notes" from the list's 120-character
// preview, twice, and the history of two live rows was gone. Two ways in, and only two:
//
// - append_note: one line, stamped "10 Nov 2026 16:22 …", put on top of the notes by
//   the database in a single UPDATE (the RPC append_application_note). The caller never
//   needs the old text, so it can never send back a short copy of it.
// - notes: a whole replacement, accepted only with if_updated_at, the row's updated_at
//   from a fresh read. A missing one, or one the row has moved on from, is a 409
//   { error: "stale_notes" } and nothing in that write lands.
//
// Whatever gets through, the trigger of migration 20261110120000 keeps the text the
// notes had in notes_history, so "Restore previous notes" can undo it.
import { DEFAULT_TIMEZONE, clockTime, dayKey, dayMonthYear } from "./planTime.ts";

export const MAX_APPENDED_NOTE = 500;
export const STALE_NOTES = "stale_notes";
// The 409 names append_note FIRST (12 Nov 2026, Chunk 23): on 12 Nov a sweep sent 17
// notes writes in one batch without if_updated_at, every one refused, because adding a line
// still looked like read-modify-write to it. The fix for almost every caller is the append.
const APPEND_FIRST =
  'To add a line, send append_note instead of notes: PUT /api/applications {"id": "<id>", "append_note": "Follow-up sent"} (or PATCH with the same body). It never needs the old text, never loses a line, and is stamped with the date.';
export const STALE_NOTES_MESSAGE =
  `${APPEND_FIRST} Nothing was saved: these notes changed since they were read. To replace the notes whole, read the row again (GET /api/applications?id=<id>) and send its updated_at as if_updated_at.`;
export const MISSING_VERSION_MESSAGE =
  `${APPEND_FIRST} Nothing was saved: replacing the notes whole needs if_updated_at, the row's updated_at from a fresh read (GET /api/applications?id=<id>).`;
// Beside the message, for a caller that reads fields rather than prose.
export const STALE_NOTES_HINT = { use: "append_note", example: { id: "<id>", append_note: "Follow-up sent" } } as const;

/** "10 Nov 2026 16:22 <line>", the time where the user is: the one form of an added line. */
export function stampNoteLine(line: string, now: number, tz: string = DEFAULT_TIMEZONE): string {
  return `${dayMonthYear(dayKey(now, tz))} ${clockTime(now, tz)} ${line}`;
}

// The same line appended again within this many minutes is a repeat, not news (12 Nov
// 2026, Chunk 22): on 11 Nov a sweep's script timed out after its follow-up update had
// landed, ran again, and "T+7 follow-up sent" sat on the row twice.
export const DUPLICATE_NOTE_MINUTES = 10;
export const DUPLICATE_NOTE = "duplicate_note";

/**
 * Was exactly this line appended to these notes in the last DUPLICATE_NOTE_MINUTES?
 * A stamped line carries its minute, so the candidates are the line stamped at each minute
 * of the window (one ahead too, for a server whose clock runs fast), and any line of the
 * notes may be the match: another note can have landed on top of it since.
 */
export function isRecentDuplicate(notes: string | null | undefined, line: string, now: number, tz: string = DEFAULT_TIMEZONE): boolean {
  if (!notes) return false;
  const lines = new Set(notes.split("\n").map((l) => l.trim()));
  for (let k = -1; k <= DUPLICATE_NOTE_MINUTES; k++) {
    if (lines.has(stampNoteLine(line, now - k * 60_000, tz))) return true;
  }
  return false;
}

/** One line of text, whitespace folded, within the cap. */
// The refusal says the limit and what was sent (13 Nov 2026, Chunk 26): a sweep that got a
// 400 for a long note lost time guessing the cap. `max` and `length` are for a caller that
// reads fields rather than prose.
export function cleanNoteLine(raw: unknown): { line: string } | { error: string; field: "append_note"; max: number; length?: number } {
  const line = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!line) return { error: `append_note must be some text (one line, up to ${MAX_APPENDED_NOTE} characters).`, field: "append_note", max: MAX_APPENDED_NOTE };
  if (line.length > MAX_APPENDED_NOTE) {
    return {
      error: `The note is too long: ${line.length} characters, and the limit for one append_note is ${MAX_APPENDED_NOTE}. Shorten it, or send the rest as a second note.`,
      field: "append_note",
      max: MAX_APPENDED_NOTE,
      length: line.length,
    };
  }
  return { line };
}

export type NotesRefusal = { status: 400 | 409; body: Record<string, unknown> };
export type NotesWrite =
  | { mode: "none" }
  | { mode: "append"; line: string }
  | { mode: "replace"; ifUpdatedAt: string }
  | { refuse: NotesRefusal };

const stale = (message: string): { refuse: NotesRefusal } => ({ refuse: { status: 409, body: { error: STALE_NOTES, errorType: STALE_NOTES, message, hint: STALE_NOTES_HINT } } });

/**
 * What a PUT body asks of the notes, decided before anything is read: an append needs
 * no version (the database prepends it); a replace without one is refused outright.
 */
export function decideNotesWrite(body: Record<string, unknown>): NotesWrite {
  const appending = body.append_note !== undefined && body.append_note !== null;
  const replacing = "notes" in body;
  if (appending && replacing) return { refuse: { status: 400, body: { error: "Send notes or append_note, not both." } } };
  if (appending) {
    const cleaned = cleanNoteLine(body.append_note);
    return "error" in cleaned ? { refuse: { status: 400, body: { ...cleaned } } } : { mode: "append", line: cleaned.line };
  }
  if (replacing) {
    const version = body.if_updated_at;
    if (typeof version !== "string" || !Number.isFinite(Date.parse(version))) return stale(MISSING_VERSION_MESSAGE);
    return { mode: "replace", ifUpdatedAt: version };
  }
  return { mode: "none" };
}

/** The 409 for a version the row has moved on from. */
export function staleRefusal(): NotesRefusal {
  return stale(STALE_NOTES_MESSAGE).refuse;
}

/**
 * Is the version a caller sent the row's current one? Compared as instants, to the
 * millisecond: a client that round-trips PostgREST's microseconds through a Date still
 * matches, and two writes inside one millisecond do not happen here.
 */
export function sameVersion(stored: unknown, sent: string): boolean {
  if (typeof stored !== "string") return false;
  const a = Date.parse(stored);
  const b = Date.parse(sent);
  return Number.isFinite(a) && a === b;
}

/**
 * After a 409: may a page save its draft again on the version it just read, without
 * asking? Only when the draft already holds every line the row gained since the draft
 * began (`base` → `latest`): a status change elsewhere, or a line this page put into the
 * draft itself. A line the draft never saw (a sweep's append) means the user must look.
 */
export function draftKeepsNewLines(base: string | null | undefined, latest: string | null | undefined, draft: string): boolean {
  const kept = new Set(draft.split("\n").map((l) => l.trim()));
  return addedLines(base, latest)
    .split("\n")
    .filter(Boolean)
    .every((line) => kept.has(line));
}

/** The lines a replacement adds: what is in the new notes and was not in the old. */
export function addedLines(before: string | null | undefined, after: string | null | undefined): string {
  const old = new Set((before ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
  return (after ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !old.has(l))
    .join("\n");
}
