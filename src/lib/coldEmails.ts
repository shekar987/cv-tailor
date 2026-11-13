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
import { companyNamesMatch, normalizeCompanyName } from "./companyMatch.ts";
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

// Control characters (a NUL fails the whole insert) and invisible format characters (a
// zero-width space made "Acme​" a new company) never reach the database.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FORMAT_RE = /\p{Cf}/gu;
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(CONTROL_RE, "").replace(FORMAT_RE, "") : "");
const text = (v: unknown): string => clean(v).replace(/\s+/g, " ").trim();

export function companyKey(company: string | null | undefined): string {
  return clean(company).replace(/\s+/g, " ").trim().toLowerCase();
}

export function emailKey(email: string | null | undefined): string {
  return clean(email).trim().replace(/^mailto:\s*/i, "").trim().toLowerCase();
}

export function coldEmailKey(company: string | null | undefined, email: string | null | undefined): string {
  return `${companyKey(company)}|${emailKey(email)}`;
}

// The same thread: the same address and the same company, read loosely (lib/companyMatch: a
// rename to "Umbrella Corporation", "Acme Ltd" for "Acme"). The same address at a clearly
// different company is another email (an agency recruiter writing for two clients).
function sameThread(e: ExistingRow, company: string): boolean {
  return companyKey(e.company_name) === companyKey(company) || companyNamesMatch(e.company_name ?? "", company);
}

// A cold email the user logged by hand, before rows carried an address: its source says so,
// or its role does ("Cold email", "Cold-email outreach", "Speculative …"), or its notes name an address.
export const COLD_ROLE_RE = /^\s*(?:cold[\s-]*e-?mail|speculative|outreach)|\bcold[\s-]*e-?mail\b|\boutreach\b/i;
function looksLikeColdEmail(row: ExistingRow): boolean {
  return row.source === COLD_EMAIL_SOURCE || COLD_ROLE_RE.test(row.role ?? "");
}
// A hand-logged row stands for an email only when its notes name the address, or it is dated
// within this many days of the send: a June row is never November's email.
export const HAND_ROW_DAYS = 7;
const daysApart = (a: string | null | undefined, b: string): number =>
  a ? Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000 : Infinity;

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
    const email = text(r.contact_email).replace(/^mailto:\s*/i, "").trim();
    const role = text(r.role) || DEFAULT_COLD_ROLE;
    const sent = text(r.date_sent);
    const followup = text(r.followup_date);
    const notes = typeof r.notes === "string" ? r.notes.replace(CONTROL_RE, "").trim() : "";
    const checks: [boolean, string][] = [
      [!company, "company_name is required."],
      // What a script sends when a value is missing (as lib/applicationFields isPlaceholderName).
      [/^(?:undefined|null|nan|\[object object\])$/i.test(company), `company_name was sent as "${company}": send the real company name.`],
      [/^(?:undefined|null|nan|\[object object\])$/i.test(role), `role was sent as "${role}": send the real job title, or leave it out.`],
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
export function planBulkUpsert(existing: readonly (ExistingRow & { date_applied?: string | null; notes?: string | null })[], rows: readonly { index: number; row: ColdEmailInput }[]): BulkPlan {
  // Rows that carry an address, by address: the one field the user never edits.
  const byEmail = new Map<string, ExistingRow[]>();
  const handRows: (ExistingRow & { date_applied?: string | null; notes?: string | null })[] = [];
  for (const e of existing) {
    const k = emailKey(e.contact_email);
    if (k) byEmail.set(k, [...(byEmail.get(k) ?? []), e]);
    else if (looksLikeColdEmail(e) || /@/.test(e.notes ?? "")) handRows.push(e);
  }
  const usedHand = new Set<string>();
  const plan: BulkPlan = { insert: [], existing: [], duplicateInPayload: [] };
  const seen = new Set<string>();
  for (const { index, row } of rows) {
    const address = emailKey(row.contact_email);
    const key = `${normalizeCompanyName(row.company_name) || companyKey(row.company_name)}|${address}`;
    if (seen.has(key)) {
      plan.duplicateInPayload.push(index);
      continue;
    }
    seen.add(key);
    const match = (byEmail.get(address) ?? []).find((e) => sameThread(e, row.company_name));
    if (match) {
      plan.existing.push({ index, id: match.id, status: match.status ?? null, matchedWithoutEmail: false });
      continue;
    }
    // A row logged by hand stands for at most one email: the one its notes name, else one sent
    // within HAND_ROW_DAYS of its date.
    const candidates = handRows.filter((h) => !usedHand.has(h.id) && sameThread(h, row.company_name));
    const hand =
      candidates.find((h) => !!address && (h.notes ?? "").toLowerCase().includes(address)) ??
      candidates.find((h) => looksLikeColdEmail(h) && !/@/.test(h.notes ?? "") && daysApart(h.date_applied, row.date_sent) <= HAND_ROW_DAYS);
    if (hand) {
      usedHand.add(hand.id);
      plan.existing.push({ index, id: hand.id, status: hand.status ?? null, matchedWithoutEmail: true });
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
/** A cold email or speculative outreach: no job title, so no seniority and no JD check. */
export function isColdOutreach(row: { source?: string | null; role?: string | null }): boolean {
  return row.source === COLD_EMAIL_SOURCE || COLD_ROLE_RE.test(row.role ?? "");
}

export function coldEmailNeedsFollowup(row: { source?: string | null; status?: string | null; followup_date?: string | null }): boolean {
  return row.source === COLD_EMAIL_SOURCE && /^applied$/i.test((row.status ?? "").trim()) && !row.followup_date;
}
