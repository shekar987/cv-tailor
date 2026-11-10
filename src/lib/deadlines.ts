// The deadline radar (10 Nov 2026, Chunk 21; imports ./tracker.ts and ./planTime.ts;
// tests/deadlines). One rule for the red "Due in the next 48 hours" strip on
// /applications and for GET /api/applications?due=48h, so the sweep's 07:00 list is the
// screen's list.
//
// Grayce sent a 48-hour assessment to a second inbox; nobody saw it, and the application
// was withdrawn. So a row carries the address it was made from and the next thing due
// (applications.applied_from_email / next_deadline / deadline_note, migration
// 20261110120000), and every item says what to do and where the email went.
//
// Due: a row's next_deadline inside the window, on any row that has not ended (an
// application still marked Applied can be sent a test), or a follow-up date inside it on
// a row at Screening, Assessment or Interview. Up to OVERDUE_DAYS late it still shows, as
// overdue; older is stale data, not a deadline.
import { STATUS_LABELS, normalizeStatus, type Status } from "./tracker.ts";
import { DAY_MS, DEFAULT_TIMEZONE, HOUR_MS, clockTime, countdown, dayKey, formatWhen, zonedTimeToMs } from "./planTime.ts";

export const DUE_WINDOW_HOURS = 48;
export const MAX_DUE_HOURS = 168;
export const OVERDUE_DAYS = 7;
export const MAX_DEADLINE_NOTE = 300;

const ENDED: ReadonlySet<Status> = new Set<Status>(["rejected", "withdrawn", "ghosted", "accepted"]);
const FOLLOWUP_STAGES: ReadonlySet<Status> = new Set<Status>(["screening", "assessment", "interview"]);

export type DueRow = {
  id: string;
  company_name: string;
  role?: string | null;
  status: unknown;
  followup_date?: string | null;
  closed_at?: string | null;
  applied_from_email?: string | null;
  next_deadline?: string | null;
  deadline_note?: string | null;
};

export type DueItem = {
  id: string;
  company_name: string;
  role: string;
  status: Status;
  kind: "deadline" | "followup";
  // An instant for a deadline; a YYYY-MM-DD for a follow-up, which has no time.
  due_at: string;
  date_only: boolean;
  overdue: boolean;
  // What to do, in words, with the address the email went to.
  action: string;
  // "Wed 12 Nov, 09:00 · due in 30h"
  when: string;
  applied_from_email: string | null;
  deadline_note: string | null;
};

/**
 * "due in 30h", "due in 45m", "2h overdue": a 48-hour strip counts hours. The plan's
 * countdown counts calendar days past one, and read "due in 2 days" for a test 30 hours away.
 */
export function dueIn(at: number, now: number, tz: string = DEFAULT_TIMEZONE): string {
  if (at < now) return countdown(at, now, { due: true, tz });
  const minutes = Math.round((at - now) / 60_000);
  return minutes < 60 ? `due in ${Math.max(minutes, 1)}m` : `due in ${Math.floor(minutes / 60)}h`;
}

/** "?due=48h" → 48; no parameter → null; anything else → "invalid". */
export function parseDueParam(raw: string | null): number | null | "invalid" {
  if (raw === null) return null;
  const m = /^(\d{1,3})h$/.exec(raw.trim());
  const hours = m ? Number(m[1]) : NaN;
  return hours >= 1 && hours <= MAX_DUE_HOURS ? hours : "invalid";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const DEFAULT_ACTIONS: Partial<Record<Status, (company: string) => string>> = {
  saved: (c) => `Submit the ${c} application`,
  screening: (c) => `Reply to ${c}`,
  assessment: (c) => `Complete the ${c} assessment`,
  interview: (c) => `Prepare for the ${c} interview`,
  offer: (c) => `Answer the ${c} offer`,
};

/** "Complete the Greenbeam assessment, invite went to second@example.com". */
export function deadlineAction(row: Pick<DueRow, "company_name" | "status" | "deadline_note" | "applied_from_email">): string {
  const status = normalizeStatus(row.status) ?? "applied";
  const base = text(row.deadline_note) || (DEFAULT_ACTIONS[status] ?? ((c: string) => `Act on the ${c} deadline`))(row.company_name);
  const email = text(row.applied_from_email);
  if (!email) return base;
  return status === "saved" ? `${base}, apply from ${email}` : `${base}, invite went to ${email}`;
}

/** "Follow up with Acme (Interview), you applied from second@example.com". */
export function followupAction(row: Pick<DueRow, "company_name" | "status" | "applied_from_email">): string {
  const status = normalizeStatus(row.status) ?? "applied";
  const email = text(row.applied_from_email);
  return `Follow up with ${row.company_name} (${STATUS_LABELS[status]})${email ? `, you applied from ${email}` : ""}`;
}

/**
 * Everything due within `hours` of now, overdue first, soonest next. A row can give two
 * items: its deadline and its follow-up.
 */
export function dueWithin(rows: readonly DueRow[], now: number, hours: number = DUE_WINDOW_HOURS, tz: string = DEFAULT_TIMEZONE): DueItem[] {
  const horizon = now + hours * HOUR_MS;
  const earliest = now - OVERDUE_DAYS * DAY_MS;
  const today = dayKey(now, tz);
  const lastDay = dayKey(horizon, tz);
  const firstDay = dayKey(earliest, tz);
  const items: (DueItem & { sort: number })[] = [];
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    if (!status || ENDED.has(status) || row.closed_at) continue;
    const base = {
      id: row.id,
      company_name: row.company_name,
      role: text(row.role),
      status,
      applied_from_email: text(row.applied_from_email) || null,
      deadline_note: text(row.deadline_note) || null,
    };
    const at = row.next_deadline ? Date.parse(row.next_deadline) : NaN;
    if (Number.isFinite(at) && at <= horizon && at >= earliest) {
      items.push({
        ...base,
        kind: "deadline",
        due_at: new Date(at).toISOString(),
        date_only: false,
        overdue: at < now,
        action: deadlineAction(row),
        when: `${formatWhen(at, tz)} · ${dueIn(at, now, tz)}`,
        sort: at,
      });
    }
    const followup = text(row.followup_date);
    if (FOLLOWUP_STAGES.has(status) && /^\d{4}-\d{2}-\d{2}$/.test(followup) && followup <= lastDay && followup >= firstDay) {
      const ms = zonedTimeToMs(followup, "09:00", tz);
      items.push({
        ...base,
        kind: "followup",
        due_at: followup,
        date_only: true,
        overdue: followup < today,
        action: followupAction(row),
        when: `${formatWhen(ms, tz, true)} · ${countdown(ms, now, { due: true, dateOnly: true, tz })}`,
        sort: ms,
      });
    }
  }
  return items.sort((a, b) => a.sort - b.sort).map((entry) => {
    const { sort, ...item } = entry;
    void sort;
    return item;
  });
}

/** The deadline a form's date and time fields give, London unless said otherwise, or null. */
export function deadlineFromFields(date: string, time: string, tz: string = DEFAULT_TIMEZONE): string | null {
  const ms = zonedTimeToMs(date, time || "23:59", tz);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A stored deadline as the form's date and time fields, in the user's zone. */
export function deadlineFields(iso: string | null | undefined, tz: string = DEFAULT_TIMEZONE): { date: string; time: string } {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return { date: "", time: "" };
  return { date: dayKey(ms, tz), time: clockTime(ms, tz) };
}
