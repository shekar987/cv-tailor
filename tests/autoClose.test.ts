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
  assert.equal(closesOnConfirmation("screening_questions", "Screening questions"), true);
  assert.equal(closesOnConfirmation("deadline", "Upload CV and submit"), true);
  assert.equal(closesOnConfirmation("deadline", "Deadline"), false, "the catch-all kind closes only a submission");
  assert.equal(closesOnConfirmation("deadline", "Prepare the slides"), false);
  for (const kind of ["assessment", "video", "interview", "work_trial", "take_home", "screening_call", "follow_up", "offer_deadline", "networking"]) {
    assert.equal(closesOnConfirmation(kind, "Submit the form"), false, kind);
  }
});

test("a phrase that confirms nothing closes nothing", () => {
  for (const added of [
    "Thanks for applying to Acme. Please complete the screening questions by 9 Nov.",
    "Application submitted? Not yet, the form errored.",
    "Chase 7 days after application submitted.",
    "Will write again once application submitted.",
    "Application submitted is what the form should say next.",
  ]) {
    assert.equal(confirmationAdded("Earlier notes.", `Earlier notes.\n${added}`), null, added);
    assert.equal(confirmationAdded(null, added), null, added);
  }
});

test("a real note closes, whichever end it was written at", () => {
  const note = 'Applied 2 Nov via a form (pages 1-2 filled; uploaded the CV and submitted; "Your response has been recorded" seen ~11:45). NEXT (9 Nov): LinkedIn follow-up.';
  assert.equal(confirmationAdded("Older line.", `${note}\nOlder line.`), "your response has been recorded");
  assert.equal(confirmationAdded("Older line.", `Older line.\n${note}`), "your response has been recorded");
  assert.equal(confirmationAdded(null, 'Confirmation pasted: "your response has been recorded"'), "your response has been recorded");
});

test("the toast says what closed and what stayed open", () => {
  assert.equal(autoCloseMessage([{ id: "1", title: "Upload CV" }], []), `Your notes say this was submitted, so "Upload CV" closed.`);
  assert.equal(autoCloseMessage([{ id: "1", title: "Answers" }], ["HackerRank test"]), `Your notes say this was submitted, so "Answers" closed. Still open: HackerRank test.`);
  assert.equal(autoCloseMessage([], ["HackerRank test"]), "Still open: HackerRank test.");
});
