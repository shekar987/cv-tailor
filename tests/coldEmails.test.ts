// Cold emails from Gmail Sent, logged on the tracker (lib/coldEmails, 6 Nov 2026,
// Chunk 18): one row per (company, contact), an existing row never changed, the
// same payload twice inserting nothing. Made-up companies and addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coldEmailKey,
  coldEmailNeedsFollowup,
  coldEmailRecord,
  COLD_EMAIL_SOURCE,
  DEFAULT_COLD_ROLE,
  MAX_BULK_ROWS,
  planBulkUpsert,
  readColdEmails,
  type ExistingRow,
} from "../src/lib/coldEmails.ts";

const TODAY = "2026-11-06";
const row = (over: Record<string, unknown> = {}) => ({ company_name: "Acme", role: "Cold email: Backend", contact_email: "jane@acme.example", date_sent: "2026-10-30", followup_date: "2026-11-06", notes: "Sent from Gmail", ...over });
const read = (list: unknown[]) => readColdEmails(list, TODAY);

test("the dedupe key is the company and the address, folded for case and spaces", () => {
  assert.equal(coldEmailKey("  Acme  Ltd ", "Jane@Acme.example "), coldEmailKey("acme ltd", "jane@acme.example"));
  assert.notEqual(coldEmailKey("Acme", "jane@acme.example"), coldEmailKey("Acme", "joe@acme.example"));
  assert.equal(coldEmailKey("Acme", "mailto:jane@acme.example"), coldEmailKey("Acme", "jane@acme.example"));
});

test("a row the tracker already holds is reported, never planned as a write", () => {
  const existing: ExistingRow[] = [{ id: "a1", company_name: "ACME", contact_email: "JANE@acme.example", status: "Screening", source: "cold-email", role: "Cold email" }];
  const plan = planBulkUpsert(existing, read([row()]).rows);
  assert.deepEqual(plan.insert, []);
  assert.deepEqual(plan.existing, [{ index: 0, id: "a1", status: "Screening", matchedWithoutEmail: false }]);
  // The plan has inserts and references only: no field could carry a status change.
  assert.deepEqual(Object.keys(plan).sort(), ["duplicateInPayload", "existing", "insert"]);
});

test("posting the same payload twice inserts nothing the second time", () => {
  const payload = [row(), row({ company_name: "Bravo", contact_email: "sam@bravo.example" })];
  const first = planBulkUpsert([], read(payload).rows);
  assert.equal(first.insert.length, 2);
  // What the first post wrote, as the tracker would hold it.
  const written: ExistingRow[] = first.insert.map(({ row: r }, i) => ({ id: `n${i}`, ...coldEmailRecord(r, "Applied") }) as ExistingRow);
  const second = planBulkUpsert(written, read(payload).rows);
  assert.deepEqual(second.insert, []);
  assert.equal(second.existing.length, 2);
});

test("the same pair twice in one payload is one row", () => {
  const plan = planBulkUpsert([], read([row(), row({ company_name: "acme ", contact_email: "JANE@acme.example", notes: "again" })]).rows);
  assert.equal(plan.insert.length, 1);
  assert.deepEqual(plan.duplicateInPayload, [1]);
});

test("a second contact at the same company is a second row; a cold email logged by hand without an address is the same one", () => {
  const withEmail: ExistingRow[] = [{ id: "a1", company_name: "Acme", contact_email: "jane@acme.example", status: "Applied", source: "cold-email" }];
  assert.equal(planBulkUpsert(withEmail, read([row({ contact_email: "joe@acme.example" })]).rows).insert.length, 1);
  const byHand: ExistingRow[] = [{ id: "m1", company_name: "Acme", contact_email: null, status: "Applied", source: "manual", role: "Cold email to Acme" }];
  const plan = planBulkUpsert(byHand, read([row()]).rows);
  assert.deepEqual(plan.insert, []);
  assert.deepEqual(plan.existing, [{ index: 0, id: "m1", status: "Applied", matchedWithoutEmail: true }]);
  // A real application to the same company is not a cold email: the cold email is its own row.
  const job: ExistingRow[] = [{ id: "j1", company_name: "Acme", contact_email: null, status: "Interview", source: "tailored", role: "Backend Engineer" }];
  assert.equal(planBulkUpsert(job, read([row()]).rows).insert.length, 1);
});

test("a new row is Applied, source cold-email, dated the day it was sent", () => {
  const [{ row: r }] = read([row({ role: "" })]).rows;
  assert.equal(r.role, DEFAULT_COLD_ROLE);
  const record = coldEmailRecord(r, "Applied");
  assert.equal(record.status, "Applied");
  assert.equal(record.source, COLD_EMAIL_SOURCE);
  assert.equal(record.date_applied, "2026-10-30");
  assert.equal(record.contact_email, "jane@acme.example");
  assert.ok(!("confirmed_by_user" in record) && !("id" in record), "a new row only, never a write to another");
});

test("each bad row is reported by its index; the good ones still go", () => {
  const r = read([
    row(),
    row({ company_name: "" }),
    row({ contact_email: "Gmail" }),
    row({ date_sent: "2026-13-01" }),
    row({ date_sent: "2026-12-01" }),
    row({ followup_date: "2026-10-01" }),
    "not a row",
  ]);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.problems.map((p) => p.index), [1, 2, 3, 4, 5, 6]);
  assert.match(r.problems[1].error, /contact_email/);
  assert.match(r.problems[3].error, /future/);
  assert.deepEqual(readColdEmails({ rows: [row()] }, TODAY).rows.length, 1, "{ rows: [...] } too");
  assert.equal(readColdEmails({ nope: 1 }, TODAY).problems[0].index, -1);
  assert.equal(readColdEmails(Array.from({ length: MAX_BULK_ROWS + 1 }, () => row()), TODAY).tooMany, true);
});

test("the tracker filter: a cold email, still Applied, with no follow-up date", () => {
  assert.equal(coldEmailNeedsFollowup({ source: "cold-email", status: "applied", followup_date: null }), true);
  assert.equal(coldEmailNeedsFollowup({ source: "cold-email", status: "Applied", followup_date: "" }), true);
  assert.equal(coldEmailNeedsFollowup({ source: "cold-email", status: "applied", followup_date: "2026-11-13" }), false);
  assert.equal(coldEmailNeedsFollowup({ source: "cold-email", status: "screening", followup_date: null }), false);
  assert.equal(coldEmailNeedsFollowup({ source: "manual", status: "applied", followup_date: null }), false);
});
