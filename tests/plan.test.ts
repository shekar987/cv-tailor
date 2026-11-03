// The "What's next" plan's rules (lib/plan, lib/planTime). node:test, zero deps.
// Companies and times are made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeEvents, activeApplications, bookingReply, buildFunnel, buildPlan, funnelChartData, conflictsFor, daysSinceContact, eventDays, feedbackRequest, findConflicts, followUpNudge,
  nextEventByApplication, priorityScore, readEventInput, readWindowInput, stageWeight, suggestSlots, windowOnDay,
  type AvailabilityWindow, type PlanApplication, type PlanEvent,
} from "../src/lib/plan.ts";
import { safeNextPath } from "../src/lib/safeNext.ts";
import { addDays, clockTime, countdown, dayKey, formatWhen, isValidTimeZone, mondayOf, weekdayOf, zonedTimeToMs } from "../src/lib/planTime.ts";

const LONDON = "Europe/London";
const at = (date: string, time: string, tz = LONDON) => new Date(zonedTimeToMs(date, time, tz)).toISOString();
// Tue 3 Nov 2026, 09:00.
const NOW = zonedTimeToMs("2026-11-03", "09:00", LONDON);

function ev(id: string, over: Partial<PlanEvent> = {}): PlanEvent {
  return { id, application_id: "a1", kind: "interview", title: id, status: "scheduled", ...over };
}
function app(id: string, status: string, over: Partial<PlanApplication> = {}): PlanApplication {
  return { id, company_name: id, role: "Engineer", status, date_applied: "2026-10-01", ...over };
}

// ── Time ─────────────────────────────────────────────────────────────────────

test("a wall-clock time means the right instant either side of the clock change", () => {
  assert.equal(at("2026-10-24", "10:00"), "2026-10-24T09:00:00.000Z", "BST");
  assert.equal(at("2026-10-26", "10:00"), "2026-10-26T10:00:00.000Z", "GMT");
  assert.equal(at("2027-03-27", "10:00"), "2027-03-27T10:00:00.000Z", "still GMT");
  assert.equal(at("2027-03-29", "10:00"), "2027-03-29T09:00:00.000Z", "BST again");
});

test("a time the clocks repeat is the first; a time they skip moves forward", () => {
  assert.equal(at("2026-10-25", "01:30"), "2026-10-25T00:30:00.000Z", "the BST 01:30");
  assert.equal(clockTime(zonedTimeToMs("2027-03-28", "01:30", LONDON), LONDON), "02:30");
});

test("the brief's CET slot is an hour behind in the UK", () => {
  const cet = zonedTimeToMs("2026-11-04", "12:00", "Europe/Paris");
  assert.equal(clockTime(cet, LONDON), "11:00");
});

test("a day key belongs to the zone, not to UTC", () => {
  const lateEvening = Date.UTC(2026, 6, 1, 23, 30);
  assert.equal(dayKey(lateEvening, LONDON), "2026-07-02", "00:30 BST is the next day");
  assert.equal(dayKey(lateEvening, "UTC"), "2026-07-01");
});

test("weeks run Monday to Sunday", () => {
  assert.equal(weekdayOf("2026-11-04"), 3);
  assert.equal(weekdayOf("2026-11-08"), 7);
  assert.equal(mondayOf("2026-11-08"), "2026-11-02");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("the countdown says what is left in words", () => {
  assert.equal(countdown(NOW + 200 * 60_000, NOW), "in 3h 20m");
  assert.equal(countdown(NOW + 48 * 3600_000, NOW, { due: true }), "due in 2 days");
  assert.equal(countdown(NOW - 2 * 3600_000, NOW), "2h overdue");
  assert.equal(countdown(NOW + 30 * 60_000, NOW), "in 30m");
});

test("a deadline with no stated time counts in days, never made-up hours", () => {
  const due = zonedTimeToMs("2026-11-10", "23:59", LONDON);
  assert.equal(countdown(due, NOW, { dateOnly: true, tz: LONDON }), "due in 7 days");
  assert.equal(formatWhen(due, LONDON, true), "Tue 10 Nov");
  assert.equal(countdown(zonedTimeToMs("2026-11-03", "23:59", LONDON), NOW, { dateOnly: true, tz: LONDON }), "due today");
});

test("a bad zone is refused", () => {
  assert.ok(isValidTimeZone(LONDON));
  assert.ok(!isValidTimeZone("Mars/Olympus"));
  assert.ok(!isValidTimeZone(""));
});

// ── The active rule ──────────────────────────────────────────────────────────

test("a rejected application is never in the plan, and its events come back with it", () => {
  const events = [ev("call", { starts_at: at("2026-11-04", "10:00") })];
  for (const status of ["rejected", "withdrawn", "ghosted", "accepted", "applied", "saved", "Rejected", "Withdrawn"]) {
    assert.deepEqual(activeEvents(events, [app("a1", status)]), [], status);
    const plan = buildPlan({ events, applications: [app("a1", status)], now: NOW });
    assert.equal(plan.ordered.length, 0, status);
    assert.equal(plan.waiting.length, 0, status);
  }
  for (const status of ["screening", "interview", "assessment", "offer", "Screening", "Interview", "Offer"]) {
    assert.equal(activeEvents(events, [app("a1", status)]).length, 1, status);
  }
});

test("only open events count; a networking call needs no application", () => {
  const apps = [app("a1", "interview")];
  for (const status of ["done", "cancelled", "missed"] as const) assert.deepEqual(activeEvents([ev("x", { status })], apps), [], status);
  assert.equal(activeEvents([ev("x", { application_id: null, kind: "networking" })], []).length, 1);
  assert.deepEqual(activeEvents([ev("x", { application_id: "elsewhere" })], apps), [], "an application not read is not live");
  assert.deepEqual(activeApplications([app("a", "screening"), app("b", "rejected")]).map((a) => a.id), ["a"]);
});

// ── Priority ─────────────────────────────────────────────────────────────────

test("overdue beats everything, and sooner beats later", () => {
  const overdue = priorityScore(ev("o", { kind: "follow_up", due_at: at("2026-11-02", "09:00") }), "screening", NOW);
  const soon = priorityScore(ev("s", { kind: "offer_deadline", due_at: at("2026-11-03", "12:00") }), "offer", NOW);
  const later = priorityScore(ev("l", { starts_at: at("2026-11-03", "18:00") }), "interview", NOW);
  const nextWeek = priorityScore(ev("n", { starts_at: at("2026-11-12", "10:00") }), "interview", NOW);
  assert.ok(overdue > soon && soon > later && later > nextWeek);
});

test("at the same time the stage decides: offer, final, interview, assessment, screening, follow-up", () => {
  const when = { starts_at: at("2026-11-03", "15:00") };
  const score = (over: Partial<PlanEvent>, status = "interview") => priorityScore(ev("x", { ...when, ...over }), status, NOW);
  const order = [
    score({ kind: "offer_deadline" }, "offer"),
    score({ kind: "interview", stage_label: "Final round" }),
    score({ kind: "interview", stage_label: "Round 2: technical" }),
    score({ kind: "take_home" }, "assessment"),
    score({ kind: "screening_call" }, "screening"),
    score({ kind: "follow_up" }, "screening"),
  ];
  assert.deepEqual([...order].sort((a, b) => b - a), order);
  assert.equal(stageWeight({ kind: "assessment" }, "offer"), 100, "any event on an offer is about the offer");
});

test("an unanswered slot offer ranks just under the next 24 hours and above everything later", () => {
  const toBook = priorityScore(ev("b", { kind: "screening_call", status: "to_book" }), "screening", NOW);
  const today = priorityScore(ev("t", { kind: "follow_up", starts_at: at("2026-11-03", "23:00") }), "screening", NOW);
  const dayAfter = priorityScore(ev("d", { kind: "offer_deadline", due_at: at("2026-11-05", "09:00") }), "offer", NOW);
  assert.ok(today > toBook, "today's events stay first");
  assert.ok(toBook > dayAfter, "it outranks later, even an offer");
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("the plan groups by the user's own days, in priority order", () => {
  const applications = [app("a1", "interview"), app("a2", "screening")];
  const events = [
    ev("overdue", { due_at: at("2026-11-02", "12:00"), kind: "deadline" }),
    ev("today", { starts_at: at("2026-11-03", "16:00") }),
    ev("tomorrow", { starts_at: at("2026-11-04", "10:10") }),
    ev("thisweek", { starts_at: at("2026-11-08", "10:00") }),
    ev("nextweek", { starts_at: at("2026-11-09", "10:00") }),
    ev("later", { starts_at: at("2026-11-20", "10:00") }),
    ev("book", { status: "to_book", application_id: "a2", kind: "screening_call" }),
  ];
  const plan = buildPlan({ events, applications, now: NOW });
  assert.deepEqual(plan.groups.map((g) => [g.key, g.items.map((i) => i.event.id)]), [
    ["overdue", ["overdue"]], ["today", ["today"]], ["tomorrow", ["tomorrow"]], ["this_week", ["thisweek"]], ["next_week", ["nextweek"]], ["later", ["later"]],
  ]);
  assert.deepEqual(plan.needsBooking.map((i) => i.event.id), ["book"]);
  assert.deepEqual(plan.ordered.map((i) => i.event.id), ["overdue", "today", "book", "tomorrow", "thisweek", "nextweek", "later"]);
  assert.equal(plan.nextUp?.event.id, "today");
});

test("a booking stays in order with no event today", () => {
  const plan = buildPlan({
    events: [ev("o", { due_at: at("2026-11-02", "12:00"), kind: "deadline" }), ev("n", { starts_at: at("2026-11-05", "10:00") }), ev("b", { status: "to_book" })],
    applications: [app("a1", "interview")],
    now: NOW,
  });
  assert.deepEqual(plan.ordered.map((i) => i.event.id), ["o", "b", "n"]);
});

test("a call in progress is today, not overdue", () => {
  const plan = buildPlan({ events: [ev("live", { starts_at: at("2026-11-03", "08:45"), ends_at: at("2026-11-03", "09:30") })], applications: [app("a1", "interview")], now: NOW });
  assert.equal(plan.groups[0].key, "today");
  assert.equal(plan.nextUp?.event.id, "live");
});

test("a to_book event with a time is not on the timeline", () => {
  const plan = buildPlan({ events: [ev("b", { status: "to_book", starts_at: at("2026-11-04", "10:00") })], applications: [app("a1", "interview")], now: NOW });
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.needsBooking.length, 1);
  assert.equal(plan.nextUp, null);
});

test("Waiting on them: active rows with nothing booked, longest silence first, with the nudge", () => {
  const applications = [
    app("recent", "screening", { date_applied: "2026-11-01" }),
    app("week", "screening", { date_applied: "2026-10-26" }),
    app("old", "interview", { date_applied: "2026-10-01" }),
    app("contacted", "screening", { date_applied: "2026-09-01", last_contact_at: at("2026-11-02", "10:00") }),
    app("booked", "interview", { date_applied: "2026-09-01" }),
    app("gone", "rejected", { date_applied: "2026-09-01" }),
  ];
  const plan = buildPlan({ events: [ev("x", { application_id: "booked", starts_at: at("2026-11-04", "10:00") })], applications, now: NOW });
  assert.deepEqual(plan.waiting.map((w) => [w.application.id, w.daysSinceContact, w.nudge]), [
    ["old", 33, 21], ["week", 8, 7], ["recent", 2, null], ["contacted", 1, null],
  ]);
});

test("the nudge lands on T+7, T+14 and T+21", () => {
  assert.deepEqual([6, 7, 13, 14, 20, 21, 90, null].map(followUpNudge), [null, 7, 7, 14, 14, 21, 21, null]);
  assert.equal(daysSinceContact({ date_applied: "not a date" }, NOW, LONDON), null);
});

// ── Conflicts ────────────────────────────────────────────────────────────────

const busy = (date: string, start: string, end: string, label = "Shift"): AvailabilityWindow => ({ id: `${date}${start}`, date, start_time: start, end_time: end, kind: "busy", label });

test("an overlap is an overlap; a gap under 30 minutes is too close; 30 minutes is fine", () => {
  const a = ev("a", { starts_at: at("2026-11-04", "10:00"), ends_at: at("2026-11-04", "11:00") });
  const overlap = ev("b", { starts_at: at("2026-11-04", "10:30"), ends_at: at("2026-11-04", "11:30") });
  const close = ev("c", { starts_at: at("2026-11-04", "11:20"), ends_at: at("2026-11-04", "12:00") });
  const clear = ev("d", { starts_at: at("2026-11-04", "11:30"), ends_at: at("2026-11-04", "12:00") });
  assert.equal(conflictsFor(a, [overlap], [])[0].kind, "overlap");
  const near = conflictsFor(a, [close], [])[0];
  assert.equal(near.kind, "too_close");
  assert.equal(near.gapMinutes, 20);
  assert.deepEqual(conflictsFor(a, [clear], []), []);
});

test("an event inside a shift is flagged, and so is one the shift runs up to", () => {
  const windows = [busy("2026-11-06", "12:00", "16:00")];
  const inside = ev("a", { starts_at: at("2026-11-06", "13:00"), ends_at: at("2026-11-06", "13:30") });
  const after = ev("b", { starts_at: at("2026-11-06", "16:10"), ends_at: at("2026-11-06", "16:40") });
  const clear = ev("c", { starts_at: at("2026-11-06", "16:30"), ends_at: at("2026-11-06", "17:00") });
  assert.equal(conflictsFor(inside, [], windows)[0].kind, "busy");
  assert.equal(conflictsFor(inside, [], windows)[0].window?.label, "Shift");
  assert.equal(conflictsFor(after, [], windows)[0].gapMinutes, 10);
  assert.deepEqual(conflictsFor(clear, [], windows), []);
});

test("a call with no end still takes time", () => {
  const a = ev("a", { kind: "screening_call", starts_at: at("2026-11-04", "10:00") });
  const b = ev("b", { kind: "screening_call", starts_at: at("2026-11-04", "10:20") });
  assert.equal(conflictsFor(a, [b], [])[0].kind, "overlap");
});

test("deadlines and slot offers cannot clash; done events do not count", () => {
  const a = ev("a", { starts_at: at("2026-11-04", "10:00") });
  assert.deepEqual(conflictsFor(ev("d", { kind: "deadline", due_at: at("2026-11-04", "10:00") }), [a], []), []);
  assert.deepEqual(conflictsFor(ev("o", { status: "to_book", starts_at: at("2026-11-04", "10:00") }), [a], []), []);
  assert.deepEqual(conflictsFor(a, [ev("x", { status: "done", starts_at: at("2026-11-04", "10:00") })], []), []);
  assert.deepEqual(conflictsFor(a, [{ ...a }], []), [], "not with itself");
});

test("each clash is listed once", () => {
  const a = ev("a", { starts_at: at("2026-11-04", "10:00") });
  const b = ev("b", { starts_at: at("2026-11-04", "10:15") });
  assert.equal(findConflicts([a, b], []).length, 1);
});

test("a weekly window keeps its wall-clock time across the clock change", () => {
  const weekly: AvailabilityWindow = { id: "w", weekday: 6, start_time: "09:00", end_time: "10:00", kind: "busy" };
  assert.equal(windowOnDay(weekly, "2026-10-24")?.start, Date.UTC(2026, 9, 24, 8), "Saturday in BST");
  assert.equal(windowOnDay(weekly, "2026-10-31")?.start, Date.UTC(2026, 9, 31, 9), "Saturday in GMT");
  assert.equal(windowOnDay(weekly, "2026-10-26"), null, "not on a Monday");
  const inGmt = ev("a", { starts_at: at("2026-10-31", "09:15"), ends_at: at("2026-10-31", "09:45") });
  assert.equal(conflictsFor(inGmt, [], [weekly]).length, 1);
  const inUtcTerms = ev("b", { starts_at: "2026-10-24T09:20:00.000Z", ends_at: "2026-10-24T09:40:00.000Z" });
  assert.equal(conflictsFor(inUtcTerms, [], [weekly]).length, 1, "10:20 BST is within the buffer of a 10:00 BST end");
});

test("a call in another zone clashes at its real time", () => {
  const paris = ev("a", { starts_at: at("2026-11-04", "12:00", "Europe/Paris"), ends_at: at("2026-11-04", "12:30", "Europe/Paris") });
  assert.equal(conflictsFor(paris, [], [busy("2026-11-04", "10:45", "11:15")]).length, 1, "11:00 UK is inside it");
  assert.deepEqual(conflictsFor(paris, [], [busy("2026-11-04", "12:00", "12:30")]), [], "12:00 Paris is not 12:00 UK");
});

// ── Slots ────────────────────────────────────────────────────────────────────

test("free windows minus busy time and events, with the buffer", () => {
  const windows: AvailabilityWindow[] = [
    { id: "f1", date: "2026-11-05", start_time: "14:30", end_time: "20:00", kind: "free" },
    busy("2026-11-05", "10:00", "15:00", "Placement"),
  ];
  const events = [ev("x", { starts_at: at("2026-11-05", "17:00"), ends_at: at("2026-11-05", "17:30") })];
  const { slots, usedDefaultHours } = suggestSlots({ windows, events, now: NOW });
  assert.equal(usedDefaultHours, false);
  assert.deepEqual(slots.map((s) => [clockTime(s.start, LONDON), clockTime(s.end, LONDON)]), [["15:30", "16:30"], ["18:00", "20:00"]]);
});

test("three to five slots, one a day before a second on any day", () => {
  const windows: AvailabilityWindow[] = [3, 4, 5, 6, 7].map((d) => ({ id: `d${d}`, weekday: d, start_time: "10:00", end_time: "12:00", kind: "free" as const }));
  const { slots } = suggestSlots({ windows, events: [], now: NOW });
  assert.equal(slots.length, 5);
  assert.equal(new Set(slots.map((s) => dayKey(s.start, LONDON))).size, 5);
});

test("no free windows: weekdays 09:00 to 17:30, and it says so", () => {
  const { slots, usedDefaultHours } = suggestSlots({ windows: [], events: [], now: NOW });
  assert.equal(usedDefaultHours, true);
  assert.equal(slots.length, 5);
  for (const s of slots) assert.ok(weekdayOf(dayKey(s.start, LONDON)) <= 5);
  assert.equal(clockTime(slots[0].start, LONDON), "09:30", "today starts after the buffer from now");
});

test("nothing in the past, and nothing too short", () => {
  const windows: AvailabilityWindow[] = [{ id: "f", date: "2026-11-03", start_time: "08:00", end_time: "09:10", kind: "free" }];
  assert.deepEqual(suggestSlots({ windows, events: [], now: NOW }).slots, []);
  const short: AvailabilityWindow[] = [{ id: "f", date: "2026-11-05", start_time: "10:00", end_time: "10:20", kind: "free" }];
  assert.deepEqual(suggestSlots({ windows: short, events: [], now: NOW }).slots, []);
});

test("offered slots: only the free ones, soonest first", () => {
  const offered = [
    { starts_at: at("2026-11-04", "13:30"), ends_at: null },
    { starts_at: at("2026-11-04", "11:00"), ends_at: null },
    { starts_at: at("2026-11-04", "12:30"), ends_at: null },
    { starts_at: at("2026-11-02", "12:30"), ends_at: null },
  ];
  const events = [ev("x", { starts_at: at("2026-11-04", "10:10"), ends_at: at("2026-11-04", "10:30") }), ev("y", { starts_at: at("2026-11-04", "13:00"), ends_at: at("2026-11-04", "13:15") })];
  const { slots } = suggestSlots({ windows: [], events, now: NOW, offered });
  assert.deepEqual(slots.map((s) => [clockTime(s.start, LONDON), s.offered]), [["11:00", true]], "12:30 and 13:30 fall inside the buffer of the 13:00 call");
});

test("the reply reads as British English and names each slot in full", () => {
  const start = zonedTimeToMs("2026-11-04", "15:00", LONDON);
  const end = zonedTimeToMs("2026-11-04", "17:00", LONDON);
  const one = bookingReply([{ start, end, offered: false }]);
  assert.match(one, /I'm available on Wednesday 4 November from 15:00 to 17:00 \(UK time\)/);
  const two = bookingReply([{ start, end, offered: false }, { start: start + 86_400_000, end: end + 86_400_000, offered: true }]);
  assert.match(two, /- Wednesday 4 November from 15:00 to 17:00/);
  assert.match(two, /- Thursday 5 November at 15:00/);
  assert.match(two, /Kind regards,$/);
  assert.equal(bookingReply([]), "");
});

test("the feedback request names the role and asks, nothing more", () => {
  assert.match(feedbackRequest("Acme", "Engineer"), /the Engineer role at Acme/);
  assert.match(feedbackRequest("", ""), /about the role\./);
});

// ── Funnel ───────────────────────────────────────────────────────────────────

test("the funnel follows the stages a row really reached", () => {
  const rows: Pick<PlanApplication, "status" | "stages_reached">[] = [
    { status: "applied", stages_reached: ["applied"] },
    { status: "rejected", stages_reached: ["applied", "rejected"] },
    { status: "rejected", stages_reached: ["applied", "screening", "rejected"] },
    { status: "ghosted", stages_reached: ["applied", "screening", "interview", "ghosted"] },
    { status: "assessment", stages_reached: ["applied", "assessment"] },
    { status: "accepted", stages_reached: ["applied", "screening", "interview", "offer", "accepted"] },
    { status: "saved", stages_reached: ["saved"] },
    { status: "withdrawn", stages_reached: ["applied", "withdrawn"] },
  ];
  const f = buildFunnel(rows);
  assert.equal(f.total, 6);
  assert.equal(f.excluded, 2);
  const node = (key: string) => f.nodes.find((n) => n.key === key)!;
  assert.equal(node("applied").count, 6);
  assert.equal(node("screening").count, 3);
  assert.equal(node("interview").count, 2);
  assert.equal(node("assessment").count, 1);
  assert.equal(node("offer").count, 1);
  assert.equal(node("accepted").count, 1);
  assert.equal(node("applied").rejected, 1);
  assert.equal(node("screening").rejected, 1);
  assert.equal(node("interview").ghosted, 1);
  const link = (from: string, to: string) => f.links.find((l) => l.from === from && l.to === to)?.count;
  assert.equal(link("applied", "screening"), 3);
  assert.equal(link("applied", "assessment"), 1, "a row can skip stages");
  assert.equal(link("applied", "rejected"), 1);
  assert.equal(link("interview", "ghosted"), 1);
});

test("a row with no history still counts at its current stage; old labels read the same", () => {
  const f = buildFunnel([{ status: "Screening" }, { status: "Rejected" }, { status: "Interview", stages_reached: null }]);
  assert.equal(f.total, 3);
  assert.equal(f.nodes[1].count, 1);
  assert.equal(f.nodes[2].count, 1);
  assert.equal(f.rejected, 1);
});

test("a rate shows only from eight in the group", () => {
  const rows = (n: number, status: string, stages: string[]) => Array.from({ length: n }, () => ({ status, stages_reached: stages }));
  const seven = buildFunnel([...rows(5, "applied", ["applied"]), ...rows(2, "screening", ["applied", "screening"])]);
  assert.equal(seven.nodes[0].tooFew, true);
  assert.equal(seven.nodes[0].furtherRate, null);
  const eight = buildFunnel([...rows(6, "applied", ["applied"]), ...rows(2, "screening", ["applied", "screening"])]);
  assert.equal(eight.nodes[0].tooFew, false);
  assert.equal(eight.nodes[0].furtherRate, 0.25);
  assert.equal(eight.nodes[1].tooFew, true);
});

// ── Requests ─────────────────────────────────────────────────────────────────

test("an event needs a kind, a title and a time, unless it is still to book", () => {
  assert.ok("error" in readEventInput({ title: "x", starts_at: at("2026-11-04", "10:00") }, false));
  assert.ok("error" in readEventInput({ kind: "interview", starts_at: at("2026-11-04", "10:00") }, false));
  assert.ok("error" in readEventInput({ kind: "interview", title: "x" }, false));
  assert.ok("fields" in readEventInput({ kind: "interview", title: "x", status: "to_book" }, false));
  assert.ok("fields" in readEventInput({ kind: "deadline", title: "x", due_at: at("2026-11-10", "23:59"), date_only: true }, false));
});

test("bad values are refused; user_id and source are never read from a request", () => {
  assert.ok("error" in readEventInput({ kind: "party", title: "x", status: "to_book" }, false));
  assert.ok("error" in readEventInput({ status: "gone" }, true));
  assert.ok("error" in readEventInput({ starts_at: "tomorrow" }, true));
  assert.ok("error" in readEventInput({ timezone: "Mars/Olympus" }, true));
  assert.ok("error" in readEventInput({ title: "y".repeat(201) }, true));
  assert.ok("error" in readEventInput({ starts_at: at("2026-11-04", "10:00"), ends_at: at("2026-11-04", "09:00") }, true));
  assert.ok("error" in readEventInput({ offered_slots: [{ starts_at: "soon" }] }, true));
  const ok = readEventInput({ status: "done", user_id: "someone", source: "gmail", id: "x", application_id: "y" }, true);
  assert.deepEqual("fields" in ok ? ok.fields : null, { status: "done" });
});

test("a window is one day or one weekday, with an end after its start", () => {
  const base = { kind: "busy", start_time: "09:00", end_time: "10:00" };
  assert.ok("fields" in readWindowInput({ ...base, date: "2026-11-04" }));
  assert.ok("fields" in readWindowInput({ ...base, weekday: 3 }));
  assert.ok("error" in readWindowInput({ ...base }));
  assert.ok("error" in readWindowInput({ ...base, date: "2026-11-04", weekday: 3 }));
  assert.ok("error" in readWindowInput({ ...base, date: "2026-13-04" }));
  assert.ok("error" in readWindowInput({ ...base, weekday: 8 }));
  assert.ok("error" in readWindowInput({ ...base, kind: "maybe", date: "2026-11-04" }));
  assert.ok("error" in readWindowInput({ ...base, end_time: "08:00", date: "2026-11-04" }));
});

test("the calendar's dots and the stage tabs' next event", () => {
  const events = [
    ev("a", { application_id: "a1", starts_at: at("2026-11-04", "10:00") }),
    ev("b", { application_id: "a1", due_at: at("2026-11-06", "18:00"), kind: "deadline" }),
    ev("c", { application_id: "a2", starts_at: at("2026-10-01", "10:00") }),
    ev("d", { application_id: "a3", status: "done", starts_at: at("2026-11-05", "10:00") }),
    ev("e", { application_id: "a4", status: "to_book" }),
  ];
  assert.equal(eventDays(events).get("2026-11-04"), 1);
  assert.equal(eventDays(events).has("2026-11-05"), true);
  const next = nextEventByApplication(events, NOW);
  assert.equal(next.get("a1")?.next?.id, "a");
  assert.equal(next.get("a1")?.deadline?.id, "b");
  assert.equal(next.get("a2")?.next, null, "a long-past event is not next");
  assert.equal(next.has("a3"), false);
  assert.equal(next.get("a4")?.next?.id, "e");
});

test("the chart's links are valid node indexes, with no empty node or link", () => {
  const data = funnelChartData(buildFunnel([
    { status: "applied", stages_reached: ["applied"] },
    { status: "rejected", stages_reached: ["applied", "screening", "rejected"] },
  ]));
  assert.deepEqual(data.nodes.map((n) => n.key), ["applied", "screening", "rejected"]);
  for (const l of data.links) {
    assert.ok(data.nodes[l.source] && data.nodes[l.target]);
    assert.ok(l.value > 0);
  }
  assert.deepEqual(funnelChartData(buildFunnel([])).links, []);
  assert.deepEqual(funnelChartData(buildFunnel([])).nodes, []);
});

test("sign-in lands on the plan unless a page asked to come back", () => {
  assert.equal(safeNextPath(null), "/app/next");
  assert.equal(safeNextPath("https://evil.example/app"), "/app/next");
  assert.equal(safeNextPath("/applications"), "/applications");
});
