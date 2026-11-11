// The fresh review of Chunk 21 (10 Nov 2026, of ed9c749): every input it proved wrong, pinned.
// The rule this round, as in Chunk 17: where the code can't be sure, it leans the safe way. A
// rule is saved on its own only for a wait tied to applying again in one clause; everything
// else is offered on the row. Made-up companies throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toListRow } from "../src/lib/applicationRows.ts";
import { decideNotesWrite, sameVersion } from "../src/lib/notesWrite.ts";
import { checkCompanyRules, readCooldowns, ruleExists, sameCompany, sameRole, type CompanyRule } from "../src/lib/companyRules.ts";
import { dueWithin } from "../src/lib/deadlines.ts";
import { liveOrder } from "../src/lib/closing.ts";
import { MAX_APPLIED_NOTES_CHARS, MAX_NOTES_CHARS } from "../src/lib/limits.ts";

test("1: the list never hands out a version a notes replace could send", () => {
  const stored = "2026-11-10T09:15:00.123456+00:00";
  const row = toListRow({ id: "a", company_name: "Contoso", role: "Engineer", status: "screening", stages_reached: ["applied", "screening"], notes: "x".repeat(951), updated_at: stored });
  assert.equal("updated_at" in row, false);
  assert.equal(typeof row.updated_minute, "number");
  // A sweep that sends back the preview with whatever the list gave is refused.
  const write = decideNotesWrite({ id: "a", notes: `New line\n${row.notes_preview}`, if_updated_at: row.updated_minute });
  assert.ok("refuse" in write && write.refuse.status === 409);
  assert.equal(sameVersion(stored, String(row.updated_minute)), false);
  // The Live order still reads it.
  const older = { updated_minute: (row.updated_minute as number) - 5, pending_outcome: null };
  const newer = { updated_minute: row.updated_minute as number, pending_outcome: null };
  assert.deepEqual([older, newer].sort((x, y) => liveOrder(x, y, () => Infinity)), [newer, older]);
});

test("2: ordinary rejection wording is never a rule", () => {
  for (const text of [
    "Due to the high volume of applications this year, we are unable to progress your application.",
    "We will keep your details on file for 6 months, and you are welcome to apply again for other roles.",
    "Unfortunately we will not be moving forward with your application for this position; however, we encourage you to apply again in the future.",
    "Will wait a month before following up.",
    "We are not accepting further applications for our 12-month placement programme.",
    "The 2-year graduate scheme is no longer accepting new applications.",
  ]) assert.deepEqual(readCooldowns(text, "2026-11-10"), [], text);
});

test("2: only a wait tied to applying again saves itself; the rest is offered on the row", () => {
  const sure = (t: string) => readCooldowns(t, "2026-11-10").map((d) => [d.rule_type, d.value, d.sure]);
  assert.deepEqual(sure("Please wait at least one year before applying again."), [["reapply_after_days", "365", true]]);
  assert.deepEqual(sure("Candidates may re-apply after 90 days."), [["reapply_after_days", "90", true]]);
  assert.deepEqual(sure("You will need to wait 12 months before you can reapply."), [["reapply_after_days", "365", true]]);
  assert.deepEqual(sure("We won't accept new applications from you for 12 months."), [["reapply_after_days", "365", true]]);
  // Offered, never saved on their own.
  assert.deepEqual(sure("We won't be able to accept any new applications from you during this intake year."), [["no_reapply_until", null, false]]);
  assert.deepEqual(sure("We can't accept another application from you this year."), [["no_reapply_until", "2027-01-01", false]]);
  assert.deepEqual(sure("We are unable to consider further applications from you for the same role."), [["same_role_block", null, false]]);
});

test("3: a posting's own words give no false Skip", () => {
  const rows = [
    { company_name: "Contoso", role: "Data Analyst", status: "applied", date_applied: "2026-09-01" },
    { company_name: "Fabrikam", role: "Software Engineer", status: "rejected", date_applied: "2026-06-01" },
  ];
  const at = (company: string, role: string, jdText: string) => checkCompanyRules({ company, role, jdText, rules: [], rows, today: "2026-11-10" });
  assert.deepEqual(at("Fabrikam", "Platform Engineer", "Our Applied Science team has doubled over the past year, and we are not slowing down."), []);
  assert.deepEqual(at("Fabrikam", "Platform Engineer", "Applied AI is not a side project here: we have shipped 4 models in the last 18 months."), []);
  assert.deepEqual(at("Fabrikam", "Platform Engineer", "We're happy to wait 3 months for the right person's notice period."), []);
  // "For this position" counts this role's applications, not the company's.
  const thisRole = "If you have applied for this position in the last 6 months, please do not reapply.";
  assert.deepEqual(at("Contoso", "Software Engineer", thisRole), [], "a Data Analyst row two months ago is another role");
  assert.match(at("Contoso", "Data Analyst", thisRole)[0]?.phrase ?? "", /^reapply after 3 Mar 2027 \(you applied 1 Sep 2026\)/);
  // "To us" counts any application there.
  assert.match(at("Contoso", "Software Engineer", "If you have applied to us in the last 6 months, please do not reapply.")[0]?.phrase ?? "", /^reapply after 3 Mar 2027/);
});

test("4: the notes cap leaves room for the sweeps' lines on a tailored row", () => {
  assert.equal(MAX_APPLIED_NOTES_CHARS, 2_000);
  assert.ok(MAX_NOTES_CHARS >= MAX_APPLIED_NOTES_CHARS * 4);
});

test("7: a new wait is saved when the old one has ended; one still running covers it", () => {
  const old: CompanyRule = { company_name: "Northwind Apps", rule_type: "reapply_after_days", value: "365", anchor_date: "2026-01-10", source_text: "wait at least one year" };
  const fresh = { company_name: "Northwind Apps", rule_type: "reapply_after_days" as const, value: "365", anchor_date: "2027-02-01", source_text: "Please wait at least one year before applying again." };
  assert.equal(ruleExists([old], fresh, { rows: [], auto: true }), false, "the old wait ended on 10 Jan 2027");
  const sameDay = { ...fresh, anchor_date: "2026-01-10" };
  assert.equal(ruleExists([old], sameDay, { rows: [], auto: true }), true);
  const shorter = { ...fresh, value: "90", anchor_date: "2026-02-01" };
  assert.equal(ruleExists([old], shorter, { rows: [], auto: true }), true, "a shorter wait inside the running one adds nothing");
});

test("8: rules match the whole company and the whole title, a place aside", () => {
  assert.equal(sameCompany("Wise", "Wise Owl Consulting"), false);
  assert.equal(sameCompany("Sage", "Sage Bionetworks"), false);
  assert.equal(sameCompany("Bending Example S.p.A.", "Bending Example"), true);
  assert.equal(sameCompany("Eleven Labs", "ElevenLabs"), true);
  assert.equal(sameCompany("Northwind Apps Ltd", "Northwind Apps"), true);
  for (const other of ["Software Engineer in Test", "Software Engineer, Machine Learning", "Software Engineer (Graduate)", "Senior Software Engineer"]) {
    assert.equal(sameRole("Software Engineer", other), false, other);
  }
  for (const same of ["Junior Data Platform Engineer - London", "Junior Data Platform Engineer (Remote)", "junior data platform engineer, London or Remote"]) {
    assert.equal(sameRole("Junior Data Platform Engineer", same), true, same);
  }
  const block: CompanyRule = { company_name: "Tailspin Lending", rule_type: "same_role_block", value: "Software Engineer", source_text: "not this role again" };
  assert.deepEqual(checkCompanyRules({ company: "Tailspin Lending", role: "Software Engineer in Test", rules: [block], rows: [], today: "2026-11-10" }), []);
});

test("10: a rule the user switched off is not made again from the same words; new words still count", () => {
  const off: CompanyRule = { company_name: "Contoso", rule_type: "reapply_after_days", value: "90", anchor_date: "2026-10-01", source_text: "Candidates may re-apply after 90 days.", dismissed_at: "2026-10-02T10:00:00Z" };
  assert.equal(ruleExists([off], { company_name: "Contoso", rule_type: "reapply_after_days", value: "90", anchor_date: "2026-11-10", source_text: "Candidates may re-apply after 90 days." }, { rows: [], auto: true }), true);
  assert.equal(ruleExists([off], { company_name: "Contoso", rule_type: "reapply_after_days", value: "365", anchor_date: "2026-11-10", source_text: "Please wait a year before applying again." }, { rows: [], auto: true }), false);
  // By hand, the user may add it back.
  assert.equal(ruleExists([off], { company_name: "Contoso", rule_type: "reapply_after_days", value: "90", anchor_date: "2026-10-01" }), false);
});

test("15: an assessment in the plan is on the radar, with the inbox it went to", () => {
  const now = Date.parse("2026-11-10T09:00:00Z");
  const rows = [
    { id: "g", company_name: "Greenbeam", status: "applied", applied_from_email: "second.inbox@example.com" },
    { id: "r", company_name: "Rejected Ltd", status: "rejected" },
  ];
  const events = [
    { id: "e1", application_id: "g", title: "Complete the online assessment", status: "scheduled", due_at: new Date(now + 40 * 3_600_000).toISOString() },
    { id: "e2", application_id: "g", title: "Interview", status: "done", starts_at: new Date(now + 5 * 3_600_000).toISOString() },
    { id: "e3", application_id: "r", title: "Old test", status: "scheduled", due_at: new Date(now + 5 * 3_600_000).toISOString() },
    { id: "e4", application_id: "g", title: "Next week", status: "scheduled", starts_at: new Date(now + 100 * 3_600_000).toISOString() },
  ];
  const due = dueWithin(rows, now, 48, "Europe/London", events);
  assert.deepEqual(due.map((d) => [d.kind, d.event_id, d.action]), [["event", "e1", "Complete the online assessment, invite went to second.inbox@example.com"]]);
  assert.match(due[0].when, /· due in 40h$/);
});

test("7b: the same wait added again without a date is the same rule, unless a later application dates it later", () => {
  const saved: CompanyRule = { company_name: "Northwind Apps", rule_type: "reapply_after_days", value: "365", anchor_date: "2026-07-05", source_text: "wait at least one year" };
  const undated = { company_name: "Northwind Apps Ltd", rule_type: "reapply_after_days" as const, value: "365" };
  assert.equal(ruleExists([saved], undated), true, "no rows: nothing dates it");
  assert.equal(ruleExists([saved], undated, { rows: [] }), true, "no application on record");
  const later = [{ company_name: "Northwind Apps", status: "rejected", date_applied: "2026-10-01" }];
  assert.equal(ruleExists([saved], undated, { rows: later }), false, "it ends on 1 Oct 2027, after the saved 5 Jul 2027");
  // A dated fresh wait after an old one ended is still new, rows or none.
  const old: CompanyRule = { ...saved, anchor_date: "2026-01-10" };
  assert.equal(ruleExists([old], { ...undated, anchor_date: "2027-02-01" }), false);
});
