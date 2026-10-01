// Unit tests for the tracker's shared rules (lib/tracker). node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUSES,
  READY_TO_SUBMIT,
  isStatus,
  isSubmitted,
  isFollowupDue,
  clearsFollowup,
  followupClearedNote,
  appendNoteLine,
  normalizeRole,
  findDuplicateApplication,
  roleTooLong,
  ROLE_WARN_CHARS,
  notesSayNotSubmitted,
  pageSlice,
  PAGE_SIZE,
  sendConfirmReasons,
} from "../src/lib/tracker.ts";

test("the status list carries Ready to submit first and validates strictly", () => {
  assert.equal(STATUSES[0], READY_TO_SUBMIT);
  assert.equal(STATUSES.length, 7);
  assert.ok(isStatus("Ready to submit"));
  assert.ok(isStatus("Withdrawn"));
  assert.ok(!isStatus("ready to submit"), "case matters: the CHECK constraint is exact");
  assert.ok(!isStatus("Pending"));
  assert.ok(!isStatus(null));
});

test("Ready to submit is not a submitted application; everything else is", () => {
  assert.equal(isSubmitted("Ready to submit"), false);
  for (const s of ["Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"]) assert.equal(isSubmitted(s), true, s);
});

test("a follow-up is due only on a live, submitted row with a date in the past", () => {
  const today = "2026-10-01";
  assert.ok(isFollowupDue({ followup_date: "2026-10-01", status: "Applied" }, today));
  assert.ok(isFollowupDue({ followup_date: "2026-09-20", status: "Interview" }, today));
  assert.ok(!isFollowupDue({ followup_date: "2026-10-02", status: "Applied" }, today), "tomorrow is not due");
  assert.ok(!isFollowupDue({ followup_date: "2026-09-20", status: "Rejected" }, today), "a closed row has no task");
  assert.ok(!isFollowupDue({ followup_date: "2026-09-20", status: "Ready to submit" }, today), "nothing to follow up on an unsent row");
  assert.ok(!isFollowupDue({ followup_date: null, status: "Applied" }, today));
});

test("Rejected and Withdrawn clear the follow-up and the note keeps the old date", () => {
  assert.ok(clearsFollowup("Rejected"));
  assert.ok(clearsFollowup("Withdrawn"));
  assert.ok(!clearsFollowup("Interview"));
  assert.ok(!clearsFollowup("Offer"));
  const line = followupClearedNote("2026-10-08", "Rejected", "2026-10-01");
  assert.equal(line, "Follow-up 2026-10-08 cleared when marked Rejected on 2026-10-01.");
  assert.equal(appendNoteLine(null, line), line);
  assert.equal(appendNoteLine("Search visibility: 12/15 keywords.\n", line), `Search visibility: 12/15 keywords.\n${line}`);
  assert.equal(appendNoteLine(`existing\n${line}`, line), `existing\n${line}`, "the same line is never appended twice");
});

test("normalizeRole drops case, brackets, punctuation and spacing but keeps seniority", () => {
  assert.equal(normalizeRole("Software Engineer (Remote)"), "software engineer");
  assert.equal(normalizeRole("Software Engineer - Backend"), "software engineer backend");
  assert.equal(normalizeRole("Data & AI Engineer [12-month FTC]"), "data and ai engineer");
  assert.equal(normalizeRole("  Senior   Software Engineer "), "senior software engineer");
  assert.notEqual(normalizeRole("Senior Software Engineer"), normalizeRole("Software Engineer"));
  assert.equal(normalizeRole(null), "");
});

test("findDuplicateApplication matches company by lib/companyMatch and role by normalizeRole, newest first", () => {
  const rows = [
    { id: "a", company_name: "Monzo Bank Ltd", role: "Software Engineer (Remote)", date_applied: "2026-09-10", status: "Applied" },
    { id: "b", company_name: "Monzo", role: "Software Engineer", date_applied: "2026-09-20", status: "Rejected" },
    { id: "c", company_name: "Monzo", role: "Senior Software Engineer", date_applied: "2026-09-25", status: "Applied" },
    { id: "d", company_name: "Metaphor Labs", role: "Software Engineer", date_applied: "2026-09-26", status: "Applied" },
  ];
  const dup = findDuplicateApplication(rows, { company_name: "Monzo Bank", role: "software engineer" });
  assert.equal(dup?.id, "b", "the newest matching row wins");
  assert.equal(findDuplicateApplication(rows, { company_name: "Meta", role: "Software Engineer" }), null, "Meta never claims Metaphor Labs");
  assert.equal(findDuplicateApplication(rows, { company_name: "Monzo", role: "Platform Engineer" }), null);
  assert.equal(findDuplicateApplication(rows, { company_name: "", role: "Software Engineer" }), null);
  assert.equal(findDuplicateApplication(rows, { company_name: "Monzo", role: "Senior Software Engineer" }, "c"), null, "the row being edited is skipped");
});

test("roleTooLong warns past 80 characters", () => {
  assert.equal(ROLE_WARN_CHARS, 80);
  assert.ok(!roleTooLong("Software Engineer"));
  assert.ok(roleTooLong("Software Engineer - London - Hybrid - £45,000 to £55,000 - Permanent - Start ASAP - Ref 12345"));
  assert.ok(!roleTooLong("x".repeat(80)));
  assert.ok(roleTooLong("x".repeat(81)));
});

test("notesSayNotSubmitted reads the common ways of saying it", () => {
  assert.ok(notesSayNotSubmitted("Not submitted yet — waiting on a reference."));
  assert.ok(notesSayNotSubmitted("didn't send this one in the end"));
  assert.ok(notesSayNotSubmitted("Haven't applied, portal was down"));
  assert.ok(notesSayNotSubmitted("application not yet sent"));
  assert.ok(!notesSayNotSubmitted("Submitted on the portal; recruiter not sure about timing."));
  assert.ok(!notesSayNotSubmitted("Sent the CV; they have not replied."));
  assert.ok(!notesSayNotSubmitted(null));
});

test("pageSlice pages the visible rows and clamps the page number", () => {
  const items = Array.from({ length: 120 }, (_, i) => i);
  assert.equal(PAGE_SIZE, 50);
  const p1 = pageSlice(items, 1);
  assert.deepEqual([p1.page, p1.pages, p1.from, p1.to, p1.items.length], [1, 3, 1, 50, 50]);
  const p3 = pageSlice(items, 3);
  assert.deepEqual([p3.page, p3.from, p3.to, p3.items.length], [3, 101, 120, 20]);
  assert.equal(pageSlice(items, 9).page, 3, "past the end clamps to the last page");
  assert.equal(pageSlice(items, 0).page, 1);
  assert.equal(pageSlice(items, Number.NaN).page, 1);
  const empty = pageSlice([], 1);
  assert.deepEqual([empty.pages, empty.from, empty.to], [1, 0, 0]);
  assert.equal(pageSlice(items, 1, 200).pages, 1);
});

test("sendConfirmReasons lists weak / skip / long shot / duplicate as sentences and nothing for a clean run", () => {
  assert.deepEqual(sendConfirmReasons({ band: "ready", read: "apply", duplicate: null }), []);
  assert.deepEqual(sendConfirmReasons({ band: "borderline" }), [], "borderline is a warning on the page, not a confirm");
  const weak = sendConfirmReasons({ band: "weak" });
  assert.equal(weak.length, 1);
  assert.match(weak[0], /weak/);
  const skip = sendConfirmReasons({ read: "skip" });
  assert.match(skip[0], /likely auto-rejected/);
  const long = sendConfirmReasons({ read: "long_shot" });
  assert.match(long[0], /long shot/);
  const dup = sendConfirmReasons({ duplicate: { company_name: "Monzo", role: "Software Engineer", date_applied: "2026-09-20", status: "Rejected" } });
  assert.equal(dup[0], "You already have Monzo — Software Engineer on 2026-09-20 (Rejected) in the tracker.");
  assert.equal(sendConfirmReasons({ band: "weak", read: "skip", duplicate: { company_name: "A", role: "B" } }).length, 3);
});
