import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_KINDS, rowBehind, stageForKind, upcomingInterviews } from "../src/lib/interviewsPanel.ts";
import { dueWithin } from "../src/lib/deadlines.ts";

const now = Date.parse("2026-11-20T09:00:00Z");

const rows = [
  { id: "bp", company_name: "bp", role: "Software Engineer", status: "rejected" }, // booked interview, wrong stage
  { id: "mz", company_name: "Monzo", role: "Backend Engineer", status: "interview" }, // already at interview
  { id: "gg", company_name: "Google", role: "SWE", status: "applied" }, // assessment, behind
  { id: "el", company_name: "Ellipse", role: "Dev", status: "applied" }, // to-book, no date
];

const events = [
  { id: "e-bp", application_id: "bp", kind: "interview", title: "", status: "scheduled", starts_at: "2026-11-24T14:00:00Z" },
  { id: "e-mz", application_id: "mz", kind: "interview", title: "HM interview", status: "scheduled", starts_at: "2026-11-25T10:00:00Z" },
  { id: "e-gg", application_id: "gg", kind: "assessment", title: "Online assessment", status: "scheduled", due_at: "2026-11-22T00:00:00Z", date_only: true },
  { id: "e-el", application_id: "el", kind: "interview", title: "Book this", status: "to_book" },
  { id: "e-far", application_id: "mz", kind: "interview", title: "Far off", status: "scheduled", starts_at: "2026-12-30T10:00:00Z" }, // outside 14 days
  { id: "e-orphan", application_id: "gone", kind: "interview", title: "Orphan", status: "scheduled", starts_at: "2026-11-24T14:00:00Z" },
  { id: "e-done", application_id: "mz", kind: "interview", title: "Done", status: "done", starts_at: "2026-11-21T10:00:00Z" },
];

test("a booked interview on an ended row still shows, flagged to move", () => {
  const items = upcomingInterviews(rows, events, now);
  const bp = items.find((i) => i.application_id === "bp");
  assert.ok(bp, "the bp interview is listed even though the row is Rejected");
  assert.equal(bp!.needsMove, true);
  assert.equal(bp!.impliedStatus, "interview");
  assert.equal(bp!.prepHref, "/applications/bp/prep");
});

test("a row already at the right stage is not flagged to move", () => {
  const items = upcomingInterviews(rows, events, now);
  const mz = items.find((i) => i.event_id === "e-mz");
  assert.equal(mz!.needsMove, false);
});

test("the window excludes far-off, orphaned and closed events", () => {
  const ids = upcomingInterviews(rows, events, now).map((i) => i.event_id);
  assert.ok(!ids.includes("e-far"), "beyond 14 days");
  assert.ok(!ids.includes("e-orphan"), "row deleted");
  assert.ok(!ids.includes("e-done"), "event already done");
});

test("items are sorted soonest first, undated last", () => {
  const items = upcomingInterviews(rows, events, now);
  const order = items.map((i) => i.event_id);
  assert.deepEqual(order, ["e-gg", "e-bp", "e-mz", "e-el"]);
  const el = items.find((i) => i.event_id === "e-el");
  assert.equal(el!.at, null);
  assert.equal(el!.when, "Not booked yet");
});

test("stageForKind maps each panel kind to a stage", () => {
  assert.equal(stageForKind("interview"), "interview");
  assert.equal(stageForKind("screening_call"), "screening");
  assert.equal(stageForKind("assessment"), "assessment");
  assert.equal(stageForKind("take_home"), "assessment");
  assert.equal(stageForKind("video"), "interview");
});

test("rowBehind: ended or behind true, at/past the stage false", () => {
  assert.equal(rowBehind({ id: "x", company_name: "X", status: "rejected" }, "interview"), true);
  assert.equal(rowBehind({ id: "x", company_name: "X", status: "applied" }, "interview"), true);
  assert.equal(rowBehind({ id: "x", company_name: "X", status: "interview" }, "interview"), false);
  assert.equal(rowBehind({ id: "x", company_name: "X", status: "offer" }, "interview"), false);
});

test("dueWithin excludes the panel's kinds, so nothing is listed twice", () => {
  const dueRows = [{ id: "bp", company_name: "bp", status: "applied", next_deadline: null }];
  const dueEvents = [{ id: "e-bp", application_id: "bp", kind: "interview", title: "Interview", status: "scheduled", starts_at: "2026-11-21T10:00:00Z" }];
  const withPanel = dueWithin(dueRows, now, 48, "Europe/London", dueEvents, new Set(PANEL_KINDS));
  assert.equal(withPanel.filter((i) => i.kind === "event").length, 0, "the interview event is left to the panel");
  const without = dueWithin(dueRows, now, 48, "Europe/London", dueEvents);
  assert.equal(without.filter((i) => i.kind === "event").length, 1, "without the exclusion it would show");
});
