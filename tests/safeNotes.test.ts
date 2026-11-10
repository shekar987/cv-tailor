// Chunk 21 (10 Nov 2026): append-only notes, company cooldown rules, the deadline radar.
// Made-up companies and addresses throughout; each stands in for one of the four real
// cases of 10 Nov (a one-year wait, a closed intake, a 90-day rule, the same role again).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addedLines, decideNotesWrite, draftKeepsNewLines, sameVersion, stampNoteLine, MAX_APPENDED_NOTE, STALE_NOTES } from "../src/lib/notesWrite.ts";
import { checkCompanyRules, describeRule, mergeCompanyHits, nextSeptember, readCooldowns, readRuleInput, ruleExists, sameRole, type CompanyRule } from "../src/lib/companyRules.ts";
import { deadlineFields, deadlineFromFields, dueIn, dueWithin, parseDueParam } from "../src/lib/deadlines.ts";
import { triageJd } from "../src/lib/triage/jdTriage.ts";
import { accountExportChunks } from "../src/lib/account.ts";

// --- Step 1: notes ------------------------------------------------------------------

test("an append needs no read: no version, no old text, just the line", () => {
  assert.deepEqual(decideNotesWrite({ id: "x", append_note: "  Screening call   booked  " }), { mode: "append", line: "Screening call booked" });
  assert.deepEqual(decideNotesWrite({ id: "x", append_note: "Booked", status: "screening" }), { mode: "append", line: "Booked" });
});

test("a replace without if_updated_at is a 409 stale_notes", () => {
  const r = decideNotesWrite({ id: "x", notes: "New line\nOld notes" });
  assert.ok("refuse" in r);
  assert.equal(r.refuse.status, 409);
  assert.equal(r.refuse.body.error, STALE_NOTES);
  for (const bad of ["", "yesterday", 1731234567, null]) {
    const again = decideNotesWrite({ id: "x", notes: "x", if_updated_at: bad });
    assert.ok("refuse" in again && again.refuse.status === 409, String(bad));
  }
});

test("a replace with a version passes to the version check, which a stale one fails", () => {
  const stored = "2026-11-10T09:15:00.123456+00:00";
  const r = decideNotesWrite({ id: "x", notes: "x", if_updated_at: stored });
  assert.deepEqual(r, { mode: "replace", ifUpdatedAt: stored });
  assert.equal(sameVersion(stored, stored), true);
  assert.equal(sameVersion(stored, "2026-11-10T09:15:00.123Z"), true, "the same instant through a Date");
  assert.equal(sameVersion(stored, "2026-11-10T09:14:59.000Z"), false, "the row moved on");
  assert.equal(sameVersion(null, stored), false);
});

test("notes and append_note together are refused; an over-long or empty line too", () => {
  const both = decideNotesWrite({ id: "x", notes: "a", append_note: "b", if_updated_at: "2026-11-10T09:00:00Z" });
  assert.ok("refuse" in both && both.refuse.status === 400);
  assert.ok("refuse" in decideNotesWrite({ append_note: "   " }));
  assert.ok("refuse" in decideNotesWrite({ append_note: "x".repeat(MAX_APPENDED_NOTE + 1) }));
  assert.deepEqual(decideNotesWrite({ status: "screening" }), { mode: "none" });
});

test("an added line is stamped with the London day and time", () => {
  // 10 Nov 2026 16:22 UTC is 16:22 in London (GMT); 5 Jul 2026 08:05 UTC is 09:05 BST.
  assert.equal(stampNoteLine("Assessment sent", Date.parse("2026-11-10T16:22:00Z")), "10 Nov 2026 16:22 Assessment sent");
  assert.equal(stampNoteLine("Applied", Date.parse("2026-07-05T08:05:00Z")), "5 Jul 2026 09:05 Applied");
});

test("addedLines is what a replacement adds", () => {
  assert.equal(addedLines("Applied 5 Jul.\nRecruiter: Sam", "Please wait a year before reapplying.\nApplied 5 Jul.\nRecruiter: Sam"), "Please wait a year before reapplying.");
  assert.equal(addedLines(null, "First"), "First");
});

test("after a 409 a page retries only when its draft already holds what the row gained", () => {
  const base = "Applied 5 Jul.";
  // Only another column moved: the notes are the same.
  assert.equal(draftKeepsNewLines(base, base, "My edit\nApplied 5 Jul."), true);
  // A line this page put into the draft itself (a removed stage, a reopen's note).
  assert.equal(draftKeepsNewLines(base, "Removed Interview\nApplied 5 Jul.", "Removed Interview\nMy edit\nApplied 5 Jul."), true);
  // A sweep's line the user never saw: they must look before anything is saved.
  assert.equal(draftKeepsNewLines(base, "10 Nov 2026 07:00 Assessment invite\nApplied 5 Jul.", "My edit\nApplied 5 Jul."), false);
});

test("the account export streams the notes history a version at a time, as the same JSON", () => {
  const payload = {
    applications: { rows: [{ id: "a", notes: "Now" }] },
    notesHistory: { rows: [{ id: "h1", old_notes: "Before\n\"quoted\"" }, { id: "h2", old_notes: "Earlier" }] },
    companyRules: { rows: [{ company_name: "Northwind Apps", rule_type: "reapply_after_days", value: "365" }] },
  };
  const chunks = [...accountExportChunks(payload)];
  assert.deepEqual(JSON.parse(chunks.join("")), payload);
  assert.ok(chunks.some((c) => c.startsWith('{"id":"h2"')), "one chunk per version");
});

// --- Step 2: company cooldown rules ----------------------------------------------------

test("the parser reads a wait, a closed intake, a 90-day rule and a same-role block", () => {
  const year = readCooldowns("5 Jul 2026 10:00 Rejected. Please wait at least one year before applying again.", null);
  assert.deepEqual(year.map((d) => [d.rule_type, d.value, d.anchor_date]), [["reapply_after_days", "365", "2026-07-05"]]);
  const intake = readCooldowns("Unfortunately we won't be able to accept any new applications from you during this intake year.", "2026-11-10");
  assert.equal(intake[0].rule_type, "no_reapply_until");
  assert.equal(intake[0].value, null, "an intake year has no date in it");
  assert.equal(intake[0].needs, "date");
  assert.equal(intake[0].suggested, "2027-09-01");
  const days = readCooldowns("Candidates may re-apply after 90 days.", "2026-10-01");
  assert.deepEqual(days.map((d) => [d.value, d.anchor_date]), [["90", "2026-10-01"]]);
  const role = readCooldowns("We will not be able to consider further applications for the same role.", "2026-09-17");
  assert.deepEqual(role.map((d) => [d.rule_type, d.needs]), [["same_role_block", "role"]]);
  const calendar = readCooldowns("We can't accept another application from you this year.", "2026-03-02");
  assert.equal(calendar[0].value, "2027-01-01");
});

test("the parser leaves ordinary rejections and reply times alone", () => {
  for (const text of [
    "Unfortunately we won't be progressing your application for this role.",
    "We aim to get back to you within 7 days.",
    "Please wait 2 weeks to hear back from us.",
    "Please allow 6 weeks for a decision.",
    "You will start with a 3 month probation period.",
    "We are not accepting applications at this time.",
    "Please wait 6 weeks while we review all applications.",
    "We've had a huge number of new applications over the past 3 months.",
    "Further applications received in the next 2 weeks will be considered in the second round.",
  ]) assert.deepEqual(readCooldowns(text, "2026-11-10"), [], text);
  // New or further applications count when the company refuses them, or they are the candidate's.
  assert.equal(readCooldowns("We won't accept new applications from you for 12 months.", "2026-11-10")[0]?.value, "365");
  assert.equal(readCooldowns("You are welcome to submit a new application in 6 months.", "2026-11-10")[0]?.value, "183");
});

test("a posting's own rule counts back from the last application", () => {
  const drafts = readCooldowns("If you have applied to us in the last 6 months, please do not reapply.", null);
  assert.deepEqual(drafts.map((d) => [d.value, d.anchor_date]), [["183", null]]);
  const year = readCooldowns("Candidates who applied within the past year will not be considered.", null);
  assert.equal(year[0].value, "365");
});

const rows = [
  { id: "1", company_name: "Northwind Apps Ltd", role: "Software Engineer", status: "Rejected", date_applied: "2026-07-05" },
  { id: "2", company_name: "Tailspin Lending", role: "Junior Data Platform Engineer", status: "rejected", date_applied: "2026-09-17" },
  { id: "3", company_name: "Contoso Voice", role: "Backend Engineer", status: "applied", date_applied: "2026-10-01" },
];
const rules: CompanyRule[] = [
  { company_name: "Northwind Apps", rule_type: "reapply_after_days", value: "365", anchor_date: "2026-07-05", source_text: "wait at least one year" },
  { company_name: "Fabrikam Consulting", rule_type: "no_reapply_until", value: "2027-09-01", source_text: "won't be able to accept any new applications ... this intake year" },
  { company_name: "Contoso Voice", rule_type: "reapply_after_days", value: "90", source_text: "90 days" },
  { company_name: "Tailspin Lending", rule_type: "same_role_block", value: "Junior Data Platform Engineer", source_text: "4 rejections on 17 Sep" },
];
const today = "2026-11-10";

test("a one-year wait reads Skip: reapply after 5 Jul 2027, from what they said", () => {
  const hits = checkCompanyRules({ company: "Northwind Apps", role: "Product Engineer", rules, rows, today });
  assert.deepEqual(hits.map((h) => [h.level, h.phrase]), [["skip", 'reapply after 5 Jul 2027, from "wait at least one year"']]);
  const merged = mergeCompanyHits(triageJd("Product Engineer at Northwind Apps. Python and React."), hits);
  assert.equal(merged?.verdict, "skip");
  assert.equal(`Skip: ${merged?.reasons[0]}`, 'Skip: reapply after 5 Jul 2027, from "wait at least one year"');
  // A year on, it no longer holds.
  assert.deepEqual(checkCompanyRules({ company: "Northwind Apps", role: "Product Engineer", rules, rows, today: "2027-07-05" }), []);
});

test("the same role again is blocked; a different role at that company is not", () => {
  const same = checkCompanyRules({ company: "Tailspin Lending", role: "Junior Data Platform Engineer - London", rules, rows, today });
  assert.equal(same[0].level, "skip");
  assert.match(same[0].phrase, /^same role blocked \(Junior Data Platform Engineer\), from "4 rejections on 17 Sep"$/);
  assert.equal(same.length, 1, "the history read adds nothing once the rule blocks");
  const other = checkCompanyRules({ company: "Tailspin Lending", role: "Graduate Analyst", rules, rows, today });
  assert.deepEqual(other, []);
  assert.equal(sameRole("Senior Data Platform Engineer", "Junior Data Platform Engineer"), false);
  assert.equal(sameRole("Data Platform Engineer", "Senior Data Platform Engineer"), false);
});

test("a closed intake and a 90-day wait counted from the last application", () => {
  assert.match(checkCompanyRules({ company: "Fabrikam Consulting", role: "Graduate Consultant", rules, rows, today })[0].phrase, /^no reapply until 1 Sep 2027/);
  // Contoso: applied 1 Oct, 90 days → 30 Dec 2026.
  assert.match(checkCompanyRules({ company: "Contoso Voice", role: "Platform Engineer", rules, rows, today })[0].phrase, /^reapply after 30 Dec 2026, from "90 days"$/);
  assert.deepEqual(checkCompanyRules({ company: "Contoso Voice", role: "Platform Engineer", rules, rows, today: "2026-12-30" }), []);
});

test("without a rule, the same role applied for before is a Review from the tracker", () => {
  const hits = checkCompanyRules({ company: "Northwind Apps", role: "Software Engineer", rules: [], rows, today });
  assert.deepEqual(hits.map((h) => [h.level, h.phrase]), [["review", "rejected for this role on 5 Jul 2026"]]);
  const live = checkCompanyRules({ company: "Contoso Voice", role: "Backend Engineer", rules: [], rows, today });
  assert.equal(live[0].phrase, "already applied for this role on 1 Oct 2026 (Applied)");
});

test("a posting's own wait is checked against the last application there", () => {
  const jd = "Backend Engineer, Contoso Voice. If you have applied to us in the last 6 months, please do not reapply.";
  const hits = checkCompanyRules({ company: "Contoso Voice", role: "Platform Engineer", jdText: jd, rules: [], rows, today });
  assert.match(hits[0].phrase, /^reapply after 2 Apr 2027 \(you applied 1 Oct 2026\), from "If you have applied/);
});

test("a dismissed rule, another company or no company says nothing", () => {
  assert.deepEqual(checkCompanyRules({ company: "Northwind Apps", role: "x", rules: rules.map((r) => ({ ...r, dismissed_at: "2026-11-10T10:00:00Z" })), rows: [], today }), []);
  assert.deepEqual(checkCompanyRules({ company: "Wide World Importers", role: "x", rules, rows, today }), []);
  assert.deepEqual(checkCompanyRules({ company: "", role: "x", rules, rows, today }), []);
  assert.equal(mergeCompanyHits(null, []), null);
});

test("rules are read from a body the way the table checks them", () => {
  const ok = readRuleInput({ company_name: " Northwind  Apps ", rule_type: "reapply_after_days", value: "365", anchor_date: "2026-07-05", source_text: "wait at least one year" });
  assert.ok("rule" in ok);
  assert.equal(ok.rule.company_key, "northwind apps");
  assert.equal(ok.rule.source, "manual");
  for (const bad of [
    { company_name: "", rule_type: "reapply_after_days", value: "90" },
    { company_name: "X", rule_type: "forever", value: "1" },
    { company_name: "X", rule_type: "reapply_after_days", value: "a year" },
    { company_name: "X", rule_type: "no_reapply_until", value: "next September" },
    { company_name: "X", rule_type: "no_reapply_until", value: "2027-02-30" },
    { company_name: "X", rule_type: "same_role_block", value: " " },
    { company_name: "X", rule_type: "no_reapply_until", value: "2027-09-01", anchor_date: "2026-01-01" },
  ]) assert.ok("error" in readRuleInput(bad), JSON.stringify(bad));
  assert.equal(ruleExists(rules, { company_name: "Northwind Apps Ltd", rule_type: "reapply_after_days", value: "365" }), true);
  assert.equal(ruleExists(rules, { company_name: "Northwind Apps", rule_type: "reapply_after_days", value: "90" }), false);
});

test("a saved rule describes itself and says whether it holds", () => {
  assert.deepEqual(describeRule(rules[0], rows, today), { line: "Reapply after 5 Jul 2027 (365 days)", inForce: true });
  assert.deepEqual(describeRule(rules[1], rows, "2027-09-01"), { line: "No new applications until 1 Sep 2027", inForce: false });
  assert.equal(nextSeptember("2026-08-31"), "2026-09-01");
  assert.equal(nextSeptember("2026-09-01"), "2027-09-01");
});

// --- Step 3: the deadline radar ----------------------------------------------------------

const NOW = Date.parse("2026-11-10T09:00:00Z");
const radarRows = [
  { id: "a", company_name: "Greenbeam", role: "Graduate Analyst", status: "Applied", next_deadline: new Date(NOW + 30 * 3_600_000).toISOString(), deadline_note: "Complete the Greenbeam assessment", applied_from_email: "second.inbox@example.com" },
  { id: "b", company_name: "Contoso", status: "interview", followup_date: "2026-11-11" },
  { id: "c", company_name: "Fabrikam", status: "screening", next_deadline: new Date(NOW + 72 * 3_600_000).toISOString() },
  { id: "d", company_name: "Tailspin", status: "rejected", next_deadline: new Date(NOW + 5 * 3_600_000).toISOString() },
  { id: "e", company_name: "Northwind", status: "applied", followup_date: "2026-11-10" },
  { id: "f", company_name: "Litware", status: "assessment", next_deadline: new Date(NOW - 2 * 3_600_000).toISOString() },
  { id: "g", company_name: "Adatum", status: "interview", next_deadline: new Date(NOW - 9 * 86_400_000).toISOString() },
  { id: "h", company_name: "Proseware", status: "interview", next_deadline: new Date(NOW + 3_600_000).toISOString(), closed_at: "2026-11-09T10:00:00Z" },
];

test("a deadline 30 hours away on a second address shows with the action in words", () => {
  const due = dueWithin(radarRows, NOW);
  const grey = due.find((d) => d.id === "a");
  assert.ok(grey);
  assert.equal(grey.kind, "deadline");
  assert.equal(grey.action, "Complete the Greenbeam assessment, invite went to second.inbox@example.com");
  assert.equal(grey.applied_from_email, "second.inbox@example.com");
  assert.equal(grey.when, "Wed 11 Nov, 15:00 · due in 30h");
  assert.equal(grey.overdue, false);
});

test("the radar keeps the window, the live stages and the recent overdue", () => {
  const due = dueWithin(radarRows, NOW);
  // Overdue first, then soonest: a follow-up counts from 09:00 on its day.
  assert.deepEqual(due.map((d) => `${d.id}:${d.kind}`), ["f:deadline", "b:followup", "a:deadline"]);
  assert.equal(due[0].overdue, true);
  assert.equal(due[0].action, "Complete the Litware assessment");
  assert.equal(due[1].action, "Follow up with Contoso (Interview)");
  // Ended rows, rows past the window, follow-ups on Applied rows and week-old deadlines stay out.
  assert.deepEqual(dueWithin(radarRows, NOW, 168).map((d) => d.id).sort(), ["a", "b", "c", "f"]);
});

test("the strip counts hours, and says overdue", () => {
  assert.equal(dueIn(NOW + 30 * 3_600_000, NOW), "due in 30h");
  assert.equal(dueIn(NOW + 47 * 3_600_000 + 59 * 60_000, NOW), "due in 47h");
  assert.equal(dueIn(NOW + 20 * 60_000, NOW), "due in 20m");
  assert.equal(dueIn(NOW - 2 * 3_600_000, NOW), "2h overdue");
});

test("?due= takes hours, up to a week", () => {
  assert.equal(parseDueParam(null), null);
  assert.equal(parseDueParam("48h"), 48);
  assert.equal(parseDueParam("168h"), 168);
  for (const bad of ["", "48", "2d", "0h", "169h", "-1h"]) assert.equal(parseDueParam(bad), "invalid", bad);
});

test("the form's date and time are London's, both ways", () => {
  assert.equal(deadlineFromFields("2026-07-05", "09:00"), "2026-07-05T08:00:00.000Z");
  assert.equal(deadlineFromFields("2026-11-12", ""), "2026-11-12T23:59:00.000Z");
  assert.equal(deadlineFromFields("", "09:00"), null);
  assert.deepEqual(deadlineFields("2026-07-05T08:00:00.000Z"), { date: "2026-07-05", time: "09:00" });
  assert.deepEqual(deadlineFields(null), { date: "", time: "" });
});
