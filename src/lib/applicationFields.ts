// The fields a tracker row is written with, checked: shared by POST / PUT
// /api/applications and POST /api/applications/log (12 Nov 2026, Chunk 22: moved
// out of the route, unchanged but for the date rule below). Relative imports, so
// it runs under node:test (tests/fastTrackerApi).
//
// The date rule (Chunk 22): a row that is not sent yet ("Ready to submit", stored
// `saved`) may have no date applied — on 11 Nov a parked application was refused
// for want of one, and a made-up date is a false fact in the tracker. A create
// needs one for any other status. An update that moves a dateless row to a status
// that means it WAS sent (Applied, Screening, Interview, Assessment, Offer, Won)
// gets today (resolveSentDate), and the trigger of migration 20261112120000 does
// the same for any writer that doesn't. An ending (Rejected, Withdrawn, Ghosted)
// keeps no date if it never had one — a parked row closed because the role went
// was never sent — and a date once set is cleared only on a Ready to submit row.
import { MAX_JD_CHARS, MAX_NOTES_CHARS, JD_TOO_LONG } from "./limits.ts";
import { isValidEmail } from "./contactCheck.ts";
import { MAX_DEADLINE_NOTE, deadlineFromFields } from "./deadlines.ts";
import { READY_TO_SUBMIT, normalizeStatus, isLastContactFrom, parseContactAt, type Status, type LastContactFrom } from "./tracker.ts";

// Statuses that end a row without saying it was ever sent: no date is invented for them.
export const UNDATED_ENDINGS: ReadonlySet<Status> = new Set<Status>(["rejected", "withdrawn", "ghosted"]);
import { validateReferralFields, type ReferralFields } from "./referrals.ts";
import { MAX_LESSON_CHARS, isCloseReason, normalizePendingOutcome, type CloseReason, type PendingOutcome, type UndoSnapshot } from "./closing.ts";

export const MAX_COMPANY = 200;
export const MAX_ROLE = 200;
export const MAX_SALARY = 100;
export const MAX_NOTES = MAX_NOTES_CHARS;
export const MAX_EMAIL = 254;
export const MAX_OUTCOME_REASON = 500;

export const DATE_REQUIRED =
  "Enter the date applied (YYYY-MM-DD). Only a Ready to submit row may leave it out; once a row is sent it needs the date it was sent.";
export const DATE_KEPT =
  "The date applied can't be cleared once it is set (only a Ready to submit row may have none). Send the right date instead.";
export const FOLLOWUP_ERROR = "Follow-up date can't be earlier than the date applied.";

// Strict YYYY-MM-DD that also exists on the calendar (rejects 2026-02-30).
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Machine-supplied optional text (session id, cv reference): clamp silently.
export function clampOptional(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export type Editable = {
  outcome_reason?: string | null;
  company_name?: string;
  role?: string;
  status?: Status;
  salary?: string | null;
  date_applied?: string | null;
  followup_date?: string | null;
  notes?: string | null;
  job_description?: string | null;
  last_contact_from?: LastContactFrom | null;
  last_contact_at?: string | null;
  closed_at?: string | null;
  close_reason?: CloseReason | null;
  lesson?: string | null;
  pending_outcome?: PendingOutcome | null;
  undo_snapshot?: UndoSnapshot | null;
  applied_from_email?: string | null;
  next_deadline?: string | null;
  deadline_note?: string | null;
} & ReferralFields;

// `field`: which field was wrong, for a caller that reads fields rather than prose.
export type Validation = { fields: Editable } | { error: string; field?: string };

// What a script sends when its variable was never set (13 Nov 2026, Chunk 26): two sweep
// helpers with the same name ran in one browser tab, and the API saved an application for
// company "undefined", role "undefined". These are never a real company or role.
const PLACEHOLDER_NAME_RE = /^(?:undefined|null|nan|\[object object\])$/i;

export function isPlaceholderName(value: string): boolean {
  return PLACEHOLDER_NAME_RE.test(value.trim());
}

function placeholderError(field: "company_name" | "role", value: string): { error: string; field: string } {
  const label = field === "company_name" ? "The company name" : "The role";
  return {
    error: `${label} was sent as "${value.trim()}". That is what a script sends when a value is missing, so nothing was saved. Send the real ${field === "company_name" ? "company name" : "job title"} in ${field}.`,
    field,
  };
}

// The fields a user can edit inline. On create (partial = false) every
// required field must be present; on update (partial = true) absent keys are
// left untouched and present keys are validated. Over-cap text is rejected
// rather than truncated so nothing the user typed is silently lost.
export function validateEditable(body: Record<string, unknown>, partial: boolean): Validation {
  const fields: Editable = {};

  // A present-but-wrong-typed value is a client bug, not "empty": rejecting it
  // keeps a numeric salary from silently wiping the stored text.
  const typeProblem = (["company_name", "role", "salary", "notes", "job_description"] as const).find(
    (key) => key in body && body[key] != null && typeof body[key] !== "string"
  );
  if (typeProblem) return { error: `${typeProblem.replace("_", " ")} must be text.` };

  if (partial && "lesson" in body) {
    if (body.lesson != null && typeof body.lesson !== "string") return { error: "lesson must be text." };
    const lesson = typeof body.lesson === "string" ? body.lesson.trim() : "";
    if (lesson.length > MAX_LESSON_CHARS) return { error: `The lesson is too long (max ${MAX_LESSON_CHARS} characters).` };
    fields.lesson = lesson || null;
  }
  if (partial && "close_reason" in body) {
    if (body.close_reason != null && !isCloseReason(body.close_reason)) return { error: "Pick a valid reason." };
    fields.close_reason = (body.close_reason ?? null) as CloseReason | null;
  }
  if (partial && "closed_at" in body) {
    if (body.closed_at != null && (typeof body.closed_at !== "string" || !Number.isFinite(Date.parse(body.closed_at)))) return { error: "Enter a valid date." };
    fields.closed_at = (body.closed_at ?? null) as string | null;
  }
  if (partial && "pending_outcome" in body) {
    const pending = body.pending_outcome == null ? null : normalizePendingOutcome(body.pending_outcome);
    if (body.pending_outcome != null && !pending) return { error: "That isn't a valid outcome." };
    fields.pending_outcome = pending;
  }

  if (!partial || "company_name" in body) {
    const company = typeof body.company_name === "string" ? body.company_name.trim() : "";
    if (!company) return { error: "Company name is required. Send it as company_name.", field: "company_name" };
    if (isPlaceholderName(company)) return placeholderError("company_name", company);
    if (company.length > MAX_COMPANY) {
      return { error: `Company name is too long (max ${MAX_COMPANY} characters).`, field: "company_name" };
    }
    fields.company_name = company;
  }

  if (!partial || "role" in body) {
    const role = typeof body.role === "string" ? body.role.trim() : "";
    if (!role) return { error: "Role is required. Send the job title as role.", field: "role" };
    if (isPlaceholderName(role)) return placeholderError("role", role);
    if (role.length > MAX_ROLE) return { error: `Role is too long (max ${MAX_ROLE} characters).`, field: "role" };
    fields.role = role;
  }

  if (!partial || "status" in body) {
    if (!partial && body.status === undefined) {
      fields.status = "applied";
    } else {
      const status = normalizeStatus(body.status);
      if (!status) return { error: "Pick a valid status." };
      fields.status = status;
    }
  }

  // Missing or empty: allowed on an update (resolveSentDate decides against the row's
  // status) and on a create of a Ready to submit row; a sent row is created with one.
  if (!partial || "date_applied" in body) {
    const raw = body.date_applied;
    const empty = raw === undefined || raw === null || raw === "";
    if (empty && (partial || fields.status === READY_TO_SUBMIT)) fields.date_applied = null;
    else if (empty) return { error: DATE_REQUIRED };
    else if (!isIsoDate(raw)) return { error: "Enter a valid date applied (YYYY-MM-DD)." };
    else fields.date_applied = raw;
  }

  if (!partial || "followup_date" in body) {
    if (body.followup_date == null || body.followup_date === "") {
      fields.followup_date = null;
    } else if (!isIsoDate(body.followup_date)) {
      return { error: "Enter a valid follow-up date (YYYY-MM-DD)." };
    } else {
      fields.followup_date = body.followup_date;
    }
  }

  if (!partial || "salary" in body) {
    const salary = typeof body.salary === "string" ? body.salary.trim() : "";
    if (salary.length > MAX_SALARY) return { error: `Salary is too long (max ${MAX_SALARY} characters).` };
    fields.salary = salary || null;
  }

  if (!partial || "notes" in body) {
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > MAX_NOTES) return { error: `Notes are too long (max ${MAX_NOTES} characters).` };
    fields.notes = notes || null;
  }

  // Editable after the fact so a manually added row can get its posting
  // pasted in later. On create the JD is handled with the snapshot fields.
  if (partial && "job_description" in body) {
    const jd = typeof body.job_description === "string" ? body.job_description.trim() : "";
    if (jd.length > MAX_JD_CHARS) return { error: JD_TOO_LONG };
    fields.job_description = jd || null;
  }

  // Who spoke last and when ("Reply owed", lib/tracker). Update only. "from"
  // without a time means now; clearing "from" clears the time too.
  if (partial && "last_contact_from" in body) {
    if (body.last_contact_from == null || body.last_contact_from === "") fields.last_contact_from = null;
    else if (isLastContactFrom(body.last_contact_from)) fields.last_contact_from = body.last_contact_from;
    else return { error: 'Last contact must be "me" or "them".' };
  }
  if (partial && "last_contact_at" in body) {
    const at = parseContactAt(body.last_contact_at);
    if (at === undefined) return { error: "Enter a valid last-contact date (YYYY-MM-DD or an ISO time), not in the future." };
    fields.last_contact_at = at;
  }
  if ("last_contact_from" in fields && !("last_contact_at" in fields)) {
    fields.last_contact_at = fields.last_contact_from ? new Date().toISOString() : null;
  }

  // Why the application ended, in the user's own words. Update only.
  if (partial && "outcome_reason" in body) {
    const reason = typeof body.outcome_reason === "string" ? body.outcome_reason.trim() : "";
    if (body.outcome_reason !== null && typeof body.outcome_reason !== "string") return { error: "Enter the reason as text." };
    if (reason.length > MAX_OUTCOME_REASON) return { error: `Keep the reason under ${MAX_OUTCOME_REASON} characters.` };
    fields.outcome_reason = reason || null;
  }

  // Which inbox the application used and what is due next (lib/deadlines), on create
  // and on update. A date with no time is due at the end of that day in London.
  if ("applied_from_email" in body) {
    if (body.applied_from_email != null && typeof body.applied_from_email !== "string") return { error: "applied_from_email must be text." };
    const email = typeof body.applied_from_email === "string" ? body.applied_from_email.trim() : "";
    if (email && (email.length > MAX_EMAIL || !isValidEmail(email))) return { error: "Enter the address you applied from as an email address." };
    fields.applied_from_email = email || null;
  }
  if ("next_deadline" in body) {
    const raw = typeof body.next_deadline === "string" ? body.next_deadline.trim() : body.next_deadline;
    if (raw == null || raw === "") fields.next_deadline = null;
    else if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && isIsoDate(raw)) fields.next_deadline = deadlineFromFields(raw, "23:59");
    else if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw))) {
      // A time with no zone is London's, like the form's "Time (UK)": Date.parse would read it
      // as the server's own zone (UTC on Vercel), an hour late all summer.
      const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(raw);
      const at = local ? deadlineFromFields(local[1], local[2]) : new Date(Date.parse(raw)).toISOString();
      if (!at) return { error: "Enter the deadline as an ISO date and time (2026-11-12T09:00:00Z) or a date (2026-11-12)." };
      fields.next_deadline = at;
    } else return { error: "Enter the deadline as an ISO date and time (2026-11-12T09:00:00Z) or a date (2026-11-12)." };
  }
  if ("deadline_note" in body) {
    if (body.deadline_note != null && typeof body.deadline_note !== "string") return { error: "deadline_note must be text." };
    const note = typeof body.deadline_note === "string" ? body.deadline_note.replace(/\s+/g, " ").trim() : "";
    if (note.length > MAX_DEADLINE_NOTE) return { error: `Keep what is due under ${MAX_DEADLINE_NOTE} characters.` };
    fields.deadline_note = note || null;
  }

  // Referral, referrer, req id and the ask's status (lib/referrals). Update only.
  if (partial) {
    const r = validateReferralFields(body);
    if ("error" in r) return { error: r.error };
    Object.assign(fields, r.fields);
  }

  return { fields };
}

// ISO dates compare correctly as strings. No date applied (a Ready to submit row) has
// nothing to be earlier than.
export function followupTooEarly(dateApplied: string | null | undefined, followup: string | null): boolean {
  return !!dateApplied && followup !== null && followup < dateApplied;
}

/**
 * An update's date applied, decided against the row as it will be. Ready to submit: anything.
 * An ending (Rejected, Withdrawn, Ghosted): no date is invented, but a set one stays. Any
 * other status means it was sent: a dateless row gets `today` (`set`). Clearing a set date
 * is refused everywhere but Ready to submit. `patch` is the body's value (undefined = not sent).
 */
export function resolveSentDate(input: {
  status: unknown;
  stored: string | null | undefined;
  patch: string | null | undefined;
  today: string;
}): { ok: true; set?: string } | { error: string } {
  const status = normalizeStatus(input.status);
  if (status === READY_TO_SUBMIT) return { ok: true };
  if (input.patch === null && input.stored) return { error: DATE_KEPT };
  const result = input.patch !== undefined ? input.patch : (input.stored ?? null);
  if (result || (status && UNDATED_ENDINGS.has(status))) return { ok: true };
  if (input.patch === null) return { error: DATE_REQUIRED };
  return { ok: true, set: input.today };
}

// Who logged a row (the "Logged by" badge, Chunk 22): "you", or the name an automation
// gives itself ("Claude sweep"). Kept in the row's tailored_cv as `loggedBy`, read by the
// list as a JSON path, so no column and no migration. Absent = not recorded.
export const LOGGED_BY_YOU = "you";
export const MAX_LOGGED_BY = 40;
const LOGGED_BY_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'_-]*$/u;

export function readLoggedBy(value: unknown): { loggedBy: string | null } | { error: string } {
  if (value === undefined || value === null || value === "") return { loggedBy: null };
  if (typeof value !== "string") return { error: "logged_by must be text." };
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return { loggedBy: null };
  if (/^(you|me|user|myself)$/i.test(text)) return { loggedBy: LOGGED_BY_YOU };
  if (text.length > MAX_LOGGED_BY || !LOGGED_BY_RE.test(text)) {
    return { error: `logged_by must be a short name (letters, digits and spaces, up to ${MAX_LOGGED_BY} characters), such as "Claude sweep".` };
  }
  return { loggedBy: text };
}

/** The badge's label, or null when the row was logged by its owner or nobody said. */
export function loggedByBadge(loggedBy: unknown): string | null {
  if (typeof loggedBy !== "string") return null;
  const text = loggedBy.trim();
  if (!text || text === LOGGED_BY_YOU || text.length > MAX_LOGGED_BY || !LOGGED_BY_RE.test(text)) return null;
  return `Logged by ${text}`;
}
