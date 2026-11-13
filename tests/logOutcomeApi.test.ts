// Chunk 26: the API's refusals say what would have been taken, a row can't be created for
// "undefined", and a close made from "Log outcome" can be undone with its note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderName, validateEditable } from "../src/lib/applicationFields.ts";
import { LOG_SOURCES, readLogSource } from "../src/lib/applicationLog.ts";
import { readBulkBody } from "../src/lib/bulkUpdate.ts";
import { decideClosingWrite, normalizeUndoSnapshot, undoWrite, type ClosingWrite } from "../src/lib/closing.ts";
import { readColdEmails } from "../src/lib/coldEmails.ts";
import { MAX_APPENDED_NOTE, cleanNoteLine, decideNotesWrite, stampNoteLine } from "../src/lib/notesWrite.ts";
import { manualOutcomeNoteLine, nextStepAfterOutcome, outcomeNoteLine } from "../src/lib/outcomeEmail.ts";
import { TAB_LABELS, fixLabel } from "../src/lib/applicationStage.ts";

const NEW_ROW = { company_name: "Harbourline", role: "Junior Software Engineer", date_applied: "2026-11-10" };

test("source: a value that is not allowed is refused with the list of allowed values", () => {
  for (const sent of ["linkedin", "AIApply", "ashby", "tailored"]) {
    const refused = readLogSource(sent);
    assert.ok("error" in refused, sent);
    assert.equal(refused.field, "source");
    assert.deepEqual(refused.allowed, ["manual", "cold-email"]);
    assert.match(refused.error, /"manual"/);
    assert.match(refused.error, /"cold-email"/);
  }
  assert.match((readLogSource("linkedin") as { error: string }).error, /source "linkedin" is not allowed/);
  assert.match((readLogSource("linkedin") as { error: string }).error, /append_note or logged_by/, "it says where the job board's name belongs");
  assert.deepEqual([...LOG_SOURCES], ["manual", "cold-email"]);
  // What was allowed still is.
  assert.deepEqual(readLogSource(""), { source: "manual" });
  assert.deepEqual(readLogSource(" Manual "), { source: "manual" });
  assert.deepEqual(readLogSource("cold-email"), { source: "cold-email" });
});

test("append_note: the refusal states the limit and what was sent", () => {
  const long = cleanNoteLine("x".repeat(MAX_APPENDED_NOTE + 112));
  assert.ok("error" in long);
  assert.equal(long.field, "append_note");
  assert.equal(long.max, 500);
  assert.equal(long.length, 612);
  assert.match(long.error, /612 characters/);
  assert.match(long.error, /limit for one append_note is 500/);
  const empty = cleanNoteLine("   ");
  assert.ok("error" in empty);
  assert.match(empty.error, /up to 500 characters/);
  assert.deepEqual(cleanNoteLine("x".repeat(MAX_APPENDED_NOTE)), { line: "x".repeat(MAX_APPENDED_NOTE) });
  // The PUT's own refusal carries the same fields, and the bulk route names its own field.
  const put = decideNotesWrite({ append_note: "y".repeat(501) });
  assert.ok("refuse" in put);
  assert.equal(put.refuse.status, 400);
  assert.equal(put.refuse.body.max, 500);
  assert.equal(put.refuse.body.length, 501);
  const bulk = readBulkBody({ ids: ["3f2c1a52-6a43-4f0e-9f57-1d2b3c4d5e6f"], append_line: "z".repeat(501) });
  assert.ok("error" in bulk);
  assert.match(bulk.error, /limit for one append_line is 500/);
  assert.ok(!bulk.error.includes("append_note"));
});

test("company_name and role: empty, or the word a broken script sends, is refused with the field's name", () => {
  for (const bad of ["undefined", " Undefined ", "null", "NULL", "NaN", "[object Object]"]) {
    assert.equal(isPlaceholderName(bad), true, bad);
    const company = validateEditable({ ...NEW_ROW, company_name: bad }, false);
    assert.ok("error" in company, bad);
    assert.equal(company.field, "company_name");
    assert.match(company.error, /nothing was saved/);
    assert.match(company.error, /Send the real company name in company_name/);
    const role = validateEditable({ ...NEW_ROW, role: bad }, false);
    assert.ok("error" in role, bad);
    assert.equal(role.field, "role");
    assert.match(role.error, /Send the real job title in role/);
  }
  // The row of 13 Nov: both at once. The company is named first.
  const both = validateEditable({ company_name: "undefined", role: "undefined", date_applied: "2026-11-13" }, false);
  assert.ok("error" in both);
  assert.equal(both.field, "company_name");
  // An update can't rename a row to it either.
  assert.ok("error" in validateEditable({ company_name: "undefined" }, true));
  assert.ok("error" in validateEditable({ role: "null" }, true));
  // Empty and missing, as before, now with the field.
  const missing = validateEditable({ role: "Engineer", date_applied: "2026-11-13" }, false);
  assert.ok("error" in missing);
  assert.equal(missing.field, "company_name");
  assert.match(missing.error, /Company name is required/);
  const blank = validateEditable({ ...NEW_ROW, role: "   " }, false);
  assert.ok("error" in blank);
  assert.equal(blank.field, "role");
  // Real names that only contain the words are fine.
  for (const fine of ["Null Island Maps", "Undefined Labs", "Nan Fung Group", "Object Computing"]) {
    assert.equal(isPlaceholderName(fine), false, fine);
    assert.ok("fields" in validateEditable({ ...NEW_ROW, company_name: fine }, false), fine);
  }
});

test("a cold email row for \"undefined\" is reported, and the good rows still go", () => {
  const read = readColdEmails(
    [
      { company_name: "undefined", role: "undefined", contact_email: "a@example.com", date_sent: "2026-11-12" },
      { company_name: "Harbourline", contact_email: "b@example.com", date_sent: "2026-11-12" },
    ],
    "2026-11-13"
  );
  assert.ok(!("error" in read));
  assert.equal(read.rows.length, 1);
  assert.equal(read.rows[0].row.company_name, "Harbourline");
  assert.equal(read.problems.length, 1);
  assert.equal(read.problems[0].index, 0);
  assert.match(read.problems[0].error, /company_name was sent as "undefined"/);
});

// ── A close from "Log outcome", and its Undo ────────────────────────────────

const NOW = "2026-11-13T10:00:00.000Z";
const WORD = { confirmed: true, confirmedMoveBack: false, confirmedReopen: false };

test("a close's note is undone with the close, and nothing else in the notes moves", () => {
  const line = stampNoteLine(outcomeNoteLine("2026-11-13", "Sadly it is not this time."), Date.parse(NOW));
  assert.equal(line, "13 Nov 2026 10:00 Outcome email 13 Nov 2026: Sadly it is not this time.");
  const current = { status: "interview", stages_reached: ["applied", "screening", "interview"], lesson: "Prepare the system design round", followup_date: null, notes: "Call went well\nApplied via referral" };
  const write: ClosingWrite = { status: "rejected", close_reason: "rejected", closed_at: "2026-11-13T12:00:00.000Z", lesson: current.lesson };
  const decision = decideClosingWrite(current, write, WORD, NOW);
  assert.ok("fields" in decision, "the user's click may end an application that reached interview");
  // What the route stores: the snapshot, with the line this close added.
  const snapshot = normalizeUndoSnapshot({ ...decision.fields.undo_snapshot, note: line });
  assert.equal(snapshot?.note, line);
  assert.equal(snapshot?.status, "interview");
  const closedNotes = `${line}\n${current.notes}`;
  const back = undoWrite(snapshot!, { followup_date: null, notes: closedNotes });
  assert.equal(back.status, "interview");
  assert.equal(back.closed_at, null);
  assert.equal(back.lesson, "Prepare the system design round");
  assert.equal(back.notes, current.notes, "only the close's own line goes");
  assert.equal("followup_date" in back, false);
  // A note added by someone else after the close stays, wherever the close's line now sits.
  const later = undoWrite(snapshot!, { notes: `13 Nov 2026 10:00 Recruiter rang back\n${closedNotes}` });
  assert.equal(later.notes, `13 Nov 2026 10:00 Recruiter rang back\n${current.notes}`);
  // The only note the application had: the notes are empty again, not a blank line.
  assert.equal(undoWrite(snapshot!, { notes: line }).notes, null);
  // A line the notes no longer hold changes nothing.
  assert.equal("notes" in undoWrite(snapshot!, { notes: "Edited since" }), false);
});

test("an undo restores the follow-up and takes back both lines the close wrote", () => {
  const line = "13 Nov 2026 10:00 Outcome email 13 Nov 2026: Unfortunately you were unsuccessful.";
  const snapshot = normalizeUndoSnapshot({ status: "applied", followup_date: "2026-11-20", at: NOW, note: line })!;
  const notes = `${line}\nMine\nFollow-up 2026-11-20 cleared when marked Rejected on 2026-11-13.`;
  const back = undoWrite(snapshot, { followup_date: null, notes });
  assert.equal(back.followup_date, "2026-11-20");
  assert.equal(back.notes, "Mine");
});

test("a stored snapshot's note is bounded: one line, no longer than a stamped note", () => {
  const base = { status: "applied", at: NOW };
  assert.equal(normalizeUndoSnapshot({ ...base, note: "a\nb" })?.note, undefined);
  assert.equal(normalizeUndoSnapshot({ ...base, note: "x".repeat(601) })?.note, undefined);
  assert.equal(normalizeUndoSnapshot({ ...base, note: 7 })?.note, undefined);
  assert.equal(normalizeUndoSnapshot({ ...base, note: "  " })?.note, undefined);
  assert.equal(normalizeUndoSnapshot(base)?.note, undefined);
  // A close with no note keeps the snapshot it always had.
  assert.equal("note" in normalizeUndoSnapshot(base)!, false);
});

// ── Words on the page ───────────────────────────────────────────────────────

test("the note for an outcome picked by hand, and the next step after one", () => {
  assert.equal(manualOutcomeNoteLine("2026-11-13", "Rejected"), "Outcome 13 Nov 2026: Rejected.");
  assert.equal(manualOutcomeNoteLine("2026-11-13", "No reply", " chased  twice "), "Outcome 13 Nov 2026: No reply. chased twice");
  assert.ok(manualOutcomeNoteLine("2026-11-13", "Rejected", "y".repeat(900)).length <= MAX_APPENDED_NOTE);
  assert.deepEqual(nextStepAfterOutcome({ dueSoon: 0, followupsToday: 2 }), { kind: "followups", text: "2 follow-ups are due today.", action: "Show them" });
  assert.deepEqual(nextStepAfterOutcome({ dueSoon: 0, followupsToday: 1 }), { kind: "followups", text: "1 follow-up is due today.", action: "Show it" });
  assert.equal(nextStepAfterOutcome({ dueSoon: 1, followupsToday: 9 }).kind, "due", "a deadline comes before a follow-up");
  assert.equal(nextStepAfterOutcome({ dueSoon: 3, followupsToday: 0 }).text, "3 things are due in the next 48 hours.");
  assert.equal(nextStepAfterOutcome({ dueSoon: 0, followupsToday: 0 }).kind, "apply");
});

test("the tab that holds rejections says so, and the fix card names only what is wrong", () => {
  assert.equal(TAB_LABELS.closed, "Rejected / closed");
  assert.equal(fixLabel({ statusToFix: 0, attachmentsToFix: 11 }), "Applications with no job description or CV");
  assert.equal(fixLabel({ statusToFix: 2, attachmentsToFix: 0 }), "Applications with the wrong status");
  assert.equal(fixLabel({ statusToFix: 2, attachmentsToFix: 11 }), "Applications to fix · 2 with the wrong status, 11 with no job description or CV");
  assert.equal(fixLabel({ statusToFix: 0, attachmentsToFix: 0 }), "Applications to fix");
  for (const label of [fixLabel({ statusToFix: 0, attachmentsToFix: 11 }), fixLabel({ statusToFix: 2, attachmentsToFix: 11 })]) assert.ok(!/\bJD\b|\bdata\b/i.test(label), label);
});
