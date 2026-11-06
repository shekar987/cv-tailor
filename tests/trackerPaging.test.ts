// Chunk 19 part 3: one page of the list, the cursor, the counts and this week's follow-ups.
// Made-up rows throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, afterCursor, decodeCursor, encodeCursor, readListMode, stageStatuses, storedValuesFor, toListRow, toPageRow,
} from "../src/lib/applicationRows.ts";
import { followupsDueThisWeek, isFollowupDueThisWeek, trackerCounts, weekOf } from "../src/lib/trackerCounts.ts";

const q = (s: string) => new URLSearchParams(s);

test("no parameters, or ?all=1, is the full list exactly as before (the owner's sweeps read it)", () => {
  assert.deepEqual(readListMode(q("")), { mode: "all" });
  assert.deepEqual(readListMode(q("all=1")), { mode: "all" });
  assert.deepEqual(readListMode(q("all=1&stage=Applied&limit=5")), { mode: "all" });
});

test("?stage=Applied&limit=50 is one page of Applied rows, both stored spellings", () => {
  const m = readListMode(q("stage=Applied&limit=50"));
  assert.equal(m.mode, "page");
  if (m.mode !== "page") return;
  assert.deepEqual(m.statuses, ["applied"]);
  assert.equal(m.limit, 50);
  assert.deepEqual(storedValuesFor(m.statuses!), ["applied", "Applied"]);
  assert.deepEqual(stageStatuses("closed"), ["rejected", "withdrawn", "ghosted"]);
  assert.deepEqual(stageStatuses("to_submit"), ["saved"]);
  assert.deepEqual(stageStatuses("Ready to submit"), ["saved"]);
  assert.deepEqual(stageStatuses("won"), ["accepted"]);
});

test("a limit is a whole number, capped; the default is 50; a bad stage or limit is refused", () => {
  const capped = readListMode(q("limit=5000"));
  assert.equal(capped.mode === "page" && capped.limit, PAGE_LIMIT_MAX);
  const plain = readListMode(q("stage=screening"));
  assert.equal(plain.mode === "page" && plain.limit, PAGE_LIMIT_DEFAULT);
  for (const bad of ["limit=0", "limit=-3", "limit=1.5", "limit=ten", "stage=nonsense"]) assert.equal(readListMode(q(bad)).mode, "error", bad);
});

test("the cursor round-trips, and anything it did not give out is refused before it reaches a filter", () => {
  const row = { date_applied: "2026-10-30", created_at: "2026-10-30T09:15:02.123456+00:00", id: "0b6d2c1e-1111-4a2b-9c3d-5e6f7a8b9c0d" };
  const c = encodeCursor(row)!;
  assert.deepEqual(decodeCursor(c), { d: row.date_applied, c: row.created_at, i: row.id });
  assert.equal(readListMode(q(`cursor=${encodeURIComponent(c)}`)).mode, "page");
  for (const bad of ["", "garbage", "2026-10-30|now|x", `2026-10-30|${row.created_at}|${row.id}|extra`, `2026-10-30),or(id.gt.x|${row.created_at}|${row.id}`, `2026-10-30|2026-10-30T09:15:02Z,id.gt.0|${row.id}`]) {
    assert.equal(decodeCursor(bad), null, bad);
  }
  assert.equal(readListMode(q("cursor=garbage")).mode, "error");
  assert.equal(encodeCursor({ date_applied: null, created_at: "x", id: "y" }), null);
  // Keyset after (date desc, created desc, id asc), the values quoted.
  assert.equal(
    afterCursor({ d: row.date_applied, c: row.created_at, i: row.id }),
    `date_applied.lt."2026-10-30",and(date_applied.eq."2026-10-30",created_at.lt."2026-10-30T09:15:02.123456+00:00"),and(date_applied.eq."2026-10-30",created_at.eq."2026-10-30T09:15:02.123456+00:00",id.gt.0b6d2c1e-1111-4a2b-9c3d-5e6f7a8b9c0d)`
  );
});

test("a page row has no notes preview; the flags it needs stay", () => {
  const stored = { id: "a", company_name: "Made Up", status: "Applied", notes: "Form filled but not submitted yet. " + "x".repeat(300), job_description: "A job." };
  const list = toListRow(stored);
  assert.ok(typeof list.notes_preview === "string" && list.notes_more === true, "the full list keeps its preview");
  const page = toPageRow(stored);
  assert.equal("notes_preview" in page, false);
  assert.equal(page.notes_more, true, "its notes are not known yet, so the Notes box stays locked");
  assert.equal(page.notes_not_submitted, true);
  assert.equal(page.has_job_description, true);
  assert.equal("notes" in page || "job_description" in page, false);
});

test("this week is Monday to Sunday; its earlier days count, last week's and next week's do not", () => {
  assert.deepEqual(weekOf("2026-11-06"), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(weekOf("2026-11-02"), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(weekOf("2026-11-08"), { from: "2026-11-02", to: "2026-11-08" });
  const today = "2026-11-06";
  const yes = (followup_date: string, status = "Applied") => isFollowupDueThisWeek({ followup_date, status }, today);
  assert.equal(yes("2026-11-02"), true);
  assert.equal(yes("2026-11-08"), true);
  assert.equal(yes("2026-11-01"), false);
  assert.equal(yes("2026-11-09"), false);
  assert.equal(yes("2026-11-04", "screening"), true);
  assert.equal(yes("2026-11-04", "Rejected"), false, "never on an ended row");
  assert.equal(yes("2026-11-04", "Ready to submit"), false, "never on an unsent row");
  assert.equal(isFollowupDueThisWeek({ followup_date: null, status: "Applied" }, today), false);
  assert.equal(followupsDueThisWeek([{ followup_date: "2026-11-03", status: "Applied" }, { followup_date: "2026-10-01", status: "Applied" }], today), 1);
});

test("the counts are the page's: the derived stage per row, every row once, from the open events", () => {
  const rows = [
    { id: "a", status: "Applied", followup_date: "2026-11-05" },
    { id: "b", status: "Applied", followup_date: "2026-10-20" },
    { id: "c", status: "Screening", followup_date: null },
    { id: "d", status: "Rejected", followup_date: "2026-11-05" },
    { id: "e", status: "Ready to submit", followup_date: null },
  ];
  const events = [
    // An open test on an Applied row moves it to Assessment, as on the page.
    { application_id: "b", status: "scheduled", kind: "assessment", starts_at: null, due_at: "2026-11-10T17:00:00Z" },
    // A rejected row's events never count (lib/actionCentre actionableEvents).
    { application_id: "d", status: "scheduled", kind: "interview", starts_at: "2026-11-09T10:00:00Z", due_at: null },
    { application_id: "c", status: "done", kind: "assessment", starts_at: null, due_at: "2026-11-01T17:00:00Z" },
  ] as never[];
  const r = trackerCounts(rows, events, "2026-11-06");
  assert.equal(r.total, 5);
  assert.equal(r.counts.applied, 1);
  assert.equal(r.counts.assessment, 1);
  assert.equal(r.counts.screening, 1);
  assert.equal(r.counts.closed, 1);
  assert.equal(r.counts.to_submit, 1);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), 5, "the tabs add up to every row");
  assert.equal(r.followups_due_this_week, 1, "a (this week); b's was last month; d has ended");
  assert.deepEqual(r.week, { from: "2026-11-02", to: "2026-11-08" });
});
