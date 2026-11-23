// "Interviews & deadlines" (Chunk JH-1, 19 Nov 2026): the upcoming interviews, screenings
// and assessments shown at the top of the Applications dashboard.
//
// Why it reads EVENTS, not the Interview tab (FIX NOTE, 22 Nov): on 21 Nov a booked bp
// interview (Tue 24 Nov) had no Interview row — all three bp rows were Rejected — and
// Accenture and Ellipse were missing from the tab too. The tab reads a row's stored
// status; a booked interview lives in application_events. So this reads the events and
// shows a booking even when its row is at the wrong stage or has ended, with a one-click
// "Move to Interview" (needsMove) to put the stored status right.
//
// It owns the scheduled meeting / test events (interview, screening, assessment, video,
// take-home, work trial); the "Do these today" radar keeps the row-level deadlines and
// follow-ups. dueWithin() is told to skip these kinds, so nothing shows twice.
//
// Relative .ts imports only, so it runs under node:test (tests/interviewsPanel).
import { DAY_MS, DEFAULT_TIMEZONE, HOUR_MS, countdown, formatWhen } from "./planTime.ts";
import { normalizeStatus, type Status } from "./tracker.ts";

// The event kinds this panel owns. A plain "deadline", a "follow_up", a networking call or
// a "screening_questions" form stays on the radar.
export const PANEL_KINDS: readonly string[] = ["interview", "screening_call", "assessment", "take_home", "video", "work_trial"];
const OPEN: ReadonlySet<string> = new Set(["scheduled", "to_book"]);

export const KIND_LABELS: Record<string, string> = {
  interview: "Interview",
  screening_call: "Screening call",
  assessment: "Assessment",
  take_home: "Take-home",
  video: "Video interview",
  work_trial: "Work trial",
};

// The stored stage a kind implies, and a linear rank so "is the row behind the booking?"
// is one comparison. An ended row (rejected / withdrawn / ghosted) ranks below everything.
const STAGE_FOR_KIND: Record<string, Status> = {
  interview: "interview",
  screening_call: "screening",
  video: "interview",
  assessment: "assessment",
  take_home: "assessment",
  work_trial: "assessment",
};
const STAGE_RANK: Record<string, number> = { saved: 0, applied: 1, screening: 2, assessment: 3, interview: 4, offer: 5, accepted: 6 };
const ENDED: ReadonlySet<Status> = new Set<Status>(["rejected", "withdrawn", "ghosted"]);

export function stageForKind(kind: string): Status {
  return STAGE_FOR_KIND[kind] ?? "interview";
}

export type PanelRow = {
  id: string;
  company_name: string;
  role?: string | null;
  status: unknown;
  closed_at?: string | null;
  prep_generated_at?: string | null;
};

export type PanelEvent = {
  id: string;
  application_id: string | null;
  kind: string;
  title?: string | null;
  status: string;
  starts_at?: string | null;
  due_at?: string | null;
  date_only?: boolean | null;
  location_or_link?: string | null;
};

export type UpcomingItem = {
  event_id: string;
  application_id: string;
  company_name: string;
  role: string;
  kind: string;
  kindLabel: string;
  title: string;
  /** ISO instant, or a YYYY-MM-DD for a date-only event, or null when it is only "to book". */
  at: string | null;
  date_only: boolean;
  overdue: boolean;
  /** "Tue 24 Nov, 14:00" / "Tue 24 Nov" / "Not booked yet". */
  when: string;
  /** "in 2 days", "3h overdue", or "". */
  left: string;
  location: string | null;
  /** /applications/<id>/prep. */
  prepHref: string;
  /** The row's status now, and the one Move would set. */
  currentStatus: Status | null;
  impliedStatus: Status;
  /** The stored status is behind the booking (or the row has ended): offer Move to <stage>. */
  needsMove: boolean;
};

function ms(e: PanelEvent): number | null {
  const at = Date.parse(e.starts_at ?? e.due_at ?? "");
  return Number.isFinite(at) ? at : null;
}

/** Is the row behind this booking, so a one-click move is worth offering? */
export function rowBehind(row: PanelRow, kind: string): boolean {
  const status = normalizeStatus(row.status);
  if (!status) return true;
  if (row.closed_at || ENDED.has(status)) return true;
  return (STAGE_RANK[status] ?? 0) < (STAGE_RANK[stageForKind(kind)] ?? 0);
}

/**
 * The upcoming interviews / screenings / assessments across every row, soonest first, the
 * undated "to book" ones last. Reads events, so a booking on an ended or wrong-stage row
 * still shows. Window: from `backHours` before now (so a booking earlier today is not
 * dropped) to `days` ahead (so "book before 24 Nov" shows a week out).
 */
export function upcomingInterviews(
  rows: readonly PanelRow[],
  events: readonly PanelEvent[],
  now: number,
  tz: string = DEFAULT_TIMEZONE,
  days = 14,
  backHours = 12
): UpcomingItem[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const horizon = now + days * DAY_MS;
  const earliest = now - backHours * HOUR_MS;
  const items: (UpcomingItem & { sort: number })[] = [];
  for (const e of events) {
    if (!e.application_id || !OPEN.has(e.status) || !PANEL_KINDS.includes(e.kind)) continue;
    const row = byId.get(e.application_id);
    if (!row) continue;
    const at = ms(e);
    // A dated booking must fall in the window; an undated "to book" one always shows.
    if (at !== null && (at > horizon || at < earliest)) continue;
    const dateOnly = !!e.date_only;
    const kindLabel = KIND_LABELS[e.kind] ?? e.kind;
    items.push({
      event_id: e.id,
      application_id: e.application_id,
      company_name: row.company_name,
      role: (row.role ?? "").trim(),
      kind: e.kind,
      kindLabel,
      title: (e.title ?? "").trim() || `${kindLabel} · ${row.company_name}`,
      at: at === null ? (e.status === "to_book" ? null : null) : dateOnly ? (e.starts_at ?? e.due_at ?? "").slice(0, 10) : new Date(at).toISOString(),
      date_only: dateOnly,
      overdue: at !== null && at < now,
      when: at === null ? "Not booked yet" : formatWhen(at, tz, dateOnly),
      left: at === null ? "" : countdown(at, now, { due: true, dateOnly, tz }),
      location: (e.location_or_link ?? "").trim() || null,
      prepHref: `/applications/${row.id}/prep`,
      currentStatus: normalizeStatus(row.status),
      impliedStatus: stageForKind(e.kind),
      needsMove: rowBehind(row, e.kind),
      sort: at ?? Infinity,
    });
  }
  return items
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort, ...item }) => {
      void sort;
      return item;
    });
}
