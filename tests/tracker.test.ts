// Unit tests for the tracker's shared rules (lib/tracker). node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUSES,
  READY_TO_SUBMIT,
  STATUS_LABELS,
  normalizeStatus,
  statusLabel,
  oldStatusLabel,
  storedStatusValues,
  isActiveStatus,
  removeFollowupClearedNote,
  stagesAfterMove,
  endedWithoutProgress,
  inStageTab,
  inStageTabOrPast,
  isStageTab,
  stageTabValues,
  STAGE_TABS,
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
  isReplyOwed,
  replyOwedFirst,
  parseContactAt,
  isLastContactFrom,
  REPLY_OWED_AFTER_MS,
} from "../src/lib/tracker.ts";

test("the status list is the lower-case keys; old labels still read", () => {
  assert.equal(STATUSES[0], READY_TO_SUBMIT);
  assert.deepEqual([...STATUSES], ["saved", "applied", "screening", "interview", "assessment", "offer", "accepted", "rejected", "withdrawn", "ghosted"]);
  assert.equal(normalizeStatus("Ready to submit"), "saved");
  assert.equal(normalizeStatus("Withdrawn"), "withdrawn");
  assert.equal(normalizeStatus(" screening "), "screening");
  assert.ok(isStatus("ghosted"));
  assert.ok(!isStatus("Pending"));
  assert.ok(!isStatus(null));
  assert.equal(normalizeStatus("Pending"), null);
});

test("a stage tab holds a row by its CURRENT status only: a rejected row is never under Screening", () => {
  assert.equal(inStageTab("rejected", "screening"), false);
  assert.equal(inStageTab("Rejected", "screening"), false);
  assert.equal(inStageTab("screening", "screening"), true);
  assert.equal(inStageTab("Screening", "screening"), true, "an old label reads the same");
  // A row that passed through Screening and was then rejected stays out unless asked for.
  const row = { status: "rejected", stages_reached: ["applied", "screening", "rejected"] };
  assert.equal(inStageTab(row.status, "screening"), false);
  assert.equal(inStageTabOrPast(row, "screening"), true, "Include past stages");
  assert.equal(inStageTabOrPast(row, "interview"), false);
  assert.equal(inStageTabOrPast({ status: "screening" }, "screening"), true);
  assert.equal(inStageTabOrPast({ status: "applied", stages_reached: null }, "screening"), false);
});

test("the Won tab holds accepted and offer; every other tab one status", () => {
  assert.equal(inStageTab("accepted", "accepted"), true);
  assert.equal(inStageTab("offer", "accepted"), true);
  assert.equal(inStageTab("offer", "offer"), true);
  assert.equal(inStageTab("accepted", "offer"), false);
  assert.deepEqual(stageTabValues("accepted"), ["accepted", "offer", "Offer"]);
  assert.deepEqual(stageTabValues("screening"), ["screening", "Screening"]);
  assert.deepEqual([...STAGE_TABS], ["screening", "interview", "assessment", "offer", "rejected", "accepted"]);
  assert.equal(isStageTab("applied"), false);
});

test("every status has a label, and the two renamed ones read as the user knows them", () => {
  for (const s of STATUSES) assert.ok(STATUS_LABELS[s], s);
  assert.equal(statusLabel("saved"), "Ready to submit");
  assert.equal(statusLabel("accepted"), "Won");
  assert.equal(statusLabel("Rejected"), "Rejected");
  assert.equal(statusLabel("Pending"), "Pending");
});

test("a database on the old CHECK gets the old label; a filter matches both spellings", () => {
  assert.equal(oldStatusLabel("saved"), "Ready to submit");
  assert.equal(oldStatusLabel("assessment"), null);
  assert.deepEqual(storedStatusValues("screening"), ["screening", "Screening"]);
  assert.deepEqual(storedStatusValues("ghosted"), ["ghosted"]);
});

test("active means screening, interview, assessment or offer, and nothing else", () => {
  const active = STATUSES.filter(isActiveStatus);
  assert.deepEqual(active, ["screening", "interview", "assessment", "offer"]);
  assert.ok(isActiveStatus("Screening"));
  assert.ok(!isActiveStatus("Rejected"));
  assert.ok(!isActiveStatus(null));
});

test("a ghosted row has ended without progress, so it is not still open", () => {
  assert.equal(endedWithoutProgress("ghosted"), true);
  assert.equal(endedWithoutProgress("Rejected"), true);
  assert.equal(endedWithoutProgress("screening"), false);
  assert.equal(endedWithoutProgress("accepted"), false);
});

test("undo takes back only the follow-up line it added", () => {
  const notes = "First line.\nFollow-up 2026-11-10 cleared when marked Rejected on 2026-11-03.";
  assert.equal(removeFollowupClearedNote(notes, "2026-11-10"), "First line.");
  assert.equal(removeFollowupClearedNote("Follow-up 2026-11-10 cleared when marked Rejected on 2026-11-03.", "2026-11-10"), "");
  assert.equal(removeFollowupClearedNote("Keep this.", "2026-11-10"), "Keep this.");
  assert.equal(removeFollowupClearedNote(notes, "2026-12-01"), notes, "another date's line stays");
  assert.equal(removeFollowupClearedNote(null, "2026-11-10"), "");
});

test("the stage history after a move matches what the database trigger writes", () => {
  const walk = (start: string[], ...moves: string[]) => moves.reduce((h, m) => stagesAfterMove(h, m), start).join();
  assert.equal(walk(["applied"], "screening", "rejected"), "applied,screening,rejected", "an ending keeps the path");
  assert.equal(walk(["applied"], "screening", "rejected", "screening"), "applied,screening", "undoing Rejected removes it");
  assert.equal(walk(["applied"], "screening", "offer", "screening"), "applied,screening", "undoing Offer removes it");
  assert.equal(walk(["applied"], "screening", "assessment", "interview"), "applied,screening,assessment,interview");
  assert.equal(walk(["applied"], "screening", "assessment", "interview", "assessment"), "applied,screening,interview,assessment", "going back puts it last");
  assert.equal(walk(["applied"], "screening", "ghosted", "rejected"), "applied,screening,rejected", "one ending at a time");
  assert.equal(walk(["applied", "Screening"], "Applied"), "applied", "old labels too");
  assert.equal(walk(["applied"], "screening", "screening"), "applied,screening", "an unchanged status changes nothing");
  assert.deepEqual(stagesAfterMove(null, "applied"), ["applied"]);
});

test("ghosted and won rows have ended, so their follow-ups clear", () => {
  for (const s of ["rejected", "withdrawn", "ghosted", "accepted", "Rejected"]) assert.equal(clearsFollowup(s), true, s);
  for (const s of ["applied", "screening", "interview", "assessment", "offer"]) assert.equal(clearsFollowup(s), false, s);
  assert.equal(followupClearedNote("2026-11-04", "accepted", "2026-11-03"), "Follow-up 2026-11-04 cleared when marked Won on 2026-11-03.");
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

// ── Reply owed (30 Oct 2026) ────────────────────────────────────────────────

const NOW = Date.parse("2026-10-30T12:00:00Z");

test("isReplyOwed: they spoke last, more than a day ago, on an open row", () => {
  assert.equal(isReplyOwed({ last_contact_from: "them", last_contact_at: "2026-09-26T09:00:00Z", status: "Screening" }, NOW), true, "the Kainos case: a month unanswered");
  assert.equal(isReplyOwed({ last_contact_from: "them", last_contact_at: new Date(NOW - REPLY_OWED_AFTER_MS + 60_000).toISOString() }, NOW), false, "under 24 hours: not yet");
  assert.equal(isReplyOwed({ last_contact_from: "them", last_contact_at: new Date(NOW - REPLY_OWED_AFTER_MS - 60_000).toISOString() }, NOW), true, "just over 24 hours");
  assert.equal(isReplyOwed({ last_contact_from: "me", last_contact_at: "2026-09-26T09:00:00Z" }, NOW), false, "I spoke last");
  assert.equal(isReplyOwed({ last_contact_from: "them", last_contact_at: null }, NOW), false);
  assert.equal(isReplyOwed({ last_contact_from: "them", last_contact_at: "nonsense" }, NOW), false);
  assert.equal(isReplyOwed({ last_contact_from: "them", last_contact_at: "2026-09-26T09:00:00Z", status: "Rejected" }, NOW), false, "a closed row owes nothing");
  assert.equal(isReplyOwed({}, NOW), false, "a row from before the migration");
});

test("replyOwedFirst puts owed rows on top and keeps every group's order", () => {
  const rows = [
    { id: "a", last_contact_from: null, last_contact_at: null },
    { id: "b", last_contact_from: "them", last_contact_at: "2026-10-01T00:00:00Z" },
    { id: "c", last_contact_from: "me", last_contact_at: "2026-10-01T00:00:00Z" },
    { id: "d", last_contact_from: "them", last_contact_at: "2026-10-20T00:00:00Z" },
  ];
  assert.deepEqual(replyOwedFirst(rows, NOW).map((r) => r.id), ["b", "d", "a", "c"]);
});

test("parseContactAt: a date or an ISO time, never the future; empty clears", () => {
  assert.equal(parseContactAt("2026-09-26", NOW), "2026-09-26T00:00:00.000Z");
  assert.equal(parseContactAt("2026-09-26T09:15:00Z", NOW), "2026-09-26T09:15:00.000Z");
  assert.equal(parseContactAt("2026-09-26T10:15:00+01:00", NOW), "2026-09-26T09:15:00.000Z");
  assert.equal(parseContactAt("", NOW), null);
  assert.equal(parseContactAt(null, NOW), null);
  assert.equal(parseContactAt("2026-11-30", NOW), undefined, "the future");
  assert.equal(parseContactAt("yesterday", NOW), undefined);
  assert.equal(parseContactAt(20260926, NOW), undefined);
  assert.equal(isLastContactFrom("them"), true);
  assert.equal(isLastContactFrom("recruiter"), false);
});
