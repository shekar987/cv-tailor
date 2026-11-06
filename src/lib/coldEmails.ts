// Cold emails sent from Gmail, logged on the tracker (6 Nov 2026, Chunk 18).
// Twelve of the 30 Oct cold emails were sent and never logged, so their
// follow-ups were nearly missed. POST /api/applications/bulk-upsert takes what
// a Gmail Sent sweep found and inserts the rows that are missing.
//
// The rules, all here so they are tested without a database:
//   - one row per (company, contact): lower(trim(company_name)) and
//     lower(trim(contact_email)); the same pair twice in one payload is one row;
//   - an existing row for the pair is never touched — not its status, not its
//     notes, nothing: the plan has no update in it, only inserts;
//   - an existing cold-email row for the company with NO contact email
//     (logged by hand before this column existed) counts as the pair, so a
//     sweep never doubles a row the user already wrote;
//   - a new row is Applied, source "cold-email", dated the day the email was sent.
//
// Relative .ts imports only, so it runs under node:test.
import { isValidEmail } from "./contactCheck.ts";
import { MAX_NOTES_CHARS } from "./limits.ts";

export const MAX_BULK_ROWS = 200;
export const MAX_COMPANY_CHARS = 200;
export const MAX_ROLE_CHARS = 200;
export const MAX_EMAIL_CHARS = 254;
export const COLD_EMAIL_SOURCE = "cold-email";
// A role the sweep could not read: what the user called these rows by hand.
export const DEFAULT_COLD_ROLE = "Cold email";

export type ColdEmailInput = {
  company_name: string;
  role: string;
  contact_email: string;
  date_sent: string;
  followup_date: string | null;
  notes: string | null;
};

export type ColdEmailProblem = { index: number; error: string };

export type ExistingRow = {
  id: string;
  company_name: string | null;
  contact_email?: string | null;
  status?: string | null;
  source?: string | null;
  role?: string | null;
};

export type BulkPlan = {
  insert: { index: number; row: ColdEmailInput }[];
  existing: { index: number; id: string; status: string | null; matchedWithoutEmail: boolean }[];
  duplicateInPayload: number[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function companyKey(company: string | null | undefined): string {
  return (company ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function emailKey(email: string | null | undefined): string {
  return (email ?? "").trim().replace(/^mailto:/i, "").toLowerCase();
}

export function coldEmailKey(company: string | null | undefined, email: string | null | undefined): string {
  return `${companyKey(company)}|${emailKey(email)}`;
}

// A row the user logged by hand for a cold email: its source says so, or its role does.
function looksLikeColdEmail(row: ExistingRow): boolean {
  return row.source === COLD_EMAIL_SOURCE || /^\s*(?:cold\s*email|speculative)/i.test(row.role ?? "");
}

/**
 * The payload read into rows, each checked; the body may be an array or
 * { rows: [...] }. Nothing is guessed: a missing company, a bad address or a
 * date that is not a real YYYY-MM-DD is a problem, reported by its index.
 */
export function readColdEmails(body: unknown, today: string): { rows: { index: number; row: ColdEmailInput }[]; problems: ColdEmailProblem[]; tooMany: boolean } {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : null;
  if (!list) return { rows: [], problems: [{ index: -1, error: "Send an array of rows, or { rows: [...] }." }], tooMany: false };
  if (list.length > MAX_BULK_ROWS) return { rows: [], problems: [], tooMany: true };
  const rows: { index: number; row: ColdEmailInput }[] = [];
  const problems: ColdEmailProblem[] = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push({ index, error: "Each row must be an object." });
      return;
    }
    const r = raw as Record<string, unknown>;
    const company = text(r.company_name);
    const email = text(r.contact_email).replace(/^mailto:/i, "");
    const role = text(r.role) || DEFAULT_COLD_ROLE;
    const sent = text(r.date_sent);
    const followup = text(r.followup_date);
    const notes = typeof r.notes === "string" ? r.notes.trim() : "";
    const checks: [boolean, string][] = [
      [!company, "company_name is required."],
      [company.length > MAX_COMPANY_CHARS, `company_name is too long (max ${MAX_COMPANY_CHARS} characters).`],
      [!email || email.length > MAX_EMAIL_CHARS || !isValidEmail(email), "contact_email is not an email address."],
      [role.length > MAX_ROLE_CHARS, `role is too long (max ${MAX_ROLE_CHARS} characters).`],
      [!isRealDate(sent), "date_sent must be a date, YYYY-MM-DD."],
      [isRealDate(sent) && sent > today, "date_sent is in the future."],
      [!!followup && !isRealDate(followup), "followup_date must be a date, YYYY-MM-DD."],
      [!!followup && isRealDate(followup) && followup < sent, "followup_date is before date_sent."],
      [notes.length > MAX_NOTES_CHARS, `notes are too long (max ${MAX_NOTES_CHARS} characters).`],
    ];
    const failed = checks.find(([bad]) => bad);
    if (failed) {
      problems.push({ index, error: failed[1] });
      return;
    }
    rows.push({ index, row: { company_name: company, role, contact_email: email, date_sent: sent, followup_date: followup || null, notes: notes || null } });
  });
  return { rows, problems, tooMany: false };
}

/**
 * What to insert, and which rows already exist. There is no update: an
 * existing row is reported with its id and status and left exactly as it is.
 */
export function planBulkUpsert(existing: readonly ExistingRow[], rows: readonly { index: number; row: ColdEmailInput }[]): BulkPlan {
  const byPair = new Map<string, ExistingRow>();
  const withoutEmail = new Map<string, ExistingRow>();
  for (const e of existing) {
    if (e.contact_email && e.contact_email.trim()) {
      const key = coldEmailKey(e.company_name, e.contact_email);
      if (!byPair.has(key)) byPair.set(key, e);
    } else if (looksLikeColdEmail(e)) {
      const key = companyKey(e.company_name);
      if (!withoutEmail.has(key)) withoutEmail.set(key, e);
    }
  }
  const plan: BulkPlan = { insert: [], existing: [], duplicateInPayload: [] };
  const seen = new Set<string>();
  for (const { index, row } of rows) {
    const key = coldEmailKey(row.company_name, row.contact_email);
    if (seen.has(key)) {
      plan.duplicateInPayload.push(index);
      continue;
    }
    seen.add(key);
    const match = byPair.get(key);
    if (match) {
      plan.existing.push({ index, id: match.id, status: match.status ?? null, matchedWithoutEmail: false });
      continue;
    }
    const loose = withoutEmail.get(companyKey(row.company_name));
    if (loose) {
      plan.existing.push({ index, id: loose.id, status: loose.status ?? null, matchedWithoutEmail: true });
      continue;
    }
    plan.insert.push({ index, row });
  }
  return plan;
}

/** The record a new cold-email row is written with (every key present, for one PostgREST insert). */
export function coldEmailRecord(row: ColdEmailInput, status: string): Record<string, unknown> {
  return {
    company_name: row.company_name,
    role: row.role,
    contact_email: row.contact_email,
    status,
    source: COLD_EMAIL_SOURCE,
    date_applied: row.date_sent,
    followup_date: row.followup_date,
    notes: row.notes,
    job_description: null,
  };
}

/** The tracker's "Cold emails missing a follow-up date" filter. */
export function coldEmailNeedsFollowup(row: { source?: string | null; status?: string | null; followup_date?: string | null }): boolean {
  return row.source === COLD_EMAIL_SOURCE && /^applied$/i.test((row.status ?? "").trim()) && !row.followup_date;
}
