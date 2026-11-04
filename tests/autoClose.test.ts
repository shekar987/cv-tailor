import { test } from "node:test";
import assert from "node:assert/strict";
import { autoCloseMessage, closesOnConfirmation, confirmationAdded, confirmationIn } from "../src/lib/autoClose.ts";

test("the three phrases, in any case", () => {
  assert.equal(confirmationIn("Your response has been recorded ~11:45"), "your response has been recorded");
  assert.equal(confirmationIn("APPLICATION SUBMITTED on 2 Nov"), "application submitted");
  assert.equal(confirmationIn("Thanks for applying to Acme"), "thanks for applying");
  assert.equal(confirmationIn("Application not submitted yet"), null);
  assert.equal(confirmationIn(null), null);
});

test("only text this edit adds counts", () => {
  const old = "Submitted on 2 Nov. Application submitted.";
  assert.equal(confirmationAdded(old, old), null, "the same notes close nothing");
  assert.equal(confirmationAdded(old, `${old} Then an assessment arrived.`), null, "an old line stays old");
  assert.equal(confirmationAdded(old, `${old}\nApplication submitted again for round two.`), "application submitted", "written a second time");
  assert.equal(confirmationAdded("Waiting", "Your response has been recorded."), "your response has been recorded");
  assert.equal(confirmationAdded(null, "Thanks for applying"), "thanks for applying");
  assert.equal(confirmationAdded("Thanks for applying", "Shorter"), null);
});

test("a confirmation never closes a test, a video, an interview or a work trial", () => {
  for (const kind of ["screening_questions", "deadline"]) assert.equal(closesOnConfirmation(kind), true, kind);
  for (const kind of ["assessment", "video", "interview", "work_trial", "take_home", "screening_call", "follow_up", "offer_deadline", "networking"]) {
    assert.equal(closesOnConfirmation(kind), false, kind);
  }
});

test("the toast says what closed and what stayed open", () => {
  assert.equal(autoCloseMessage([{ id: "1", title: "Upload CV" }], []), `Your notes say this was submitted, so "Upload CV" closed.`);
  assert.equal(autoCloseMessage([{ id: "1", title: "Answers" }], ["HackerRank test"]), `Your notes say this was submitted, so "Answers" closed. Still open: HackerRank test.`);
  assert.equal(autoCloseMessage([], ["HackerRank test"]), "Still open: HackerRank test.");
});
