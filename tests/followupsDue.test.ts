// "Follow-ups due today" (Chunk 23, lib/followupsDue): one rule for the /applications
// counter, GET /api/applications/counts and the lite list's due_by. And the 409 that
// names append_note first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followupsDueToday, hasPendingEnding, isFollowupDueToday, FOLLOWUP_DUE_STATUSES } from "../src/lib/followupsDue.ts";
import { LITE_DUE_STATUSES, liteDuePendingFilter, storedValuesFor } from "../src/lib/applicationRows.ts";
import { trackerCounts } from "../src/lib/trackerCounts.ts";
import { MISSING_VERSION_MESSAGE, STALE_NOTES_MESSAGE, decideNotesWrite, staleRefusal } from "../src/lib/notesWrite.ts";

const TODAY = "2026-11-12";
const row = (followup_date: string | null, status: string, pending_outcome: unknown = null) => ({ followup_date, status, pending_outcome });
const REJECTED = { outcome: "rejected", date: "2026-11-12", source: "gmail" };

test("due today means today or earlier, on a sent row that is still live", () => {
  for (const status of ["applied", "Applied", "screening", "Screening", "interview", "assessment"]) {
    assert.equal(isFollowupDueToday(row(TODAY, status), TODAY), true, status);
    assert.equal(isFollowupDueToday(row("2026-11-09", status), TODAY), true, `${status}, overdue`);
  }
  assert.equal(isFollowupDueToday(row("2026-11-13", "applied"), TODAY), false, "tomorrow is not due");
  assert.equal(isFollowupDueToday(row(null, "applied"), TODAY), false);
  assert.equal(isFollowupDueToday(row("13/11/2026", "applied"), TODAY), false, "not a date");
});

test("never on a row that was not sent, has ended, or holds an offer", () => {
  for (const status of ["saved", "Ready to submit", "rejected", "Rejected", "withdrawn", "Withdrawn", "ghosted", "accepted", "offer"]) {
    assert.equal(isFollowupDueToday(row("2026-11-09", status), TODAY), false, status);
  }
});

test("a later rejection a sweep recorded (a pending ending) takes the row out until it is answered", () => {
  assert.equal(isFollowupDueToday(row("2026-11-09", "screening", REJECTED), TODAY), false);
  assert.equal(isFollowupDueToday(row("2026-11-09", "screening", { ...REJECTED, outcome: "ghosted" }), TODAY), false);
  assert.equal(isFollowupDueToday(row("2026-11-09", "screening", { ...REJECTED, dismissed: true }), TODAY), true, "a rejection the user called untrue keeps it due");
  assert.equal(isFollowupDueToday(row("2026-11-09", "interview", { outcome: "move_back", status: "screening", date: TODAY, source: "gmail" }), TODAY), true, "a question is not an ending");
  assert.equal(hasPendingEnding({ outcome: "rejected", date: "not a date", source: "x" }), false, "an unreadable value is no outcome");
  assert.equal(hasPendingEnding(null), false);
});

test("the count splits today from overdue", () => {
  const rows = [
    row(TODAY, "applied"),
    row(TODAY, "Screening"),
    row("2026-11-09", "Applied"),
    row("2026-11-09", "applied"),
    row("2026-11-11", "interview"),
    row("2026-11-09", "Ready to submit"),
    row("2026-11-09", "screening", REJECTED),
    row("2026-11-19", "applied"),
  ];
  assert.deepEqual(followupsDueToday(rows, TODAY), { total: 5, today: 2, earlier: 3 });
  assert.deepEqual(followupsDueToday([], TODAY), { total: 0, today: 0, earlier: 0 });
});

test("the counts route answers the same number the page counts", () => {
  const rows = [
    { id: "a", status: "applied", followup_date: TODAY },
    { id: "b", status: "screening", followup_date: "2026-11-01", pending_outcome: REJECTED },
    { id: "c", status: "saved", followup_date: "2026-11-01" },
    { id: "d", status: "Interview", followup_date: "2026-11-10" },
  ];
  assert.deepEqual(trackerCounts(rows, [], TODAY).followups_due_today, { total: 2, today: 1, earlier: 1 });
});

test("the lite list's due_by keeps exactly those statuses, in every stored spelling, and leaves a pending ending out", () => {
  assert.deepEqual([...LITE_DUE_STATUSES].sort(), ["applied", "assessment", "interview", "screening"]);
  assert.deepEqual(LITE_DUE_STATUSES, FOLLOWUP_DUE_STATUSES);
  assert.ok(storedValuesFor(LITE_DUE_STATUSES).includes("Applied") && storedValuesFor(LITE_DUE_STATUSES).includes("applied"));
  assert.equal(
    liteDuePendingFilter(),
    'pending_outcome.is.null,pending_outcome->>dismissed.eq.true,pending_outcome->>outcome.is.null,pending_outcome->>outcome.not.in.("rejected","Rejected","withdrawn","Withdrawn","ghosted")'
  );
});

test("a notes write refused for want of a version names append_note first, with an example", () => {
  for (const message of [MISSING_VERSION_MESSAGE, STALE_NOTES_MESSAGE]) {
    assert.match(message, /^To add a line, send append_note instead of notes: PUT \/api\/applications \{"id": "<id>", "append_note": "Follow-up sent"\}/);
    assert.ok(message.indexOf("append_note") < message.indexOf("if_updated_at"), "append_note before if_updated_at");
    assert.match(message, /Nothing was saved/);
  }
  const missing = decideNotesWrite({ id: "x", notes: "Follow-up sent\nold notes" });
  assert.ok("refuse" in missing);
  assert.equal(missing.refuse.status, 409);
  assert.equal(missing.refuse.body.error, "stale_notes");
  assert.equal(missing.refuse.body.message, MISSING_VERSION_MESSAGE);
  assert.deepEqual(missing.refuse.body.hint, { use: "append_note", example: { id: "<id>", append_note: "Follow-up sent" } });
  assert.equal(staleRefusal().body.message, STALE_NOTES_MESSAGE);
  assert.ok(staleRefusal().body.hint);
});
