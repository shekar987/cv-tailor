// The fresh review of Chunk 18 (6 Nov 2026): every input it proved wrong, pinned.
// Made-up companies and addresses throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coldEmailRecord, isColdOutreach, planBulkUpsert, readColdEmails, type ExistingRow } from "../src/lib/coldEmails.ts";
import { computeInsights, rowFromApplication } from "../src/lib/insights.ts";
import { missingAttachments, rowCheck } from "../src/lib/tracker.ts";

const TODAY = "2026-11-06";
const row = (over: Record<string, unknown> = {}) => ({ company_name: "Acme", role: "Cold email", contact_email: "jane@acme.example", date_sent: "2026-11-02", followup_date: null, notes: null, ...over });
const read = (list: unknown[]) => readColdEmails(list, TODAY).rows;
type Existing = ExistingRow & { date_applied?: string | null; notes?: string | null };

test("a hand-logged cold row stands for one email at most, never months later", () => {
  const june: Existing[] = [{ id: "h1", company_name: "Stark", role: "Cold email", status: "Rejected", source: "manual", contact_email: null, date_applied: "2026-06-01" }];
  const plan = planBulkUpsert(june, read([row({ company_name: "Stark", contact_email: "pepper@stark.example" }), row({ company_name: "Stark", contact_email: "happy@stark.example" })]));
  assert.equal(plan.insert.length, 2, "two November emails are two new rows");
  assert.deepEqual(plan.existing, []);
  // Logged the same week: it stands for ONE of them.
  const sameWeek: Existing[] = [{ ...june[0], status: "Applied", date_applied: "2026-11-02" }];
  const p2 = planBulkUpsert(sameWeek, read([row({ company_name: "Stark", contact_email: "pepper@stark.example" }), row({ company_name: "Stark", contact_email: "happy@stark.example" })]));
  assert.equal(p2.existing.length, 1);
  assert.equal(p2.insert.length, 1);
});

test("a row renamed in place is still the same email: the address is matched with the company read loosely", () => {
  const renamed: Existing[] = [{ id: "u1", company_name: "Umbrella Corporation", contact_email: "ada@umbrella.example", status: "Applied", source: "cold-email" }];
  const plan = planBulkUpsert(renamed, read([row({ company_name: "umbrella", contact_email: "Ada@Umbrella.example" })]));
  assert.deepEqual(plan.insert, []);
  assert.equal(plan.existing[0].id, "u1");
  // "Acme Ltd" and "Acme" with a zero-width space are Acme.
  const acme: Existing[] = [{ id: "a1", company_name: "Acme", contact_email: "jane@acme.example", status: "Applied", source: "cold-email" }];
  for (const company of ["Acme Ltd", "Acme​"]) assert.deepEqual(planBulkUpsert(acme, read([row({ company_name: company })])).insert, [], company);
  // The same address at a clearly different company is another email (an agency recruiter).
  assert.equal(planBulkUpsert(acme, read([row({ company_name: "Initech" })])).insert.length, 1);
});

test("rows logged by hand are recognised by a wider role pattern, or by the address in their notes", () => {
  const outreach: Existing[] = [{ id: "o1", company_name: "Cyberdyne", role: "Cold-email outreach", status: "Applied", source: "manual", contact_email: null, date_applied: "2026-11-01" }];
  assert.deepEqual(planBulkUpsert(outreach, read([row({ company_name: "Cyberdyne", contact_email: "miles@cyberdyne.example" })])).insert, []);
  const byNotes: Existing[] = [{ id: "n1", company_name: "Cyberdyne", role: "Software Engineer", status: "Applied", source: "manual", contact_email: null, date_applied: "2026-08-01", notes: "Cold email sent to Miles@cyberdyne.example" }];
  const plan = planBulkUpsert(byNotes, read([row({ company_name: "Cyberdyne", contact_email: "miles@cyberdyne.example" })]));
  assert.deepEqual(plan.existing.map((e) => [e.id, e.matchedWithoutEmail]), [["n1", true]]);
  // A row naming a different address is not this one, however close its date.
  const other: Existing[] = [{ ...byNotes[0], role: "Cold email", date_applied: "2026-11-02", notes: "Sent to sarah@cyberdyne.example" }];
  assert.equal(planBulkUpsert(other, read([row({ company_name: "Cyberdyne", contact_email: "miles@cyberdyne.example" })])).insert.length, 1);
});

test("a NUL or a control character never fails the batch; an address after mailto: is trimmed", () => {
  const rows = read([row({ notes: "sent\u0000 with a NUL" }), row({ company_name: "Globex", contact_email: "mailto: new@globex.example", notes: "fine" })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].row.notes, "sent with a NUL");
  assert.equal(coldEmailRecord(rows[1].row, "applied").contact_email, "new@globex.example");
});

test("cold outreach has no seniority, so it never swells the mid-level lane; it has a bucket of its own", () => {
  assert.equal(isColdOutreach({ role: "Cold email: platform team" }), true);
  assert.equal(isColdOutreach({ role: "Speculative application" }), true);
  assert.equal(isColdOutreach({ source: "cold-email", role: "Backend" }), true);
  assert.equal(isColdOutreach({ role: "Backend Engineer" }), false);
  assert.equal(rowFromApplication({ status: "Applied", role: "Cold email", source: "cold-email" }).seniority, undefined);
  assert.equal(rowFromApplication({ status: "Applied", role: "Cold email to Acme", source: "manual" }).seniority, undefined);
  assert.equal(rowFromApplication({ status: "Applied", role: "Backend Engineer", source: "manual" }).seniority, "mid");
  const insights = computeInsights([rowFromApplication({ status: "Applied", role: "Cold email", source: "cold-email", company_name: "Acme" })]);
  assert.ok(JSON.stringify(insights).includes("Cold email"), "the source group names cold emails");
});

test("a cold-email row never asks for a JD check or a CV file", () => {
  assert.equal(rowCheck({ status: "Applied", source: "cold-email", has_job_description: false }), null);
  assert.deepEqual(missingAttachments({ status: "Screening", source: "cold-email", has_job_description: false }), []);
  assert.deepEqual(missingAttachments({ status: "Screening", source: "manual", has_job_description: false }), ["Missing JD", "Missing CV"]);
});
