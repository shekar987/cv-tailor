// The fresh review of Chunk 19 (6 Nov 2026): every input it proved wrong, pinned.
// Made-up rows throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readListMode, toPageRow } from "../src/lib/applicationRows.ts";
import { cleanupRoleKey, planCleanup, runCleanup, type Attachments, type CleanupDb, type CleanupRow } from "../src/lib/trackerCleanup.ts";
import { trackedFetch, writeSeq, writesInFlight } from "../src/lib/writeTracker.ts";

const TODAY = "2026-11-06";
let n = 0;
const id = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const row = (over: Partial<CleanupRow>): CleanupRow => ({
  id: id(), company_name: "Made Up Co", role: "Backend Engineer", status: "Applied", date_applied: "2026-10-20", followup_date: null,
  notes: null, created_at: "2026-10-20T09:00:00.000Z", stages_reached: ["applied"], ...over,
});

type Hooks = { afterRead?: (rows: CleanupRow[]) => void; noteResult?: (rid: string) => boolean; removeResult?: () => number };
function fakeDb(rows: CleanupRow[], hooks: Hooks = {}, attachments = new Map<string, Attachments>()) {
  const writes: { op: string; id: string; payload?: unknown }[] = [];
  const db: CleanupDb = {
    readRows: async () => {
      const copy = rows.map((r) => ({ ...r }));
      hooks.afterRead?.(rows);
      return copy;
    },
    readAttachments: async () => attachments,
    update: async (rid, patch, expect) => {
      writes.push({ op: "update", id: rid, payload: patch });
      const r = rows.find((x) => x.id === rid);
      if (!r || !expect.status.includes(r.status)) return 0;
      if (expect.followup_date !== undefined && r.followup_date !== expect.followup_date) return 0;
      Object.assign(r, patch);
      return 1;
    },
    appendNote: async (rid, line) => {
      writes.push({ op: "note", id: rid, payload: line });
      if (hooks.noteResult && !hooks.noteResult(rid)) return false;
      const r = rows.find((x) => x.id === rid);
      if (!r) return false;
      r.notes = r.notes ? `${line}\n${r.notes}` : line;
      return true;
    },
    remove: async (rid, expect) => {
      writes.push({ op: "delete", id: rid });
      if (hooks.removeResult) return hooks.removeResult();
      const i = rows.findIndex((x) => x.id === rid && expect.status.includes(x.status));
      if (i < 0) return 0;
      rows.splice(i, 1);
      return 1;
    },
  };
  return { db, writes, rows };
}

test("a first-page row with notes keeps notes_more, so its Notes box stays locked until the full text loads", () => {
  const short = toPageRow({ id: "a", status: "Applied", notes: "Called the recruiter." });
  assert.equal(short.notes_more, true);
  assert.equal("notes_preview" in short, false);
  const long = toPageRow({ id: "b", status: "Applied", notes: "x".repeat(454) });
  assert.equal(long.notes_more, true);
  const none = toPageRow({ id: "c", status: "Applied", notes: "  " });
  assert.equal("notes_more" in none, false);
});

test("an empty stage, limit or cursor, or an unknown parameter, is still the full list", () => {
  for (const qs of ["stage=", "cursor=", "limit=", "stage=&limit=", "status=Applied", "q=acme"]) {
    assert.deepEqual(readListMode(new URLSearchParams(qs)), { mode: "all" }, qs);
  }
});

test("Rule B never deletes a row that holds a JD, a req ID, a salary, a referral or a lesson", () => {
  // The review's Monzo case: the earlier row holds nothing; the later Rejected one holds everything.
  const early = row({ company_name: "Monzo", date_applied: "2026-08-01" });
  const rich = row({ company_name: "Monzo", status: "Rejected", date_applied: "2026-10-01", job_description: "A posting.", req_id: "R-777", salary: "£50,000", referral: true, lesson: "Ask about the team.", stages_reached: ["applied", "rejected"] });
  const plan = planCleanup([early, rich], new Map(), TODAY);
  assert.equal(plan.ruleB[0].keep.id, rich.id, "the row with the data is the one kept");
  assert.deepEqual(plan.ruleB[0].duplicates.map((d) => d.id), [early.id]);
  for (const field of [{ job_description: "Another posting." }, { req_id: "R-778" }, { salary: "£40k" }, { referral: true }, { lesson: "Lesson." }, { close_reason: "role_closed" }, { last_contact_at: "2026-10-03T10:00:00Z" }]) {
    const p = planCleanup([early, rich, row({ company_name: "Monzo", date_applied: "2026-10-02", ...field })], new Map(), TODAY);
    assert.ok(p.ruleB[0].blocked && p.ruleB[0].duplicates.every((d) => d.blocked), `two rows holding data are by hand: ${JSON.stringify(field)}`);
  }
});

test("the role key keeps C#, C++, .NET and other scripts apart", () => {
  assert.notEqual(cleanupRoleKey("Developer (C#)"), cleanupRoleKey("Developer (C++)"));
  assert.notEqual(cleanupRoleKey(".NET Developer"), cleanupRoleKey("NET Developer"));
  assert.notEqual(cleanupRoleKey("Software Engineer (東京)"), cleanupRoleKey("Software Engineer (大阪)"));
  assert.equal(cleanupRoleKey("Software Engineer (Data/Backend)"), cleanupRoleKey("software engineer (data / backend)"));
});

test("a kept row that moved after the plan was read: no note, no status, no delete", async () => {
  const keep = row({ company_name: "Yapily", date_applied: "2026-09-01" });
  const dup = row({ company_name: "Yapily", status: "Withdrawn", date_applied: "2026-09-10", stages_reached: ["applied", "withdrawn"] });
  const { db, writes, rows } = fakeDb([keep, dup], { afterRead: (live) => { live.find((r) => r.id === keep.id)!.status = "Screening"; } });
  const res = await runCleanup(db, { dryRun: false, ids: [dup.id] }, TODAY);
  assert.ok(res.status === 200 && !res.body.dryRun);
  if (res.status !== 200 || res.body.dryRun) return;
  assert.deepEqual(res.body.applied, []);
  assert.match(res.body.skipped[0].reason, /changed since the dry run/);
  assert.deepEqual(writes.filter((w) => w.op !== "update"), [], "no note was written and nothing was deleted");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === keep.id)!.notes, null);
});

test("a duplicate that changed is kept, and the kept row does not take its status", async () => {
  const keep = row({ company_name: "Causaly", date_applied: "2026-09-01" });
  const dup = row({ company_name: "Causaly", status: "Rejected", date_applied: "2026-09-10", stages_reached: ["applied", "rejected"] });
  const { db, rows } = fakeDb([keep, dup], { removeResult: () => 0 });
  const res = await runCleanup(db, { dryRun: false, ids: [dup.id] }, TODAY);
  assert.ok(res.status === 200 && !res.body.dryRun);
  if (res.status !== 200 || res.body.dryRun) return;
  assert.deepEqual(res.body.applied, []);
  assert.match(res.body.warnings[0].reason, /was kept/);
  assert.equal(rows.find((r) => r.id === keep.id)!.status, "Applied", "the status moves only after the delete");
});

test("Rule A: a note the notes cap refuses puts the follow-up date back", async () => {
  const cadence = row({ date_applied: "2026-09-01", followup_date: "2026-10-01", notes: "x".repeat(10) });
  const { db, rows } = fakeDb([cadence], { noteResult: () => false });
  const res = await runCleanup(db, { dryRun: false, ids: [cadence.id] }, TODAY);
  assert.ok(res.status === 200 && !res.body.dryRun);
  if (res.status !== 200 || res.body.dryRun) return;
  assert.deepEqual(res.body.applied, []);
  assert.match(res.body.skipped[0].reason, /notes are full/);
  assert.equal(rows[0].followup_date, "2026-10-01");
});

test("the write tracker moves when a write starts and when it ends; a read is not a write", async () => {
  const realFetch = globalThis.fetch;
  let release: () => void = () => {};
  globalThis.fetch = (async () => {
    await new Promise<void>((r) => { release = r; });
    return new Response("{}");
  }) as typeof fetch;
  try {
    const before = writeSeq();
    const pending = trackedFetch("/api/applications", { method: "PUT", body: "{}" });
    assert.equal(writeSeq(), before + 1);
    assert.equal(writesInFlight(), 1);
    release();
    await pending;
    assert.equal(writeSeq(), before + 2);
    assert.equal(writesInFlight(), 0);
    const read = trackedFetch("/api/applications?all=1");
    release();
    await read;
    assert.equal(writeSeq(), before + 2, "a GET is not counted");
  } finally {
    globalThis.fetch = realFetch;
  }
});
