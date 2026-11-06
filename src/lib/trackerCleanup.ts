// A safe tracker clean-up (6 Nov 2026, Chunk 19). Dry run by default: it lists
// what it would change and changes nothing. Applying takes the ids the user
// ticked in that list and nothing else, and re-decides every one of them from
// the database at that moment (a client's list is never trusted).
//
//   Rule A, close the cadence: an Applied row whose follow-up date has passed and
//     that was applied more than 35 days ago. The follow-up date is cleared and
//     "cadence closed <date>" is written into the notes. The status never moves.
//   Rule B, duplicates: rows with the same lower(trim(company)) and the same role
//     once case, punctuation and spacing are folded (the words in brackets are
//     KEPT: "(Frontend)" and "(Backend)" are two jobs, "(Data/Backend)" and
//     "(Data / Backend)" one). The earliest row is kept, unless one row alone holds
//     something a delete would lose (a CV, a prep pack, events), which is then kept
//     with the earliest applied date; it takes the group's most advanced status, a
//     duplicate's notes are joined into it, and the duplicate is deleted only when
//     its own id was ticked.
//   Rule C, report only: Ready to submit rows more than 3 days old, generic roles
//     ("Cold email…", "Speculative…") and "(role not shown…)" roles.
//
// Hard guards, checked on the plan and again on every write:
//   - a row at Screening, Interview, Assessment, Offer or Won is never changed,
//     never merged into and never deleted; one listed explicitly makes the whole
//     request a 409 and nothing is applied;
//   - a row that ever reached screening is never deleted or given an ending
//     (lib/closing: ending a screened row needs the user's own confirmation, and
//     this tool never sends confirmed_by_user — nor any key the PUT reads);
//   - a duplicate holding a CV file, a tailored CV, a prep pack, events or mock
//     interviews is never deleted (its data would go with it): merge it by hand;
//   - every write is conditional on the row still being as the plan read it.
//
// Relative .ts imports only, so it runs under node:test and from scripts/.
import { formatDate } from "./formatDate.ts";
import { MAX_NOTES_CHARS } from "./limits.ts";
import { CLOSED_STATUSES, followupClearedNote, normalizeStatus, statusLabel, storedStatusValues, type Status } from "./tracker.ts";

export const CADENCE_DAYS = 35;
export const READY_STALE_DAYS = 3;
export const MAX_CLEANUP_IDS = 500;

// The statuses this tool never touches.
export const PROTECTED_STATUSES: ReadonlySet<Status> = new Set<Status>(["screening", "interview", "assessment", "offer", "accepted"]);
const SCREENED = new Set(["screening", "interview", "assessment", "offer", "accepted"]);
// "Most advanced" among the statuses a mergeable group can hold (protected ones never are).
const MERGE_RANK: Record<string, number> = { saved: 0, applied: 1, ghosted: 2, withdrawn: 3, rejected: 4 };

export type CleanupRow = {
  id: string;
  company_name: string | null;
  role: string | null;
  status: string;
  date_applied: string;
  followup_date: string | null;
  notes: string | null;
  created_at: string;
  stages_reached?: string[] | null;
  tailor_session_id?: string | null;
  sent_cv_name?: string | null;
  prep_generated_at?: string | null;
};
export type Attachments = { events: number; interviews: number };

export type RuleAItem = { id: string; company_name: string; role: string; date_applied: string; followup_date: string; days_since_applied: number; note: string };
export type RuleBDuplicate = {
  id: string;
  company_name: string;
  role: string;
  status: string;
  date_applied: string;
  // null when it can be merged; otherwise why it must be done by hand.
  blocked: string | null;
  newKeepStatus: string | null;
  // The kept row takes the group's earliest applied date when this duplicate's is earlier.
  newKeepDate: string | null;
};
export type RuleBGroup = {
  key: string;
  keep: { id: string; company_name: string; role: string; status: string; date_applied: string; why: string };
  duplicates: RuleBDuplicate[];
  blocked: string | null;
};
export type RuleCItem = { id: string; company_name: string; role: string; status: string; date_applied: string; days?: number };
export type CleanupPlan = {
  today: string;
  ruleA: RuleAItem[];
  ruleB: RuleBGroup[];
  ruleC: { readyToSubmit: RuleCItem[]; genericRoles: RuleCItem[]; roleNotShown: RuleCItem[] };
};

const DAY_MS = 86_400_000;
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}
const text = (s: string | null | undefined) => (s ?? "").trim();

/** Rule B's role key: case, punctuation and spacing folded; the words in brackets kept. */
export function cleanupRoleKey(role: string | null | undefined): string {
  return (role ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
export function cleanupCompanyKey(company: string | null | undefined): string {
  return (company ?? "").trim().toLowerCase();
}

export function isProtected(row: Pick<CleanupRow, "status">): boolean {
  return PROTECTED_STATUSES.has(normalizeStatus(row.status) as Status);
}
function everScreened(row: Pick<CleanupRow, "status" | "stages_reached">): boolean {
  const now = normalizeStatus(row.status);
  return (now !== null && SCREENED.has(now)) || (row.stages_reached ?? []).some((s) => SCREENED.has(normalizeStatus(s) ?? s));
}

/** Rule A: an Applied row, its follow-up passed, applied more than 35 days ago. */
export function closesCadence(row: CleanupRow, today: string): boolean {
  return normalizeStatus(row.status) === "applied" && !!row.followup_date && row.followup_date < today && daysBetween(row.date_applied, today) > CADENCE_DAYS;
}

export function cadenceNote(row: Pick<CleanupRow, "followup_date" | "date_applied">, today: string): string {
  return `Follow-up ${formatDate(row.followup_date)} cleared: cadence closed ${formatDate(today)} (applied ${formatDate(row.date_applied)}, over ${CADENCE_DAYS} days ago).`;
}

export function mergeNote(dup: Pick<CleanupRow, "role" | "date_applied" | "status" | "notes">, today: string): string {
  const head = `Merged from a duplicate row (${text(dup.role) || "no role"}, applied ${formatDate(dup.date_applied)}, ${statusLabel(dup.status)}) on ${formatDate(today)}.`;
  return text(dup.notes) ? `${head}\n${text(dup.notes)}` : head;
}

function holds(row: CleanupRow, att: Attachments | undefined): string | null {
  if (row.sent_cv_name) return "it holds the CV file you sent";
  if (row.tailor_session_id) return "it holds a tailored CV";
  if (row.prep_generated_at) return "it holds a prep pack";
  if (att && att.events > 0) return "it has events on What's next";
  if (att && att.interviews > 0) return "it has mock interviews";
  return null;
}

const byAge = (a: CleanupRow, b: CleanupRow) => a.date_applied.localeCompare(b.date_applied) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** The plan. Pure: it reads only what it is given. */
export function planCleanup(rows: readonly CleanupRow[], attachments: ReadonlyMap<string, Attachments>, today: string): CleanupPlan {
  const ruleA: RuleAItem[] = rows
    .filter((r) => closesCadence(r, today))
    .sort(byAge)
    .map((r) => ({ id: r.id, company_name: text(r.company_name), role: text(r.role), date_applied: r.date_applied, followup_date: r.followup_date!, days_since_applied: daysBetween(r.date_applied, today), note: cadenceNote(r, today) }));

  const groups = new Map<string, CleanupRow[]>();
  for (const r of rows) {
    const company = cleanupCompanyKey(r.company_name), role = cleanupRoleKey(r.role);
    if (!company || !role) continue;
    const key = `${company}|${role}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const ruleB: RuleBGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(byAge);
    // The row kept is the earliest, unless one row alone holds something a delete would
    // lose (the CV that was sent, a tailored CV, a prep pack, events): then that row is
    // kept and takes the earliest applied date. Two such rows are merged by hand.
    const holders = sorted.filter((r) => holds(r, attachments.get(r.id)) !== null);
    const keep = holders.length === 1 ? holders[0] : sorted[0];
    const why = holders.length === 1 && keep !== sorted[0] ? (holds(keep, attachments.get(keep.id)) ?? "") : "the earliest";
    const groupBlocked = sorted.some(isProtected)
      ? "one of these is at Screening or later"
      : sorted.some(everScreened)
        ? "one of these reached screening"
        : holders.length > 1
          ? `more than one of these holds something a delete would lose (${[...new Set(holders.map((h) => (holds(h, attachments.get(h.id)) ?? "").replace(/^it (?:holds|has) /, "")))].join("; ")})`
          : null;
    let keepStatus = normalizeStatus(keep.status) ?? "applied";
    let keepDate = keep.date_applied;
    const duplicates: RuleBDuplicate[] = sorted.filter((r) => r !== keep).map((d) => {
      const dStatus = normalizeStatus(d.status) ?? "applied";
      const raised = (MERGE_RANK[dStatus] ?? -1) > (MERGE_RANK[keepStatus] ?? -1) ? dStatus : keepStatus;
      const blocked = groupBlocked ?? holds(d, attachments.get(d.id));
      const earlier = d.date_applied < keepDate ? d.date_applied : null;
      const out: RuleBDuplicate = {
        id: d.id, company_name: text(d.company_name), role: text(d.role), status: dStatus, date_applied: d.date_applied, blocked,
        newKeepStatus: !blocked && raised !== keepStatus ? raised : null,
        newKeepDate: !blocked ? earlier : null,
      };
      if (!blocked) {
        keepStatus = raised;
        if (earlier) keepDate = earlier;
      }
      return out;
    });
    ruleB.push({ key, keep: { id: keep.id, company_name: text(keep.company_name), role: text(keep.role), status: normalizeStatus(keep.status) ?? keep.status, date_applied: keep.date_applied, why }, duplicates, blocked: groupBlocked });
  }
  ruleB.sort((a, b) => a.keep.company_name.localeCompare(b.keep.company_name));

  const item = (r: CleanupRow, days?: number): RuleCItem => ({ id: r.id, company_name: text(r.company_name), role: text(r.role), status: normalizeStatus(r.status) ?? r.status, date_applied: r.date_applied, ...(days !== undefined ? { days } : {}) });
  const readyToSubmit = rows
    .filter((r) => normalizeStatus(r.status) === "saved")
    .map((r) => ({ r, days: daysBetween(r.created_at.slice(0, 10) < r.date_applied ? r.created_at.slice(0, 10) : r.date_applied, today) }))
    .filter((x) => x.days > READY_STALE_DAYS)
    .sort((a, b) => b.days - a.days)
    .map((x) => item(x.r, x.days));
  const genericRoles = rows.filter((r) => /^\s*(?:cold\s*email|speculative)/i.test(r.role ?? "")).sort(byAge).map((r) => item(r));
  const roleNotShown = rows.filter((r) => /\(\s*role not shown/i.test(r.role ?? "")).sort(byAge).map((r) => item(r));

  return { today, ruleA, ruleB, ruleC: { readyToSubmit, genericRoles, roleNotShown } };
}

// ── Applying ────────────────────────────────────────────────────────────────

export type Expect = { status: string[]; followup_date?: string | null };
/**
 * The writes, behind an interface so a test can spy on them. Every update and
 * delete is conditional on `expect` (the row as the plan read it) and answers
 * how many rows it changed. Payloads only ever carry followup_date, status and date_applied.
 */
export type CleanupDb = {
  readRows(): Promise<CleanupRow[]>;
  readAttachments(ids: readonly string[]): Promise<Map<string, Attachments>>;
  update(id: string, patch: { followup_date?: null; status?: string; date_applied?: string }, expect: Expect): Promise<number>;
  appendNote(id: string, line: string): Promise<boolean>;
  remove(id: string, expect: Expect): Promise<number>;
};

export type CleanupRequest = { dryRun: boolean; ids: string[] };
export type CleanupResult =
  | { status: 200; body: { dryRun: true; plan: CleanupPlan } }
  | { status: 200; body: { dryRun: false; applied: { id: string; rule: "A" | "B" }[]; skipped: { id: string; reason: string }[] } }
  | { status: 400 | 409; body: { error: string; ids?: string[] } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body the page sends: only these two keys, ever. */
export function cleanupRequestBody(dryRun: boolean, ids: readonly string[] = []): { dryRun: boolean; ids?: string[] } {
  return dryRun ? { dryRun: true } : { dryRun: false, ids: [...ids] };
}

/** A request body read strictly: dryRun defaults to true; confirmed_by_user is refused outright. */
export function readCleanupRequest(body: unknown): CleanupRequest | { error: string } {
  if (body === null || body === undefined) return { dryRun: true, ids: [] };
  if (typeof body !== "object" || Array.isArray(body)) return { error: "Send { dryRun } or { dryRun: false, ids: [...] }." };
  const b = body as Record<string, unknown>;
  if ("confirmed_by_user" in b) return { error: "The clean-up never confirms anything for you: confirmed_by_user is not accepted here." };
  const dryRun = b.dryRun === undefined ? true : b.dryRun;
  if (typeof dryRun !== "boolean") return { error: "dryRun must be true or false." };
  if (dryRun) return { dryRun: true, ids: [] };
  if (!Array.isArray(b.ids) || b.ids.length === 0) return { error: "Tick at least one row: { dryRun: false, ids: [...] }." };
  if (b.ids.length > MAX_CLEANUP_IDS) return { error: `At most ${MAX_CLEANUP_IDS} rows at a time.` };
  if (!b.ids.every((id) => typeof id === "string" && UUID_RE.test(id))) return { error: "Every id must be a row id." };
  return { dryRun: false, ids: [...new Set(b.ids as string[])] };
}

async function freshPlan(db: CleanupDb, today: string): Promise<{ rows: CleanupRow[]; plan: CleanupPlan }> {
  const rows = await db.readRows();
  // Attachments matter only for rows that could be deleted: duplicates.
  const keys = new Map<string, number>();
  for (const r of rows) {
    const k = `${cleanupCompanyKey(r.company_name)}|${cleanupRoleKey(r.role)}`;
    keys.set(k, (keys.get(k) ?? 0) + 1);
  }
  const dupIds = rows.filter((r) => (keys.get(`${cleanupCompanyKey(r.company_name)}|${cleanupRoleKey(r.role)}`) ?? 0) > 1).map((r) => r.id);
  const attachments = dupIds.length ? await db.readAttachments(dupIds) : new Map<string, Attachments>();
  return { rows, plan: planCleanup(rows, attachments, today) };
}

/** Dry run (no write at all), or apply exactly the ticked ids. */
export async function runCleanup(db: CleanupDb, req: CleanupRequest, today: string): Promise<CleanupResult> {
  const { rows, plan } = await freshPlan(db, today);
  if (req.dryRun) return { status: 200, body: { dryRun: true, plan } };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const guarded = req.ids.filter((id) => {
    const r = byId.get(id);
    return r ? isProtected(r) : false;
  });
  if (guarded.length) {
    return { status: 409, body: { error: "Rows at Screening, Interview, Assessment, Offer or Won are never changed by the clean-up; nothing was applied.", ids: guarded } };
  }

  const ruleA = new Map(plan.ruleA.map((a) => [a.id, a]));
  const dupOf = new Map<string, { group: RuleBGroup; dup: RuleBDuplicate }>();
  for (const group of plan.ruleB) for (const dup of group.duplicates) dupOf.set(dup.id, { group, dup });

  const applied: { id: string; rule: "A" | "B" }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of req.ids) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    if (ruleA.has(id)) {
      // The follow-up first, only while the row is still Applied with the same date; then the note.
      const changed = await db.update(id, { followup_date: null }, { status: storedStatusValues("applied"), followup_date: row.followup_date });
      if (changed !== 1) {
        skipped.push({ id, reason: "it changed since the dry run" });
        continue;
      }
      await db.appendNote(id, cadenceNote(row, today));
      applied.push({ id, rule: "A" });
      continue;
    }
    const entry = dupOf.get(id);
    if (entry) {
      const { group, dup } = entry;
      if (dup.blocked) {
        skipped.push({ id, reason: `merge it by hand: ${dup.blocked}` });
        continue;
      }
      const keep = byId.get(group.keep.id);
      if (!keep || isProtected(keep) || everScreened(keep)) {
        skipped.push({ id, reason: "the row it would merge into reached screening" });
        continue;
      }
      // Join the notes first (refused rather than cut when over the cap), then the status, then the delete.
      if (text(row.notes).length + text(keep.notes).length + 200 > MAX_NOTES_CHARS) {
        skipped.push({ id, reason: "the joined notes would be too long: merge it by hand" });
        continue;
      }
      const joined = await db.appendNote(keep.id, mergeNote(row, today));
      if (!joined) {
        skipped.push({ id, reason: "the notes could not be joined: merge it by hand" });
        continue;
      }
      const keepNow = normalizeStatus(keep.status) ?? "applied";
      const dStatus = normalizeStatus(row.status) ?? "applied";
      const target = (MERGE_RANK[dStatus] ?? -1) > (MERGE_RANK[keepNow] ?? -1) ? dStatus : keepNow;
      const earlier = row.date_applied < keep.date_applied ? row.date_applied : null;
      if (target !== keepNow || earlier) {
        const patch: { status?: string; followup_date?: null; date_applied?: string } = {};
        if (target !== keepNow) patch.status = target;
        if (earlier) patch.date_applied = earlier;
        if (CLOSED_STATUSES.has(target) && target !== keepNow && keep.followup_date) patch.followup_date = null;
        const changed = await db.update(keep.id, patch, { status: storedStatusValues(keepNow as Status) });
        // As the tracker's own PUT does: an ending clears the follow-up and says so in the notes.
        if (changed === 1 && patch.followup_date === null && keep.followup_date) await db.appendNote(keep.id, followupClearedNote(keep.followup_date, target, today));
        keep.status = target;
        if (earlier) keep.date_applied = earlier;
      }
      const removed = await db.remove(id, { status: storedStatusValues(dStatus as Status) });
      if (removed !== 1) {
        skipped.push({ id, reason: "its notes were joined, but it changed since the dry run and was not deleted" });
        continue;
      }
      applied.push({ id, rule: "B" });
      continue;
    }
    skipped.push({ id, reason: "not in the clean-up plan any more" });
  }
  return { status: 200, body: { dryRun: false, applied, skipped } };
}
