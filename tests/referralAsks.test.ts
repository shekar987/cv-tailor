// Referrals on the tracker (lib/referrals + app/applications/ReferralAsks,
// 31 Oct 2026): the PUT's validation, which referrals are open, the next
// action in words, and the strip as rendered. The .tsx loads through
// tests/support/tsxLoader.mjs. Names and companies are made up.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { referralAsks, validateReferralFields, nextReferralAction, nextReferralStatus, REFERRAL_STATUSES, type ReferralRow } from "../src/lib/referrals.ts";
import { ReferralAsks, ReferralEditor } from "../src/app/applications/ReferralAsks.tsx";

const row = (over: Partial<ReferralRow>): ReferralRow => ({
  id: "r1",
  company_name: "Acme",
  role: "Software Engineer",
  date_applied: "2026-10-20",
  status: "Applied",
  referral: true,
  referrer_name: null,
  req_id: null,
  referral_status: "offered",
  ...over,
});

test("the statuses run offered → details sent → referred → applied", () => {
  assert.deepEqual([...REFERRAL_STATUSES], ["offered", "details_sent", "referred", "applied"]);
  assert.equal(nextReferralStatus("offered"), "details_sent");
  assert.equal(nextReferralStatus("details_sent"), "referred");
  assert.equal(nextReferralStatus("referred"), "applied");
  assert.equal(nextReferralStatus("applied"), null);
});

test("validateReferralFields: types, lengths, and the status the toggle implies", () => {
  assert.deepEqual(validateReferralFields({ referral: true }), { fields: { referral: true, referral_status: "offered" } });
  assert.deepEqual(validateReferralFields({ referral: false }), { fields: { referral: false, referral_status: null } });
  assert.deepEqual(validateReferralFields({ referral_status: "details_sent" }), { fields: { referral_status: "details_sent", referral: true } });
  assert.deepEqual(validateReferralFields({ referrer_name: "  Nitish   Rao ", req_id: "" }), { fields: { referrer_name: "Nitish Rao", req_id: null } });
  assert.deepEqual(validateReferralFields({ notes: "x" }), { fields: {} }, "no referral keys: nothing");
  assert.ok("error" in validateReferralFields({ referral: "yes" }));
  assert.ok("error" in validateReferralFields({ referral_status: "to_ask" }), "the old status names are refused");
  assert.ok("error" in validateReferralFields({ req_id: "R".repeat(61) }));
  assert.ok("error" in validateReferralFields({ referrer_name: 42 }));
});

test("the next action in words", () => {
  assert.equal(nextReferralAction(row({ referrer_name: "Nitish", referral_status: "offered" })), "Send details to Nitish");
  assert.equal(nextReferralAction(row({ company_name: "Deloitte", referral_status: "referred" })), "Finish Deloitte application");
  assert.equal(nextReferralAction(row({ referrer_name: "Nitish", referral_status: "details_sent" })), "Check Nitish has submitted the referral");
  assert.equal(nextReferralAction(row({ referrer_name: null, referral_status: "offered" })), "Send your details to the person referring you");
});

test("referralAsks: every referral not yet applied, oldest first", () => {
  const rows = [
    row({ id: "a", referral_status: "details_sent", date_applied: "2026-10-12" }),
    row({ id: "b", referral_status: "offered", date_applied: "2026-10-25" }),
    row({ id: "c", referral_status: "referred", date_applied: "2026-10-02" }),
    row({ id: "d", referral_status: "applied", date_applied: "2026-09-01" }),
    row({ id: "e", referral: false, referral_status: null }),
    row({ id: "f", status: "Rejected", date_applied: "2026-09-02" }),
    row({ id: "g", referral_status: null, date_applied: "2026-10-10" }),
  ];
  assert.deepEqual(referralAsks(rows).map((r) => r.id), ["c", "g", "a", "b"]);
});

test("the strip renders each open referral with its next action, the req ID and one step", () => {
  const rows = [
    row({ id: "r1", company_name: "Kainos", role: "Graduate Software Engineer", referrer_name: "Nitish", req_id: "REQ-2041", referral_status: "offered", date_applied: "2026-10-20" }),
    row({ id: "r2", company_name: "Deloitte", role: "Graduate Developer", referral_status: "referred", date_applied: "2026-10-05" }),
    row({ id: "r3", company_name: "Done Ltd", referral_status: "applied" }),
  ];
  const html = renderToStaticMarkup(createElement(ReferralAsks, { rows, onStep: () => {} }));
  assert.match(html, /<section class="referralAsks" aria-labelledby="referral-asks-title" data-referral-asks="true">/);
  assert.match(html, /<h2 id="referral-asks-title"[^>]*>Referral asks <span class="referralAsks__count">2<\/span><\/h2>/);
  assert.match(html, /data-referral-action="true">Send details to Nitish<\/strong>/);
  assert.match(html, /data-referral-action="true">Finish Deloitte application<\/strong>/);
  assert.match(html, /Kainos · Graduate Software Engineer · Req ID REQ-2041 · since 20 Oct 2026/);
  assert.match(html, /data-referral-step="details_sent"[^>]*>Mark details sent<\/button>/);
  assert.match(html, /data-referral-step="applied"[^>]*>Mark applied<\/button>/);
  assert.doesNotMatch(html, /Done Ltd/, "an applied referral is no longer in the strip");
  assert.ok(html.indexOf("Deloitte") < html.indexOf("Kainos"), "oldest first");
});

test("the strip is absent with no open referral; a busy row's step is disabled", () => {
  assert.equal(renderToStaticMarkup(createElement(ReferralAsks, { rows: [row({ referral: false })], onStep: () => {} })), "");
  const busy = renderToStaticMarkup(createElement(ReferralAsks, { rows: [row({ id: "r1" })], onStep: () => {}, busyId: "r1" }));
  assert.match(busy, /<button type="button" class="linkBtn" data-referral-step="details_sent" disabled="">/);
});

test("the editor shows the row's referral; its fields only once a referral is on", () => {
  const on = renderToStaticMarkup(createElement(ReferralEditor, { row: row({ referrer_name: "Nitish", req_id: "REQ-2041", referral_status: "details_sent" }), onSave: async () => null }));
  assert.match(on, /type="checkbox"[^>]*checked=""/);
  assert.match(on, /data-referrer-name="true" value="Nitish"/);
  assert.match(on, /data-req-id="true" value="REQ-2041"/);
  assert.match(on, /<option value="details_sent" selected="">Details sent<\/option>/);
  const off = renderToStaticMarkup(createElement(ReferralEditor, { row: row({ referral: false, referral_status: null }), onSave: async () => null }));
  assert.doesNotMatch(off, /data-referrer-name/);
  assert.match(off, /Save referral/);
});
