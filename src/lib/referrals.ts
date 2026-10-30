// Referrals on the tracker (31 Oct 2026, Chunk 6; migration 20261031120000).
// Per application: whether a referral is being sought, who could refer, the
// posting's requisition id (what a referrer types into their company's
// referral form), and where the ask stands. The "Referral asks" strip on
// /applications lists the open ones — still to ask, or asked and waiting —
// so an ask is never forgotten the way the Kainos reply was (lib/tracker
// isReplyOwed).
//
// Import-free: the API's validation, the strip's selection and the labels
// live here and run under node:test.

export const REFERRAL_STATUSES = ["to_ask", "asked", "referred", "declined"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  to_ask: "To ask",
  asked: "Asked",
  referred: "Referred",
  declined: "Declined",
};

// The asks still open: shown in the strip.
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = ["to_ask", "asked"];

export const MAX_REFERRER_NAME = 120;
export const MAX_REQ_ID = 60;

export const REFERRAL_MIGRATION_HINT =
  "Referrals need the database migration supabase/migrations/20261031120000_applications_referral.sql. Run it in the Supabase SQL editor, then try again.";

export function isReferralStatus(v: unknown): v is ReferralStatus {
  return typeof v === "string" && (REFERRAL_STATUSES as readonly string[]).includes(v);
}

export type ReferralFields = {
  referral?: boolean;
  referrer_name?: string | null;
  req_id?: string | null;
  referral_status?: ReferralStatus | null;
};

/**
 * The referral keys of a tracker PUT body, validated. Absent keys are left
 * alone. Turning a referral on with no status starts it at "to_ask"; turning
 * it off clears the status (the name and req id stay, in case it comes back).
 */
export function validateReferralFields(body: Record<string, unknown>): { fields: ReferralFields } | { error: string } {
  const fields: ReferralFields = {};
  if ("referral" in body) {
    if (typeof body.referral !== "boolean") return { error: "Referral must be true or false." };
    fields.referral = body.referral;
  }
  for (const [key, max, label] of [
    ["referrer_name", MAX_REFERRER_NAME, "Referrer name"],
    ["req_id", MAX_REQ_ID, "Req ID"],
  ] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v != null && typeof v !== "string") return { error: `${label} must be text.` };
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    if (t.length > max) return { error: `${label} is too long (max ${max} characters).` };
    fields[key] = t || null;
  }
  if ("referral_status" in body) {
    const v = body.referral_status;
    if (v == null || v === "") fields.referral_status = null;
    else if (isReferralStatus(v)) fields.referral_status = v;
    else return { error: "Pick a valid referral status." };
  }
  if (fields.referral === true && !("referral_status" in fields)) fields.referral_status = "to_ask";
  if (fields.referral === false) fields.referral_status = null;
  if (fields.referral_status && !("referral" in fields)) fields.referral = true;
  return { fields };
}

export type ReferralRow = {
  id: string;
  company_name: string;
  role: string;
  date_applied: string;
  status?: string;
  referral?: boolean | null;
  referrer_name?: string | null;
  req_id?: string | null;
  referral_status?: string | null;
};

// A row that has been closed (rejected, withdrawn) no longer needs the ask.
const CLOSED = new Set(["Rejected", "Withdrawn"]);

/** The open asks, "to ask" first, then the oldest application first (the ask that has waited longest). */
export function referralAsks<T extends ReferralRow>(rows: readonly T[]): T[] {
  const open = rows.filter((r) => r.referral === true && OPEN_REFERRAL_STATUSES.includes((r.referral_status ?? "to_ask") as ReferralStatus) && !CLOSED.has(r.status ?? ""));
  const rank = (r: T) => ((r.referral_status ?? "to_ask") === "to_ask" ? 0 : 1);
  return [...open].sort((a, b) => rank(a) - rank(b) || a.date_applied.localeCompare(b.date_applied) || a.company_name.localeCompare(b.company_name));
}

/** The next step offered for an open ask. */
export function nextReferralSteps(status: string | null | undefined): ReferralStatus[] {
  return (status ?? "to_ask") === "to_ask" ? ["asked"] : ["referred", "declined"];
}
