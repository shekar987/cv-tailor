// Chunk 19 part 4: the safe tracker clean-up, against a fake database that records every
// write. Made-up rows throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupRequestBody, cleanupRoleKey, closesCadence, planCleanup, readCleanupRequest, runCleanup, type Attachments, type CleanupDb, type CleanupRow,
} from "../src/lib/trackerCleanup.ts";

const TODAY = "2026-11-06";
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const row = (over: Partial<CleanupRow>): CleanupRow => ({
  id: id(), company_name: "Made Up Co", role: "Software Engineer", status: "Applied", date_applied: "2026-10-20", followup_date: null,
  notes: null, created_at: "2026-10-20T09:00:00.000Z", stages_reached: ["applied"], tailor_session_id: null, sent_cv_name: null, prep_generated_at: null, ...over,
});

function fakeDb(rows: CleanupRow[], attachments = new Map<string, Attachments>()) {
  const writes: { op: string; id: string; payload?: unknown; expect?: unknown }[] = [];
  const db: CleanupDb = {
    readRows: async () => rows.map((r) => ({ ...r })),
    readAttachments: async () => attachments,
    update: async (rid, patch, expect) => {
      writes.push({ op: "update", id: rid, payload: patch, expect });
      const r = rows.find((x) => x.id === rid);
      if (!r || !expect.status.includes(r.status)) return 0;
      if (expect.followup_date !== undefined && r.followup_date !== expect.followup_date) return 0;
      Object.assign(r, patch);
      return 1;
    },
    appendNote: async (rid, line) => {
      writes.push({ op: "note", id: rid, payload: line });
      const r = rows.find((x) => x.id === rid);
      if (!r) return false;
      r.notes = r.notes ? `${line}\n${r.notes}` : line;
      return true;
    },
    remove: async (rid, expect) => {
      writes.push({ op: "delete", id: rid, expect });
      const i = rows.findIndex((x) => x.id === rid && expect.status.includes(x.status));
      if (i < 0) return 0;
      rows.splice(i, 1);
      return 1;
    },
  };
  return { db, writes, rows };
}

test("Rule A takes an Applied row 36 days old with a past follow-up; never 35 days, never a Screening row", () => {
  const old = row({ date_applied: "2026-10-01", followup_date: "2026-10-15" });
  const edge = row({ date_applied: "2026-10-02", followup_date: "2026-10-15" });
  const screened = row({ status: "Screening", date_applied: "2026-09-01", followup_date: "2026-10-01", stages_reached: ["applied", "screening"] });
  const future = row({ date_applied: "2026-09-01", followup_date: "2026-11-20" });
  assert.equal(closesCadence(old, TODAY), true);
  assert.equal(closesCadence(edge, TODAY), false, "35 days is not more than 35");
  assert.equal(closesCadence(screened, TODAY), false);
  assert.equal(closesCadence(future, TODAY), false, "a follow-up still ahead is a live cadence");
  const plan = planCleanup([old, edge, screened, future], new Map(), TODAY);
  assert.deepEqual(plan.ruleA.map((a) => a.id), [old.id]);
  assert.match(plan.ruleA[0].note, /cadence closed 6 Nov 2026/);
});

test("a dry run never writes: the database is untouched", async () => {
  const rows = [row({ date_applied: "2026-09-01", followup_date: "2026-10-01" }), row({ company_name: "Codat", role: "Software Engineer (Data/Backend)" }), row({ company_name: "codat ", role: "Software Engineer (Data / Backend)", date_applied: "2026-10-25" })];
  const before = JSON.stringify(rows);
  const { db, writes } = fakeDb(rows);
  const res = await runCleanup(db, { dryRun: true, ids: [] }, TODAY);
  assert.equal(res.status, 200);
  assert.deepEqual(writes, []);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(res.status === 200 && res.body.dryRun && res.body.plan.ruleA.length, 1);
});

test("applying: a Screening or Interview id is a 409, even listed explicitly, and nothing at all is applied", async () => {
  const cadence = row({ date_applied: "2026-09-01", followup_date: "2026-10-01" });
  const screening = row({ status: "Screening", stages_reached: ["applied", "screening"] });
  const interview = row({ status: "Interview", stages_reached: ["applied", "interview"] });
  const { db, writes } = fakeDb([cadence, screening, interview]);
  for (const ids of [[screening.id], [interview.id], [cadence.id, screening.id, interview.id]]) {
    const res = await runCleanup(db, { dryRun: false, ids }, TODAY);
    assert.equal(res.status, 409, JSON.stringify(ids));
    assert.deepEqual(writes, [], "not even the Rule A row listed beside them");
  }
});

test("the request never carries confirmed_by_user, and no write ever does", async () => {
  assert.deepEqual(cleanupRequestBody(true), { dryRun: true });
  assert.deepEqual(cleanupRequestBody(false, ["a"]), { dryRun: false, ids: ["a"] });
  assert.equal("confirmed_by_user" in cleanupRequestBody(false, ["a"]), false);
  assert.ok("error" in readCleanupRequest({ dryRun: false, ids: ["00000000-0000-4000-8000-000000000001"], confirmed_by_user: true }));
  assert.deepEqual(readCleanupRequest(null), { dryRun: true, ids: [] }, "an empty body is a dry run");
  assert.deepEqual(readCleanupRequest({}), { dryRun: true, ids: [] });
  assert.ok("error" in readCleanupRequest({ dryRun: false }));
  assert.ok("error" in readCleanupRequest({ dryRun: false, ids: ["not-an-id"] }));

  const keep = row({ company_name: "Yapily", role: "Backend Engineer", date_applied: "2026-09-10", notes: "Applied on the portal." });
  const dup = row({ company_name: "Yapily", role: "Backend Engineer", status: "Withdrawn", date_applied: "2026-10-01", notes: "Withdrew: role closed.", stages_reached: ["applied", "withdrawn"] });
  const cadence = row({ date_applied: "2026-09-01", followup_date: "2026-10-01" });
  const { db, writes } = fakeDb([keep, dup, cadence]);
  const res = await runCleanup(db, { dryRun: false, ids: [dup.id, cadence.id] }, TODAY);
  assert.equal(res.status, 200);
  for (const w of writes) {
    if (w.op !== "update") continue;
    assert.deepEqual(Object.keys(w.payload as object).filter((k) => !["followup_date", "status", "date_applied"].includes(k)), [], "a payload carries only followup_date, status and date_applied");
  }
  assert.equal(JSON.stringify(writes).includes("confirmed_by_user"), false);
});

test("Rule B groups the same company and role with case, spacing and punctuation folded, brackets kept", () => {
  assert.equal(cleanupRoleKey("Software Engineer (Data/Backend)"), cleanupRoleKey("Software Engineer (Data / Backend)"));
  assert.notEqual(cleanupRoleKey("Software Engineer (Frontend)"), cleanupRoleKey("Software Engineer (Backend)"));
  const a = row({ company_name: "Codat", role: "Software Engineer (Data/Backend)", date_applied: "2026-10-01" });
  const b = row({ company_name: " codat", role: "Software Engineer (Data / Backend)", date_applied: "2026-10-12" });
  const other = row({ company_name: "Codat", role: "Software Engineer (Frontend)" });
  const plan = planCleanup([b, other, a], new Map(), TODAY);
  assert.equal(plan.ruleB.length, 1);
  assert.equal(plan.ruleB[0].keep.id, a.id, "the earliest row is kept");
  assert.deepEqual(plan.ruleB[0].duplicates.map((d) => d.id), [b.id]);
  assert.equal(plan.ruleB[0].duplicates[0].blocked, null);
});

test("Rule B merges only the ticked duplicate: notes joined, the most advanced status kept, the duplicate deleted", async () => {
  const keep = row({ company_name: "Yapily", role: "Backend Engineer", date_applied: "2026-09-10", notes: "Applied on the portal.", followup_date: "2026-11-20" });
  const dup = row({ company_name: "Yapily", role: "Backend Engineer", status: "Withdrawn", date_applied: "2026-10-01", notes: "Withdrew: role closed.", stages_reached: ["applied", "withdrawn"] });
  const { db, rows } = fakeDb([keep, dup]);
  const res = await runCleanup(db, { dryRun: false, ids: [dup.id] }, TODAY);
  assert.equal(res.status === 200 && !res.body.dryRun && res.body.applied.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, keep.id);
  assert.equal(rows[0].status, "withdrawn", "Yapily: the duplicate's Withdrawn is the most advanced");
  assert.equal(rows[0].followup_date, null, "an ending clears the follow-up, as the tracker's PUT does");
  assert.match(rows[0].notes ?? "", /Merged from a duplicate row[\s\S]*Withdrew: role closed\.[\s\S]*Applied on the portal\./);
  assert.match(rows[0].notes ?? "", /Follow-up 2026-11-20 cleared when marked Withdrawn/);
});

test("Rule B never deletes what it would lose, never touches a group with a screened row, and an unticked duplicate stays", async () => {
  // One row holds the CV that was sent: it is the row kept, so it is never a duplicate to delete.
  const early = row({ company_name: "Model ML", role: "AI Engineer", date_applied: "2026-09-01" });
  const withCv = row({ company_name: "Model ML", role: "AI Engineer", date_applied: "2026-09-05", sent_cv_name: "cv.pdf" });
  const plain = row({ company_name: "Model ML", role: "AI Engineer", date_applied: "2026-09-07" });
  const plan = planCleanup([early, withCv, plain], new Map(), TODAY);
  assert.equal(plan.ruleB[0].keep.id, withCv.id);
  assert.deepEqual(plan.ruleB[0].duplicates.map((d) => [d.id, d.blocked]), [[early.id, null], [plain.id, null]]);

  // Two rows that hold something (a CV file, events): the group is by hand, and says what each holds.
  const withEvents = row({ company_name: "Model ML", role: "AI Engineer", date_applied: "2026-09-06" });
  const att = new Map<string, Attachments>([[withEvents.id, { events: 2, interviews: 0 }]]);
  const twoHolders = planCleanup([early, withCv, withEvents, plain], att, TODAY);
  assert.match(twoHolders.ruleB[0].blocked ?? "", /CV file.*events|events.*CV file/);
  assert.ok(twoHolders.ruleB[0].duplicates.every((d) => d.blocked));

  const screenedGroup = planCleanup([row({ company_name: "Causaly", role: "Engineer", status: "Rejected", stages_reached: ["applied", "screening", "rejected"] }), row({ company_name: "Causaly", role: "Engineer", date_applied: "2026-10-25" })], new Map(), TODAY);
  assert.ok(screenedGroup.ruleB[0].blocked && screenedGroup.ruleB[0].duplicates.every((d) => d.blocked), "a group with a screened row is report only");

  // Ticked anyway: nothing in a by-hand group is deleted; in a mergeable group only the ticked row goes.
  const { db, rows } = fakeDb([early, withCv, withEvents, plain], att);
  const res = await runCleanup(db, { dryRun: false, ids: [withEvents.id, plain.id] }, TODAY);
  assert.ok(res.status === 200 && !res.body.dryRun);
  if (res.status !== 200 || res.body.dryRun) return;
  assert.deepEqual(res.body.applied, []);
  assert.ok(res.body.skipped.every((s) => /by hand/.test(s.reason)));
  assert.equal(rows.length, 4, "nothing was deleted");
  const merged = fakeDb([early, withCv, plain]);
  const res2 = await runCleanup(merged.db, { dryRun: false, ids: [plain.id] }, TODAY);
  assert.ok(res2.status === 200 && !res2.body.dryRun && res2.body.applied.length === 1);
  assert.deepEqual(merged.rows.map((r) => r.id).sort(), [early.id, withCv.id].sort(), "the unticked duplicate stays");
});

test("Rule A on apply: the follow-up cleared only while the row is as the plan read it, the status never moves", async () => {
  const cadence = row({ date_applied: "2026-09-01", followup_date: "2026-10-01", notes: "Sent." });
  const { db, rows, writes } = fakeDb([cadence]);
  const res = await runCleanup(db, { dryRun: false, ids: [cadence.id] }, TODAY);
  assert.ok(res.status === 200 && !res.body.dryRun && res.body.applied[0]?.rule === "A");
  assert.equal(rows[0].followup_date, null);
  assert.equal(rows[0].status, "Applied");
  assert.match(rows[0].notes ?? "", /^Follow-up 1 Oct 2026 cleared: cadence closed 6 Nov 2026/);
  const update = writes.find((w) => w.op === "update")!;
  assert.deepEqual(update.payload, { followup_date: null });
  assert.deepEqual(update.expect, { status: ["applied", "Applied"], followup_date: "2026-10-01" });
});

test("Rule C reports and never writes: stale Ready to submit rows, generic roles, roles not shown", () => {
  const plan = planCleanup([
    row({ status: "Ready to submit", date_applied: "2026-10-01", created_at: "2026-10-01T09:00:00Z" }),
    row({ status: "Ready to submit", date_applied: "2026-11-05", created_at: "2026-11-05T09:00:00Z" }),
    row({ role: "Cold email: Backend" }),
    row({ role: "Speculative application" }),
    row({ role: "(role not shown in the AIApply email)" }),
  ], new Map(), TODAY);
  assert.equal(plan.ruleC.readyToSubmit.length, 1);
  assert.equal(plan.ruleC.readyToSubmit[0].days, 36);
  assert.equal(plan.ruleC.genericRoles.length, 2);
  assert.equal(plan.ruleC.roleNotShown.length, 1);
});

test("Rule B keeps the one row that holds the CV that was sent, with the group's earliest date; the empty earlier row goes", async () => {
  const manual = row({ company_name: "Codat", role: "Software Engineer (Data / Backend)", date_applied: "2026-09-14", notes: "Logged by hand." });
  const tailored = row({ company_name: "Codat", role: "Software Engineer (Data/Backend)", date_applied: "2026-09-17", tailor_session_id: "s-1", notes: "Applied with the tailored CV." });
  const plan = planCleanup([manual, tailored], new Map(), TODAY);
  assert.equal(plan.ruleB[0].keep.id, tailored.id);
  assert.match(plan.ruleB[0].keep.why, /tailored CV/);
  assert.deepEqual(plan.ruleB[0].duplicates.map((d) => [d.id, d.blocked, d.newKeepDate]), [[manual.id, null, "2026-09-14"]]);
  const { db, rows } = fakeDb([manual, tailored]);
  const res = await runCleanup(db, { dryRun: false, ids: [manual.id] }, TODAY);
  assert.ok(res.status === 200 && !res.body.dryRun && res.body.applied.length === 1);
  assert.deepEqual(rows.map((r) => r.id), [tailored.id]);
  assert.equal(rows[0].date_applied, "2026-09-14", "the earliest applied date is kept");
  assert.equal(rows[0].tailor_session_id, "s-1");
  assert.match(rows[0].notes ?? "", /Logged by hand\.[\s\S]*Applied with the tailored CV\./);
  // Two rows that both hold a CV are merged by hand.
  const both = planCleanup([tailored, row({ company_name: "Codat", role: "Software Engineer (Data/Backend)", tailor_session_id: "s-2" })], new Map(), TODAY);
  assert.match(both.ruleB[0].blocked ?? "", /more than one/);
});
