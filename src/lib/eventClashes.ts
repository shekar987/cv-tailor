// Clash detection for application_events (Chunk JH-8, 27 Nov 2026).
// Pure, import-free, runs under node:test (tests/eventClashes).
//
// A clash is a time-interval overlap between two timed events that are both open.
// A "tight" gap is two such events whose intervals are adjacent with under 15 minutes between.
// Date-only events, due_at-only deadlines, and done/cancelled/missed events are ignored.

export type ClashItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
};

export type ClashResult = {
  clashes: ClashItem[];
  tight: ClashItem[];
};

export type ClashableEvent = {
  id: string;
  title?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  due_at?: string | null;
  date_only?: boolean | null;
  status?: string | null;
};

const IGNORED: ReadonlySet<string> = new Set(["done", "cancelled", "missed"]);
const TIGHT_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1 hour default when ends_at is absent

function timedInterval(e: ClashableEvent): { startMs: number; endMs: number } | null {
  if (!e.starts_at || e.date_only) return null;
  if (e.status && IGNORED.has(e.status)) return null;
  const startMs = Date.parse(e.starts_at);
  if (!Number.isFinite(startMs)) return null;
  const endMs = e.ends_at ? Date.parse(e.ends_at) : startMs + DEFAULT_DURATION_MS;
  if (!Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Detect clashes and tight gaps between `event` and a list of `others`.
 *
 * - A clash is a time overlap: both events are timed, open, and their intervals intersect.
 * - A tight gap is under 15 minutes between non-overlapping events.
 * - The event is excluded from checking against itself (by id).
 * - Times compare as UTC instants (Date.parse respects offsets), so timezone differences
 *   are handled automatically.
 */
export function findClashes(event: ClashableEvent, others: readonly ClashableEvent[]): ClashResult {
  const ev = timedInterval(event);
  if (!ev) return { clashes: [], tight: [] };

  const clashes: ClashItem[] = [];
  const tight: ClashItem[] = [];

  for (const other of others) {
    if (other.id === event.id) continue;
    const oth = timedInterval(other);
    if (!oth) continue;

    const overlaps = ev.startMs < oth.endMs && ev.endMs > oth.startMs;
    if (overlaps) {
      clashes.push({
        id: other.id,
        title: (other.title ?? "").trim() || other.id,
        starts_at: other.starts_at!,
        ends_at: other.ends_at ?? null,
      });
      continue;
    }

    // Gap between the two non-overlapping intervals (which end comes first?)
    const gap = ev.startMs >= oth.endMs ? ev.startMs - oth.endMs : oth.startMs - ev.endMs;
    if (gap < TIGHT_MS) {
      tight.push({
        id: other.id,
        title: (other.title ?? "").trim() || other.id,
        starts_at: other.starts_at!,
        ends_at: other.ends_at ?? null,
      });
    }
  }

  return { clashes, tight };
}

/**
 * Derive the ICS SEQUENCE counter from an event's prep_notes by counting how many
 * "Moved from " lines have accumulated (each reschedule appends one). No migration needed.
 */
export function sequenceFromNotes(prepNotes: string | null | undefined): number {
  if (!prepNotes) return 0;
  return (prepNotes.match(/Moved from /g) ?? []).length;
}
