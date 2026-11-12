// POST /api/applications/bulk's rules (Chunk 23, lib/bulkUpdate): the body read once, each
// row's PUT body, each row's answer, and the batch runner. The writes themselves are the
// tracker's own PUT, run on the real database by scripts/smoke-chunk23.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BULK_CONCURRENCY, MAX_BULK_IDS, bulkAnswer, bulkItem, inBatches, itemBody, readBulkBody } from "../src/lib/bulkUpdate.ts";
import { MAX_APPENDED_NOTE } from "../src/lib/notesWrite.ts";

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IDS = Array.from({ length: 15 }, (_, i) => id(i + 1));
const err = (r: ReturnType<typeof readBulkBody>) => ("error" in r ? r.error : "");

test("fifteen rows, a new follow-up date and a line: one body, read once", () => {
  const r = readBulkBody({ ids: IDS, followup_date: "2026-11-19", append_line: "  Follow-up   sent  " });
  assert.ok(!("error" in r));
  assert.equal(r.ids.length, 15);
  assert.deepEqual(r.patch, { followup_date: "2026-11-19", append_note: "Follow-up sent" });
  assert.deepEqual(itemBody(IDS[0], r.patch), { id: IDS[0], followup_date: "2026-11-19", append_note: "Follow-up sent" }, "the line goes in as the PUT's append_note, never as notes");
});

test("a status in either spelling is sent in the API's; null clears the follow-up date", () => {
  const r = readBulkBody({ ids: [IDS[0]], status: "ghosted", followup_date: null });
  assert.ok(!("error" in r));
  assert.deepEqual(r.patch, { status: "Ghosted", followup_date: null });
  const s = readBulkBody({ ids: [IDS[0]], status: "Ready to submit" });
  assert.ok(!("error" in s) && s.patch.status === "Ready to submit");
});

test("the same id twice is written once, and the answer says so", () => {
  const r = readBulkBody({ ids: [IDS[0], IDS[0].toUpperCase(), IDS[1]], append_line: "x" });
  assert.ok(!("error" in r));
  assert.deepEqual(r.ids, [IDS[0], IDS[1]]);
  assert.equal(r.repeatedIds, 1);
});

test("everything wrong with a body is a 400 before any row is touched", () => {
  assert.match(err(readBulkBody({ ids: [], append_line: "x" })), /ids must be a list/);
  assert.match(err(readBulkBody({ append_line: "x" })), /ids must be a list/);
  assert.match(err(readBulkBody({ ids: IDS[0], append_line: "x" })), /ids must be a list/);
  assert.match(err(readBulkBody({ ids: Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => id(i)), append_line: "x" })), /At most 100/);
  assert.match(err(readBulkBody({ ids: [IDS[0], "row-7"], append_line: "x" })), /"row-7" is not an application id/);
  assert.match(err(readBulkBody({ ids: [IDS[0]] })), /at least one of followup_date, status or append_line/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], followup_date: "19/11/2026" })), /followup_date must be a date/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], followup_date: "2026-02-30" })), /followup_date must be a date/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], status: "Hired" })), /Unknown status "Hired"/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], append_line: "" })), /append_line must be some text/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], append_line: "x".repeat(MAX_APPENDED_NOTE + 1) })), /too long/);
});

test("an unknown field is refused, and a notes write is pointed at append_line", () => {
  assert.match(err(readBulkBody({ ids: [IDS[0]], followup: "2026-11-19" })), /Unknown field "followup"/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], notes: "Follow-up sent\nold notes" })), /Send the line as "append_line"/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], append_note: "Follow-up sent" })), /Send the line as "append_line"/);
  assert.match(err(readBulkBody({ ids: [IDS[0]], status: "Rejected", confirmed_by_user: true })), /Unknown field "confirmed_by_user"/, "a bulk call can never confirm for the user");
});

test("a row's answer: ok only when its write landed", () => {
  assert.deepEqual(bulkItem(IDS[0], 200, { ok: true, updated_at: "2026-11-12T10:00:00.123+00:00", notes: "the whole notes" }), {
    id: IDS[0],
    ok: true,
    status: 200,
    updated_at: "2026-11-12T10:00:00.123+00:00",
  });
  const repeat = bulkItem(IDS[0], 200, { ok: true, skipped: "duplicate_note", notes: "x", updated_at: "t" });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.skipped, "duplicate_note");
  // A sweep's Screening on a Rejected row: held as a question, nothing written.
  const asked = bulkItem(IDS[1], 202, { ok: true, applied: false, message: "Recorded for the user.", pending_outcome: { outcome: "reopen", note: "quoted words" } });
  assert.equal(asked.ok, false);
  assert.equal(asked.status, 202);
  assert.equal(asked.message, "Recorded for the user.");
  assert.ok(!("pending_outcome" in asked), "the quoted words never ride along");
  // Ending a screened row: refused, with where the sweep records it instead.
  const refused = bulkItem(IDS[2], 409, { error: "Needs the user's confirmation; set pending_outcome instead.", errorType: "needs_confirmation", pendingOutcomeUrl: `/api/applications/${IDS[2]}/pending-outcome` });
  assert.equal(refused.ok, false);
  assert.equal(refused.pendingOutcomeUrl, `/api/applications/${IDS[2]}/pending-outcome`);
  const closed = bulkItem(IDS[3], 200, { ok: true, followupCleared: { followup_date: null, notes: "secret notes" }, updated_at: "t" });
  assert.equal(closed.followupCleared, true, "a flag, never the notes");
  assert.equal(bulkItem(IDS[4], 404, { error: "Application not found" }).ok, false);
  assert.equal(bulkItem(IDS[4], 500, null).updated_at, null);
});

test("the answer counts what landed", () => {
  const a = bulkAnswer([bulkItem(IDS[0], 200, { ok: true }), bulkItem(IDS[1], 409, { error: "x" })], 2);
  assert.deepEqual({ ok: a.ok, updated: a.updated, failed: a.failed, repeatedIds: a.repeatedIds }, { ok: false, updated: 1, failed: 1, repeatedIds: 2 });
  assert.equal(bulkAnswer([bulkItem(IDS[0], 200, { ok: true })], 0).ok, true);
  assert.ok(!("repeatedIds" in bulkAnswer([], 0)));
});

test("rows run a few at a time and answer in the order sent", async () => {
  let running = 0;
  let peak = 0;
  const out = await inBatches(IDS, BULK_CONCURRENCY, async (x) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    running--;
    return x.slice(-2);
  });
  assert.deepEqual(out, IDS.map((x) => x.slice(-2)));
  assert.equal(peak, BULK_CONCURRENCY);
  assert.deepEqual(await inBatches([], 5, async (x) => x), []);
});
