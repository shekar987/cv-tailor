import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_LABELS, attentionCounts, defaultTab, deriveStage, dueSoonCutoff, stageAfterEvent, stageEvent, isDataToFix, nextStepFor, nextStepIcon,
  primaryAction, reachedTab, reqIdOf, referralCard, roleLine, shortRole, statusForNewRow, statusToMatch, tabCounts, tabForStatus, tabOfRow, urgencyOf, visibleTabs,
} from "../src/lib/applicationStage.ts";
import type { PlanEvent } from "../src/lib/plan.ts";

const NOW = Date.parse("2026-11-04T18:30:00Z"); // Wed 4 Nov, 18:30 London
const ev = (over: Partial<PlanEvent>): PlanEvent => ({ id: "e", application_id: "a", kind: "assessment", title: "A test", status: "scheduled", ...over });

test("a row's tab is its stored status alone, whatever is open on it (one source of truth)", () => {
  // An open test no longer re-derives the tab; the stored status is moved when the event is
  // logged (stageAfterEvent), so an Interview row with an open test still reads Interview.
  assert.equal(deriveStage("Interview"), "interview");
  assert.equal(tabOfRow("Interview"), "interview");
  assert.equal(deriveStage("Ready to submit"), "saved");
  assert.equal(deriveStage("Applied"), "applied");
  assert.equal(deriveStage("interview"), "interview");
  assert.equal(deriveStage("nonsense"), "applied", "an unreadable status falls back to applied");
  assert.equal(STAGE_LABELS.take_home, "Take-home");
});

test("stageAfterEvent: an interview moves a row that has not reached Interview", () => {
  // Every spelling reads (case-insensitive), including the stored "Ready to submit".
  for (const from of ["saved", "applied", "screening", "assessment", "Ready to submit", "Applied", "Screening"]) {
    assert.equal(stageAfterEvent(from, "interview"), "interview", from);
  }
  // Already at or past interview, or finished: no move.
  for (const from of ["interview", "Interview", "offer", "accepted", "rejected", "withdrawn", "ghosted"]) {
    assert.equal(stageAfterEvent(from, "interview"), null, from);
  }
});

test("stageAfterEvent: a test moves only an Applied or Screening row to Assessment", () => {
  for (const kind of ["assessment", "take_home"]) {
    assert.equal(stageAfterEvent("applied", kind), "assessment", kind);
    assert.equal(stageAfterEvent("screening", kind), "assessment", kind);
    // A "Ready to submit" row stays: the test is a task to finish before applying.
    assert.equal(stageAfterEvent("saved", kind), null, kind);
    assert.equal(stageAfterEvent("Ready to submit", kind), null, kind);
    assert.equal(stageAfterEvent("interview", kind), null, kind);
    assert.equal(stageAfterEvent("assessment", kind), null, kind);
    for (const ended of ["offer", "accepted", "rejected", "withdrawn", "ghosted"]) assert.equal(stageAfterEvent(ended, kind), null, `${kind} ${ended}`);
  }
});

test("stageAfterEvent: every other kind, and an unreadable status, moves nothing", () => {
  for (const kind of ["networking", "reminder", "follow_up", "deadline", "video", "work_trial", "screening_call", "screening_questions", "offer_deadline", "mystery"]) {
    assert.equal(stageAfterEvent("applied", kind), null, kind);
  }
  assert.equal(stageAfterEvent(null, "interview"), null);
  assert.equal(stageAfterEvent("gibberish", "interview"), null);
});

test("every row counts once, by stored status: the tabs add up to the total", () => {
  const statuses = ["Ready to submit", "Applied", "Applied", "Screening", "Interview", "interview", "assessment", "Offer", "accepted", "Rejected", "Withdrawn", "ghosted"];
  const rows = statuses.map((status, i) => ({ id: `r${i}`, status }));
  const counts = tabCounts(rows);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
  assert.deepEqual(counts, { to_submit: 1, applied: 2, screening: 1, interview: 2, assessment: 1, offer: 1, won: 1, closed: 3 });
});

test("the three optional tabs appear only with something in them", () => {
  const empty = { to_submit: 1, applied: 1, screening: 0, interview: 1, assessment: 0, offer: 0, won: 0, closed: 1 };
  assert.deepEqual(visibleTabs(empty), ["to_submit", "applied", "screening", "interview", "closed"]);
  assert.deepEqual(visibleTabs({ ...empty, assessment: 2, won: 1 }), ["to_submit", "applied", "screening", "interview", "assessment", "won", "closed"]);
  assert.deepEqual(visibleTabs(empty, "offer"), ["to_submit", "applied", "screening", "interview", "offer", "closed"], "the tab you are on stays");
});

test("the page opens on Interview, else the furthest stage with something in it", () => {
  const none = { to_submit: 0, applied: 0, screening: 0, interview: 0, assessment: 0, offer: 0, won: 0, closed: 0 };
  assert.equal(defaultTab({ ...none, interview: 1, applied: 5 }), "interview");
  assert.equal(defaultTab({ ...none, applied: 5, screening: 1 }), "screening");
  assert.equal(defaultTab(none), "applied");
  assert.equal(tabForStatus("Rejected"), "closed");
  assert.equal(tabForStatus("accepted"), "won");
  assert.equal(tabForStatus("nonsense"), null);
});

test("the tab logic treats 'interview' and 'Interview' alike (case-insensitive read)", () => {
  // Shekar's rows hold both spellings (606 lower-case, 951 capitalised on 22 Nov); JH-3
  // normalises writes. The read side must count and place them together.
  for (const [lower, upper] of [["interview", "Interview"], ["screening", "Screening"], ["assessment", "Assessment"], ["saved", "Ready to submit"]] as const) {
    assert.equal(tabOfRow(lower), tabOfRow(upper), `${lower}/${upper}`);
    assert.equal(tabForStatus(lower), tabForStatus(upper), `${lower}/${upper}`);
  }
  const mixed = tabCounts([{ id: "a", status: "interview" }, { id: "b", status: "Interview" }]);
  assert.equal(mixed.interview, 2, "both spellings count in the same tab");
});

test("past stages, and where a new row starts", () => {
  assert.equal(reachedTab(["applied", "interview", "rejected"], "interview"), true);
  assert.equal(reachedTab(["applied", "screening", "rejected"], "closed"), false, "a rejection on record is not a row that is Closed now");
  assert.equal(reachedTab(["applied"], "interview"), false);
  assert.equal(reachedTab(null, "interview"), false);
  assert.equal(statusForNewRow("to_submit"), "saved");
  assert.equal(statusForNewRow("won"), "accepted");
  assert.equal(statusForNewRow("closed"), "applied");
  assert.equal(statusForNewRow("all"), "applied");
});

test("the one-click update is offered only when the status and the stage disagree", () => {
  assert.equal(statusToMatch("Interview", "take_home"), "assessment");
  assert.equal(statusToMatch("Screening", "video"), "assessment");
  assert.equal(statusToMatch("assessment", "take_home"), null, "already there");
  assert.equal(statusToMatch("Interview", "interview"), null);
});

test("due soon runs to the end of tomorrow where the user is", () => {
  assert.equal(new Date(dueSoonCutoff(NOW)).toISOString(), "2026-11-06T00:00:00.000Z");
  assert.equal(urgencyOf(ev({ due_at: "2026-11-05T23:59:00Z" }), NOW), "red");
  assert.equal(urgencyOf(ev({ due_at: "2026-11-06T00:00:00Z" }), NOW), "amber");
  assert.equal(urgencyOf(ev({ due_at: "2026-11-07T18:00:00Z" }), NOW), "amber", "inside 72 hours");
  assert.equal(urgencyOf(ev({ due_at: "2026-11-07T18:31:00Z" }), NOW), "none", "just past 72 hours");
  assert.equal(urgencyOf(ev({ due_at: "2026-11-03T10:00:00Z" }), NOW), "red", "overdue");
  assert.equal(urgencyOf(ev({ status: "to_book" }), NOW), "none");
});

test("the next step reads its time and what it is", () => {
  const step = nextStepFor([ev({ kind: "interview", title: "Interview call", starts_at: "2026-11-05T08:30:00Z", ends_at: "2026-11-05T08:50:00Z" })], NOW);
  assert.ok(step);
  assert.match(step.when ?? "", /Thu 5 Nov, 08:30/);
  assert.match(step.line, /^Interview call · /);
  assert.equal(step.urgency, "red");
  assert.equal(step.deadline, null);
  assert.equal(nextStepFor([], NOW), null);
  assert.equal(nextStepFor([ev({ status: "done", due_at: "2026-11-05T08:30:00Z" })], NOW), null);
});

test("next event and deadline print once when they are the same", () => {
  const same = nextStepFor([ev({ due_at: "2026-11-05T20:30:00Z" })], NOW);
  assert.ok(same);
  assert.equal(same.deadline, null, "one event is both");
  const sameTime = nextStepFor([ev({ id: "a", kind: "interview", starts_at: "2026-11-09T10:00:00Z" }), ev({ id: "b", kind: "deadline", title: "Form", due_at: "2026-11-09T10:00:00Z" })], NOW);
  assert.ok(sameTime);
  assert.equal(sameTime.deadline, null, "two events at one time print one time");
});

test("a later, different deadline is kept", () => {
  const step = nextStepFor([ev({ id: "a", kind: "interview", title: "Call", starts_at: "2026-11-05T08:30:00Z" }), ev({ id: "b", kind: "deadline", title: "Form", due_at: "2026-11-09T23:59:00Z", date_only: true })], NOW);
  assert.ok(step);
  assert.match(step.deadline ?? "", /9 Nov/);
  assert.equal(step.event.id, "a");
});

test("two items due together read as one, and an undated item says so", () => {
  const at = "2026-11-05T18:40:00Z";
  const step = nextStepFor([ev({ id: "a", kind: "take_home", title: "Hireflix", due_at: at }), ev({ id: "b", title: "Criteria test", due_at: at })], NOW);
  assert.ok(step);
  assert.match(step.line, /^Hireflix \+ Criteria test · /);
  assert.equal(step.name, "Hireflix + Criteria test");
  assert.match(step.left, /^due in/, "the time left is its own half, so a long name never hides it");
  const undated = nextStepFor([ev({ status: "to_book", title: "HackerRank" })], NOW);
  assert.ok(undated);
  assert.equal(undated.when, null);
  assert.equal(undated.line, "HackerRank", "the cell's first line already says there is no date");
});

test("red is always the warning tile, so urgency is never colour alone", () => {
  assert.equal(nextStepIcon("interview", "red"), "alert");
  assert.equal(nextStepIcon("interview", "none"), "users");
  assert.equal(nextStepIcon("assessment", "amber"), "clipboard");
  assert.equal(nextStepIcon("video", "none"), "video");
  assert.equal(nextStepIcon("deadline", "none"), "clock");
});

test("the button opens the open test on the row, not the row's next step", () => {
  const interview = ev({ id: "call", kind: "interview", starts_at: "2026-11-05T10:00:00Z", location_or_link: "https://example.com/zoom" });
  const test = ev({ id: "test", kind: "take_home", due_at: "2026-11-10T10:00:00Z" });
  assert.equal(stageEvent("assessment", [interview, test])?.id, "test");
  assert.equal(nextStepFor([interview, test], NOW)?.event.id, "call", "the next step is still the interview");
  assert.equal(stageEvent("rejected", [test]), null, "a finished row shows no test button");
});

test("something overdue is never hidden behind a later item", () => {
  const overdue = ev({ id: "late", title: "Overdue test", due_at: "2026-11-02T10:00:00Z" });
  const later = ev({ id: "call", kind: "interview", title: "Call", starts_at: "2026-11-12T10:00:00Z" });
  const step = nextStepFor([later, overdue], NOW);
  assert.ok(step);
  assert.equal(step.event.id, "late", "Mark done reaches it");
  assert.equal(step.urgency, "red");
  const undated = nextStepFor([ev({ id: "undated", status: "to_book" }), overdue], NOW);
  assert.equal(undated?.event.id, "late");
});

test("a date-only deadline reads in its own zone", () => {
  const step = nextStepFor(
    [ev({ id: "a", kind: "interview", title: "Call", starts_at: "2026-11-05T10:00:00Z" }), ev({ id: "b", kind: "deadline", title: "Form", due_at: "2026-11-10T04:59:00Z", date_only: true, timezone: "America/New_York" })],
    NOW,
    "Europe/London"
  );
  assert.match(step?.deadline ?? "", /9 Nov/);
});

test("the one button a stage gets", () => {
  assert.deepEqual(primaryAction("interview"), { kind: "prep" });
  assert.deepEqual(primaryAction("assessment"), { kind: "test" });
  assert.deepEqual(primaryAction("take_home"), { kind: "test" });
  assert.deepEqual(primaryAction("work_trial"), { kind: "test" });
  assert.deepEqual(primaryAction("video"), { kind: "record" });
  assert.deepEqual(primaryAction("saved"), { kind: "submit" });
  for (const stage of ["applied", "screening", "offer", "accepted", "rejected"] as const) assert.equal(primaryAction(stage), null);
});

const row = (over: Record<string, unknown>) => ({ id: "r", status: "Applied", followup_date: null, source: "tailored", ...over }) as never;

test("the attention counts", () => {
  const rows = [
    row({ id: "soon", status: "Interview", has_job_description: true }),
    row({ id: "later", status: "Interview", has_job_description: true }),
    row({ id: "chase", status: "Applied", followup_date: "2026-11-02" }),
    row({ id: "later_this_week", status: "Applied", followup_date: "2026-11-08" }),
    row({ id: "last_week", status: "Applied", followup_date: "2026-11-01" }),
    row({ id: "future", status: "Applied", followup_date: "2026-12-01" }),
    row({ id: "closed", status: "Rejected", followup_date: "2026-11-01" }),
    row({ id: "unsent", status: "Applied", notes_not_submitted: true }),
    row({ id: "nojd", status: "Screening", has_job_description: false }),
  ];
  const events = [
    ev({ id: "1", application_id: "soon", due_at: "2026-11-05T18:40:00Z" }),
    ev({ id: "2", application_id: "soon", due_at: "2026-11-05T18:40:00Z" }),
    ev({ id: "3", application_id: "later", due_at: "2026-11-20T10:00:00Z" }),
    ev({ id: "4", application_id: null, kind: "networking", starts_at: "2026-11-05T10:00:00Z" }),
    ev({ id: "5", application_id: "soon", status: "done", due_at: "2026-11-05T10:00:00Z" }),
  ];
  const c = attentionCounts(rows, events, "2026-11-04", NOW);
  assert.equal(c.dueSoon, 1, "two items due together on one row read as one, as in its Next step");
  assert.equal(c.dueSoonRows, 1);
  assert.equal(c.followups, 2, "this week's (Mon 2 to Sun 8 Nov): never last week's, never next month's, never on a closed row");
  assert.equal(c.statusToFix, 1);
  assert.equal(c.attachmentsToFix, 1);
  assert.equal(c.dataToFix, 2, "the two lists never overlap, so the card is their sum");
  assert.equal(isDataToFix(row({ status: "Screening", notes_not_submitted: true, has_job_description: true })), false, "notes matter only on an Applied row");
});

test("two items at different times on a row are two things to do", () => {
  const rows = [row({ id: "soon", status: "Interview" })];
  const events = [ev({ id: "1", application_id: "soon", due_at: "2026-11-05T10:00:00Z" }), ev({ id: "2", application_id: "soon", due_at: "2026-11-05T18:40:00Z" })];
  const c = attentionCounts(rows, events, "2026-11-04", NOW);
  assert.equal(c.dueSoon, 2);
  assert.equal(c.dueSoonRows, 1);
});

test("the Req ID is read once, from its field or the role", () => {
  assert.equal(reqIdOf({ role: "AI Engineer, Forensic (Req 25246, London hybrid)" }), "25246");
  assert.equal(reqIdOf({ role: "Software Engineer (RQ117289), Sunbury" }), "RQ117289");
  assert.equal(reqIdOf({ role: "Associate Software Engineer (15413), London" }), "15413");
  assert.equal(reqIdOf({ role: "Engineer", req_id: "#777" }), "777");
  assert.equal(reqIdOf({ role: "Engineer" }), null);
  assert.equal(shortRole("AI Engineer, Forensic and Financial Crime (Req 25246)"), "AI Engineer");
  assert.equal(shortRole("Software Engineer - Platform"), "Software Engineer");
  assert.equal(roleLine({ role: "Engineer (Req 25246)", req_id: "25246" }), "Engineer (Req 25246)", "never twice");
  assert.equal(roleLine({ role: "Engineer", req_id: "25246" }), "Engineer · Req 25246");
  assert.equal(roleLine({ role: "Engineer" }), "Engineer");
});

test("the referral card: the oldest open ask, with how many more", () => {
  const ask = (over: Record<string, unknown>) => ({ id: "x", company_name: "Acme", role: "AI Engineer, Data (Req 25246, London)", date_applied: "2026-11-02", referral: true, referral_status: "offered", ...over }) as never;
  const one = referralCard([ask({ id: "new", date_applied: "2026-11-03", company_name: "Later" }), ask({ id: "old" })]);
  assert.deepEqual(one, { id: "old", title: "Acme · AI Engineer (25246)", since: "2026-11-02", more: 1 });
  assert.equal((one?.title.match(/25246/g) ?? []).length, 1);
  assert.equal(referralCard([ask({ referral_status: "applied" })]), null);
  assert.equal(referralCard([]), null);
});
