import { test } from "node:test";
import assert from "node:assert/strict";
import { actionableEvents, firstLink, guessEventKind, isSnoozed, snoozeUntil, sortActions, urgencyOf } from "../src/lib/actionCentre.ts";
import { readEventSource, type PlanEvent } from "../src/lib/plan.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const hours = (n: number) => new Date(NOW + n * 3_600_000).toISOString();
const ev = (over: Partial<PlanEvent>): PlanEvent => ({ id: "e", application_id: null, kind: "deadline", title: "A task", status: "scheduled", ...over });

test("red under 24 hours, amber under 72, green later, and a date with none says so", () => {
  assert.equal(urgencyOf(ev({ due_at: hours(23.9) }), NOW), "red");
  assert.equal(urgencyOf(ev({ due_at: hours(24) }), NOW), "amber");
  assert.equal(urgencyOf(ev({ due_at: hours(71.9) }), NOW), "amber");
  assert.equal(urgencyOf(ev({ due_at: hours(72) }), NOW), "green");
  assert.equal(urgencyOf(ev({ due_at: hours(-5) }), NOW), "red", "overdue is red");
  assert.equal(urgencyOf(ev({ starts_at: hours(2) }), NOW), "red", "an interview's start counts");
  assert.equal(urgencyOf(ev({ status: "to_book" }), NOW), "none");
});

test("only an application that has ended hides its events", () => {
  const applications = [
    { id: "applied", status: "Applied" },
    { id: "saved", status: "Ready to submit" },
    { id: "screen", status: "screening" },
    { id: "rejected", status: "Rejected" },
    { id: "withdrawn", status: "withdrawn" },
    { id: "ghosted", status: "ghosted" },
    { id: "won", status: "accepted" },
  ];
  const events = applications.map((a) => ev({ id: a.id, application_id: a.id, due_at: hours(1) }));
  const kept = actionableEvents([...events, ev({ id: "call", application_id: null, due_at: hours(1) }), ev({ id: "gone", application_id: "deleted", due_at: hours(1) })], applications).map((e) => e.id);
  assert.deepEqual(kept, ["applied", "saved", "screen", "call"], "an assessment on an Applied row is exactly what gets missed");
});

test("a finished event is never listed", () => {
  const events = (["done", "cancelled", "missed", "scheduled", "to_book"] as const).map((status) => ev({ id: status, status }));
  assert.deepEqual(actionableEvents(events, []).map((e) => e.id), ["scheduled", "to_book"]);
});

test("deadline order: past first, undated last, ties by title", () => {
  const { due } = sortActions(
    [
      ev({ id: "undated", status: "to_book", title: "Z" }),
      ev({ id: "later", due_at: hours(100) }),
      ev({ id: "past", due_at: hours(-3) }),
      ev({ id: "b", due_at: hours(5), title: "B" }),
      ev({ id: "a", due_at: hours(5), title: "A" }),
      ev({ id: "interview", starts_at: hours(1) }),
    ],
    NOW
  );
  assert.deepEqual(due.map((e) => e.id), ["past", "interview", "a", "b", "later", "undated"]);
});

test("a snooze moves the card and never the deadline, and ends by itself near the date", () => {
  const far = ev({ id: "far", due_at: hours(100), snoozed_until: hours(24) });
  assert.equal(isSnoozed(far, NOW), true);
  assert.equal(isSnoozed(far, NOW + 25 * 3_600_000), false, "the snooze has run out");
  const close = ev({ id: "close", due_at: hours(10), snoozed_until: hours(24) });
  assert.equal(isSnoozed(close, NOW), false, "due within 24 hours, so it is back");
  const { due, snoozed } = sortActions([far, close], NOW);
  assert.deepEqual(due.map((e) => e.id), ["close"]);
  assert.deepEqual(snoozed.map((e) => e.id), ["far"]);
  assert.equal(far.due_at, hours(100));
});

test("nothing due within 24 hours can be snoozed", () => {
  assert.equal(snoozeUntil(ev({ due_at: hours(10) }), NOW), null);
  assert.equal(snoozeUntil(ev({ due_at: hours(-1) }), NOW), null);
  assert.equal(snoozeUntil(ev({ due_at: hours(30) }), NOW), NOW + 24 * 3_600_000);
  assert.equal(snoozeUntil(ev({ status: "to_book" }), NOW), NOW + 24 * 3_600_000, "an undated item may wait");
});

test("a request may name an inbox, never a calendar import", () => {
  assert.equal(readEventSource("aiapply"), "aiapply");
  assert.equal(readEventSource("gmail"), "gmail");
  assert.equal(readEventSource("manual"), "manual");
  assert.equal(readEventSource("calendar"), "manual");
  assert.equal(readEventSource(undefined), "manual");
  assert.equal(readEventSource({ a: 1 }), "manual");
});

test("the kind a pasted email plainly describes", () => {
  assert.equal(guessEventKind("Your Corgi work trial is ready"), "work_trial");
  assert.equal(guessEventKind("Please answer the screening questions"), "screening_questions");
  assert.equal(guessEventKind("Record your Hireflix answers"), "video");
  assert.equal(guessEventKind("One-way video assessment due Tuesday"), "video");
  assert.equal(guessEventKind("Complete your HackerRank challenge"), "assessment");
  assert.equal(guessEventKind("We'd like to invite you to an interview"), "interview");
  assert.equal(guessEventKind("Book a 20-minute screening call"), "screening_call");
  assert.equal(guessEventKind("Please upload your CV"), "deadline");
});

test("the first link that is not the footer", () => {
  assert.equal(firstLink("Start here: https://example.com/test?a=1. Thanks"), "https://example.com/test?a=1");
  assert.equal(firstLink("https://example.com/unsubscribe then https://example.com/test"), "https://example.com/test");
  assert.equal(firstLink("No address here"), null);
  assert.equal(firstLink("javascript:alert(1)"), null);
});
