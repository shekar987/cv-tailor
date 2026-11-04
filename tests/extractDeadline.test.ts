import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDeadline } from "../src/lib/extractDeadline.ts";

const WED = "2026-11-04T10:00:00Z"; // Wed 4 Nov 2026, 10:00 London (GMT)

function due(text: string, received: string = WED) {
  const read = extractDeadline(text, received);
  assert.ok(read, `read nothing from: ${text}`);
  return read;
}

test("within 48 hours is exact from when the email arrived", () => {
  const r = due("Please complete the test within 48 hours.");
  assert.equal(r.dueAt, "2026-11-06T10:00:00.000Z");
  assert.equal(r.dateOnly, false);
  assert.equal(r.approximate, false);
  assert.match(r.matched, /within 48 hours/);
});

test("by Sunday, 8 November 2026 at 23:59 GMT", () => {
  const r = due("You must start by Sunday, 8 November 2026 at 23:59 GMT.");
  assert.equal(r.dueAt, "2026-11-08T23:59:00.000Z");
  assert.equal(r.dateOnly, false);
  assert.equal(r.zone, "GMT");
  assert.equal(r.approximate, false, "GMT and London agree in November");
});

test("you will have 7 days keeps the clock time", () => {
  assert.equal(due("You will have 7 days to complete this.").dueAt, "2026-11-11T10:00:00.000Z");
  assert.equal(due("You'll have seven days.").dueAt, "2026-11-11T10:00:00.000Z");
});

test("due by ~9 Nov is a date with no time, and approximate", () => {
  const r = due("Online assessment due by ~9 Nov.");
  assert.equal(r.dueAt, "2026-11-09T23:59:00.000Z");
  assert.equal(r.dateOnly, true);
  assert.equal(r.approximate, true);
});

test("IST converts to London", () => {
  const r = due("Complete by 5 Nov 2026 at 18:00 IST.");
  assert.equal(r.dueAt, "2026-11-05T12:30:00.000Z");
  assert.equal(r.zone, "IST");
});

test("IST can fall on the previous London day", () => {
  assert.equal(due("Please submit by 9 Nov 2026 at 01:00 IST.").dueAt, "2026-11-08T19:30:00.000Z");
});

test("CET converts to London in winter", () => {
  const r = due("The deadline is 6 Nov 2026, 23:00 CET.");
  assert.equal(r.dueAt, "2026-11-06T22:00:00.000Z");
  assert.equal(r.approximate, false);
});

test("CET in summer takes the earlier reading and says it is approximate", () => {
  const r = due("Submit by 10 July 2026 at 18:00 CET.", "2026-07-01T09:00:00Z");
  assert.equal(r.dueAt, "2026-07-10T16:00:00.000Z");
  assert.equal(r.approximate, true);
});

test("CEST is exact in summer", () => {
  const r = due("Submit by 10 July 2026 at 18:00 CEST.", "2026-07-01T09:00:00Z");
  assert.equal(r.dueAt, "2026-07-10T16:00:00.000Z");
  assert.equal(r.approximate, false);
});

test("GMT during BST takes the earlier reading", () => {
  const r = due("Closes 10 July 2026 at 17:00 GMT.", "2026-07-01T09:00:00Z");
  assert.equal(r.dueAt, "2026-07-10T16:00:00.000Z");
  assert.equal(r.approximate, true);
});

test("a time with no zone is London time, in summer too", () => {
  assert.equal(due("Please complete by 3 July 2026 at 17:00.", "2026-07-01T09:00:00Z").dueAt, "2026-07-03T16:00:00.000Z");
});

test("a numeric offset is read as written", () => {
  assert.equal(due("Due by 5 Nov 2026 at 18:00 UTC+1.").dueAt, "2026-11-05T17:00:00.000Z");
  assert.equal(due("Due by 5 Nov 2026 at 18:00 GMT-5.").dueAt, "2026-11-05T23:00:00.000Z");
});

test("across the autumn clock change: hours are exact, days keep the wall clock", () => {
  const received = "2026-10-24T11:00:00Z"; // Sat 24 Oct, 12:00 BST. Clocks go back on Sun 25 Oct.
  assert.equal(due("Complete it within 48 hours.", received).dueAt, "2026-10-26T11:00:00.000Z");
  assert.equal(due("You have 7 days.", received).dueAt, "2026-10-31T12:00:00.000Z");
});

test("across the spring clock change, a date with no time still ends that London day", () => {
  assert.equal(due("Submit by 30 March 2026.", "2026-03-20T09:00:00Z").dueAt, "2026-03-30T22:59:00.000Z");
});

test("a date with no year rolls over the new year, but a recent past date is no deadline", () => {
  assert.equal(due("Please complete by 3 Jan.", "2026-12-20T09:00:00Z").dueAt, "2027-01-03T23:59:00.000Z");
  assert.equal(extractDeadline("Please complete by 30 Oct.", WED), null);
});

test("US order and ISO dates", () => {
  assert.equal(due("Due by November 8, 2026 at 5pm.").dueAt, "2026-11-08T17:00:00.000Z");
  assert.equal(due("Due: 2026-11-08").dateOnly, true);
});

test("a numeric date reads UK first and flags two real readings", () => {
  const r = due("Deadline: 08/11/2026.");
  assert.equal(r.dueAt, "2026-11-08T23:59:00.000Z");
  assert.equal(r.approximate, true);
  assert.equal(due("Deadline: 25/11/2026.").approximate, false);
});

test("clock forms", () => {
  assert.equal(due("Due by 6 Nov 2026 at 6:30 pm.").dueAt, "2026-11-06T18:30:00.000Z");
  assert.equal(due("Due by 6 Nov 2026 at 12am.").dueAt, "2026-11-06T00:00:00.000Z");
  assert.equal(due("Due by 6 Nov 2026 at noon.").dueAt, "2026-11-06T12:00:00.000Z");
  assert.equal(due("Due by midnight on 8 November 2026.").dueAt, "2026-11-08T23:59:00.000Z");
  assert.equal(due("Due by end of day on 8 November 2026.").dateOnly, true);
  assert.equal(due("Please respond by 18.40 on 5 Nov 2026.").dueAt, "2026-11-05T18:40:00.000Z");
});

test("weekdays and tomorrow", () => {
  assert.equal(due("Please complete it by Friday at 5pm.").dueAt, "2026-11-06T17:00:00.000Z");
  assert.equal(due("Please complete it by tomorrow at 5pm.").dueAt, "2026-11-05T17:00:00.000Z");
  assert.equal(due("Due next Friday.").approximate, true);
});

test("a stated weekday that does not match the date is flagged", () => {
  const r = due("Due by Monday, 8 November 2026.");
  assert.equal(r.dueAt, "2026-11-08T23:59:00.000Z");
  assert.equal(r.approximate, true);
  assert.equal(due("Due by Sunday, 8 November 2026.").approximate, false);
});

test("a window counted from a stated date", () => {
  const r = due("You were invited, 10 days from 30 Oct.");
  assert.equal(r.dueAt, "2026-11-09T23:59:00.000Z");
  assert.equal(r.dateOnly, true);
});

test("working days skip the weekend, and words and weeks count", () => {
  assert.equal(due("Complete it within 5 working days.").dueAt, "2026-11-11T10:00:00.000Z");
  assert.equal(due("Complete it within two weeks.").dueAt, "2026-11-18T10:00:00.000Z");
  assert.equal(due("This link expires in 3 days.").dueAt, "2026-11-07T10:00:00.000Z");
  assert.equal(due("You have 72 hrs to complete the test.").dueAt, "2026-11-07T10:00:00.000Z");
});

test("the earliest wins, a stated date and a window alike", () => {
  assert.equal(due("You have 7 days to do this. The final deadline is 6 Nov 2026.").dueAt, "2026-11-06T23:59:00.000Z");
  assert.equal(due("Please complete the HackerRank test within 72 hours. Applications close on 30 November 2026.").dueAt, "2026-11-07T10:00:00.000Z");
});

test("UK clock forms", () => {
  assert.equal(due("Please submit by 17.00 on Friday 6 November.").dueAt, "2026-11-06T17:00:00.000Z");
  assert.equal(due("Deadline is 12.00 on 20 November.").dueAt, "2026-11-20T12:00:00.000Z");
  assert.equal(due("Due by 6 Nov 2026 at 17:00hrs.").dueAt, "2026-11-06T17:00:00.000Z");
  assert.equal(due("Due by 6 Nov 2026 at 1700.").dueAt, "2026-11-06T17:00:00.000Z");
  assert.equal(due("Due by 6 Nov 2026, 1700 hrs.").dueAt, "2026-11-06T17:00:00.000Z");
  assert.equal(due("Due by 6 Nov 2026, the fee is £45.00.").dateOnly, true, "a price is not a time");
});

test("a clock time is never read as the day", () => {
  assert.equal(due("Due by 17:30 Nov 5, 2026.").dueAt, "2026-11-05T17:30:00.000Z");
  assert.equal(due("Your slot is 10:15 November 9.").dueAt, "2026-11-09T10:15:00.000Z");
});

test("a zone after hrs or a comma is read, and one it does not know is flagged", () => {
  assert.equal(due("Due by 5 Nov 2026 at 18:00 hrs IST.").dueAt, "2026-11-05T12:30:00.000Z");
  assert.equal(due("Due by 5 Nov 2026 at 6pm, IST.").dueAt, "2026-11-05T12:30:00.000Z");
  assert.equal(due("Due by 5 Nov 2026 at 18:00 SGT.").dueAt, "2026-11-05T10:00:00.000Z");
  const r = due("Due by 5 Nov 2026 at 18:00 NZST.");
  assert.equal(r.approximate, true, "an unknown zone says so");
  assert.equal(r.zone, "NZST");
  assert.equal(due("Due by 5 Nov 2026 at 18:00 ON THE DOT.").approximate, false);
});

test("a link's numbers, a company's name and a heading on its own line", () => {
  assert.equal(extractDeadline("Open https://example.com/12/11/test to begin.", WED), null);
  assert.equal(due("Sun Life assessment by 20 November.").dueAt, "2026-11-20T23:59:00.000Z");
  assert.equal(due("Deadline:\nFriday 6 November").dueAt, "2026-11-06T23:59:00.000Z");
  assert.equal(due("Please complete it by Friday 6 November and we will review it.").dueAt, "2026-11-06T23:59:00.000Z");
  assert.equal(due("We ask that you respond by 6 November.").dueAt, "2026-11-06T23:59:00.000Z");
});

test("an appointment with a clock time and no deadline word is read", () => {
  assert.equal(due("Your interview is on Thu 5 Nov at 08:30.").dueAt, "2026-11-05T08:30:00.000Z");
});

test("the earliest of two deadlines wins", () => {
  assert.equal(due("Complete the test by 8 Nov 2026. Record the video by 6 Nov 2026.").dueAt, "2026-11-06T23:59:00.000Z");
});

test("never guesses: these are not deadlines", () => {
  for (const text of [
    "",
    "Thanks for applying to the role.",
    "Posted 3 November 2026.",
    "We aim to respond within 7 days.",
    "Our team will get back to you within 48 hours.",
    "You'll hear from us within 5 working days.",
    "Once you begin, you will have 2 hours to complete it.",
    "You have 48 hours to submit from the start you choose.",
    "Due by 31 November 2026.",
    "Start date: 1 January 2027.",
    "If you do not hear from us within 14 days, please assume you were unsuccessful.",
    "You will receive feedback within 5 working days.",
    "Your application will be reviewed within 7 days.",
    "You will have 25 days holiday.",
    "We will review it and get back to you by 6 November.",
    "This was submitted today.",
    "You must be available to start on 5 January.",
  ]) {
    assert.equal(extractDeadline(text, WED), null, text);
  }
});

test("a bad received date reads nothing", () => {
  assert.equal(extractDeadline("Due by 8 Nov 2026.", "not a date"), null);
});

test("a date received as a Date or a number reads the same", () => {
  const expected = "2026-11-06T10:00:00.000Z";
  assert.equal(extractDeadline("Within 48 hours please.", new Date(WED))?.dueAt, expected);
  assert.equal(extractDeadline("Within 48 hours please.", Date.parse(WED))?.dueAt, expected);
});
