// Referrals on the tracker — the warmest leads (31 Oct 2026, Chunk 6;
// migration 20261031120000). Per application: whether a referral is in play,
// who is referring, the posting's requisition id (what a referrer types into
// their company's referral form), and where it stands:
//
//   offered → details sent → referred → applied
//
// The "Referral asks" strip on /applications lists every referral not yet
// applied, oldest first, each with the next action in words ("Send details to
// Nitish", "Finish Deloitte application"), so a warm lead is never left
// waiting the way the Kainos reply was (lib/tracker isReplyOwed).
//
// Import-free: the API's validation, the strip's selection and wording live
// here and run under node:test.

export const REFERRAL_STATUSES = ["offered", "details_sent", "referred", "applied"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  offered: "Offered",
  details_sent: "Details sent",
  referred: "Referred",
  applied: "Applied",
};

// Still needing an action from the user: shown in the strip.
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = ["offered", "details_sent", "referred"];

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
 * alone. Turning a referral on with no status starts it at "offered"; turning
 * it off clears the status (the name and req id stay, in case it comes back);
 * setting a status turns the referral on.
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
  if (fields.referral === true && !("referral_status" in fields)) fields.referral_status = "offered";
  if (fields.referral === false) fields.referral_status = null;
  if (fields.referral_status && !("referral" in fields)) fields.referral = true;
  return { fields };
}

export type ReferralRow = {
  id: string;
  company_name: string;
  role: string;
  date_applied: string;
  created_at?: string;
  status?: string;
  referral?: boolean | null;
  referrer_name?: string | null;
  req_id?: string | null;
  referral_status?: string | null;
};

// A row that has been closed (rejected, withdrawn) no longer needs the action.
const CLOSED = new Set(["Rejected", "Withdrawn"]);

const statusOf = (r: ReferralRow): ReferralStatus => (isReferralStatus(r.referral_status) ? r.referral_status : "offered");

/** The open referrals, oldest first (the one that has waited longest). */
export function referralAsks<T extends ReferralRow>(rows: readonly T[]): T[] {
  const open = rows.filter((r) => r.referral === true && OPEN_REFERRAL_STATUSES.includes(statusOf(r)) && !CLOSED.has(r.status ?? ""));
  return [...open].sort(
    (a, b) => a.date_applied.localeCompare(b.date_applied) || (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.company_name.localeCompare(b.company_name)
  );
}

/** The next action, in words: "Send details to Nitish", "Finish Deloitte application". */
export function nextReferralAction(row: ReferralRow): string {
  const who = row.referrer_name?.trim();
  switch (statusOf(row)) {
    case "offered":
      return who ? `Send details to ${who}` : "Send your details to the person referring you";
    case "details_sent":
      return who ? `Check ${who} has submitted the referral` : "Check the referral has been submitted";
    case "referred":
    case "applied":
      return `Finish ${row.company_name.trim() || "the"} application`;
  }
}

/** The status the strip's one button moves an open referral to. */
export function nextReferralStatus(status: string | null | undefined): ReferralStatus | null {
  const i = REFERRAL_STATUSES.indexOf(isReferralStatus(status) ? status : "offered");
  return i >= 0 && i < REFERRAL_STATUSES.length - 1 ? REFERRAL_STATUSES[i + 1] : null;
}
