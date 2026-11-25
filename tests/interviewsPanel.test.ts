import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PANEL_DEFAULT_VISIBLE,
  PANEL_KINDS,
  moreActionsLabel,
  panelHiddenCount,
  panelVisible,
  rowBehind,
  stageForKind,
  upcomingInterviews,
} from "../src/lib/interviewsPanel.ts";
import InterviewsPanel from "../src/app/applications/InterviewsPanel.tsx";
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

// --- JH-5 (24 Nov 2026): the calmer panel — at most 3 by default, "Show all", one main action ---

const render = (items: ReturnType<typeof upcomingInterviews>, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(InterviewsPanel, { items, busyId: null, onMove: () => {}, ...extra }));

function manyInterviews(n: number) {
  const r = [];
  const e = [];
  for (let i = 0; i < n; i++) {
    r.push({ id: `c${i}`, company_name: `Co ${i}`, role: "Engineer", status: "applied" });
    e.push({ id: `ev${i}`, application_id: `c${i}`, kind: "interview", title: "", status: "scheduled", starts_at: new Date(now + (i + 1) * 3600_000).toISOString() });
  }
  return upcomingInterviews(r, e, now);
}

test("panelVisible shows at most 3, soonest (past-due) first; Show all reveals the rest (JH-5)", () => {
  const overdueRows = [
    { id: "a", company_name: "A", role: "Eng", status: "applied" },
    { id: "b", company_name: "B", role: "Eng", status: "applied" },
    { id: "c", company_name: "C", role: "Eng", status: "applied" },
    { id: "d", company_name: "D", role: "Eng", status: "applied" },
  ];
  const overdueEvents = [
    { id: "past", application_id: "a", kind: "assessment", title: "", status: "scheduled", due_at: new Date(now - 2 * 3600_000).toISOString() },
    { id: "soon", application_id: "b", kind: "interview", title: "", status: "scheduled", starts_at: new Date(now + 1 * 3600_000).toISOString() },
    { id: "later", application_id: "c", kind: "interview", title: "", status: "scheduled", starts_at: new Date(now + 2 * 3600_000).toISOString() },
    { id: "latest", application_id: "d", kind: "interview", title: "", status: "scheduled", starts_at: new Date(now + 3 * 3600_000).toISOString() },
  ];
  const items = upcomingInterviews(overdueRows, overdueEvents, now);
  assert.equal(PANEL_DEFAULT_VISIBLE, 3);
  const shown = panelVisible(items, false);
  assert.equal(shown.length, 3, "at most 3 by default");
  assert.deepEqual(shown.map((i) => i.event_id), ["past", "soon", "later"], "soonest / past-due first");
  // "Show all" shows the rest; "Show fewer" returns to the first 3.
  assert.deepEqual(panelVisible(items, true).map((i) => i.event_id), ["past", "soon", "later", "latest"]);
  assert.deepEqual(panelVisible(items, false).map((i) => i.event_id), ["past", "soon", "later"]);
  assert.equal(panelHiddenCount(items.length), 1);
  assert.equal(panelHiddenCount(3), 0);
  assert.equal(panelHiddenCount(2), 0);
});

test("by default the component renders only 3 items with a labelled 'Show all (N)' (JH-5)", () => {
  const html = render(manyInterviews(9));
  assert.equal((html.match(/data-interview-item=/g) || []).length, 3, "only 3 rendered");
  assert.match(html, /data-show-all/);
  assert.match(html, /Show all \(9\)/);
  assert.match(html, /aria-label="Show all 9 interviews and deadlines"/);
  assert.match(html, /aria-expanded="false"/);
});

test("'Show all' appears only when there are more than 3 (JH-5)", () => {
  assert.doesNotMatch(render(manyInterviews(3)), /data-show-all/);
  assert.doesNotMatch(render(manyInterviews(2)), /data-show-all/);
  assert.doesNotMatch(render(manyInterviews(1)), /data-show-all/);
  assert.match(render(manyInterviews(4)), /Show all \(4\)/);
});

test("a row behind the booking still shows 'Move to <stage>' up front (JH-5)", () => {
  // The first 3 include bp (Rejected row, booked Interview) and gg (Applied row, Assessment).
  const html = render(upcomingInterviews(rows, events, now));
  assert.match(html, /data-move-to-stage/);
  assert.match(html, /Move to Interview/);
});

test("every other action sits behind one keyboard-reachable 'More' per item (JH-5)", () => {
  const html = render(upcomingInterviews(rows, events, now));
  // The one main action: the item links to the prep pack.
  assert.match(html, /class="interviewsPanel__main"[^>]*href="\/applications\/bp\/prep"/);
  // Add to calendar is NOT a top-level button; it lives inside the <details> menu.
  assert.match(html, /<details class="interviewsPanel__more"/);
  assert.match(html, /<summary[^>]*aria-label="More actions for bp interview"/);
  assert.match(html, /data-add-to-calendar/);
  assert.equal(moreActionsLabel({ company_name: "bp", kindLabel: "Interview" }), "More actions for bp interview");
});

test("the removed sub-line is gone; the title's count stays (JH-5)", () => {
  const html = render(manyInterviews(5));
  assert.doesNotMatch(html, /Booked interviews, screenings and assessments/);
  assert.match(html, /data-interviews-panel="5"/);
  assert.match(html, /interviewsPanel__count">5</);
});

test("with 0 items the panel renders nothing (JH-5)", () => {
  assert.equal(render([]), "");
});

test("dueWithin excludes the panel's kinds, so nothing is listed twice", () => {
  const dueRows = [{ id: "bp", company_name: "bp", status: "applied", next_deadline: null }];
  const dueEvents = [{ id: "e-bp", application_id: "bp", kind: "interview", title: "Interview", status: "scheduled", starts_at: "2026-11-21T10:00:00Z" }];
  const withPanel = dueWithin(dueRows, now, 48, "Europe/London", dueEvents, new Set(PANEL_KINDS));
  assert.equal(withPanel.filter((i) => i.kind === "event").length, 0, "the interview event is left to the panel");
  const without = dueWithin(dueRows, now, 48, "Europe/London", dueEvents);
  assert.equal(without.filter((i) => i.kind === "event").length, 1, "without the exclusion it would show");
});
