// Referrals on the tracker (lib/referrals + app/applications/ReferralAsks,
// 31 Oct 2026): the PUT's validation, which asks are open, and the strip as
// rendered. The .tsx loads through tests/support/tsxLoader.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { referralAsks, validateReferralFields, nextReferralSteps, type ReferralRow } from "../src/lib/referrals.ts";
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
  referral_status: "to_ask",
  ...over,
});

test("validateReferralFields: types, lengths, and the status the toggle implies", () => {
  assert.deepEqual(validateReferralFields({ referral: true }), { fields: { referral: true, referral_status: "to_ask" } });
  assert.deepEqual(validateReferralFields({ referral: false }), { fields: { referral: false, referral_status: null } });
  assert.deepEqual(validateReferralFields({ referral_status: "asked" }), { fields: { referral_status: "asked", referral: true } });
  assert.deepEqual(validateReferralFields({ referrer_name: "  Sam   Lee ", req_id: "" }), { fields: { referrer_name: "Sam Lee", req_id: null } });
  assert.deepEqual(validateReferralFields({ notes: "x" }), { fields: {} }, "no referral keys: nothing");
  assert.ok("error" in validateReferralFields({ referral: "yes" }));
  assert.ok("error" in validateReferralFields({ referral_status: "pending" }));
  assert.ok("error" in validateReferralFields({ req_id: "R".repeat(61) }));
  assert.ok("error" in validateReferralFields({ referrer_name: 42 }));
});

test("referralAsks: open asks only, to-ask first, the longest-waiting first", () => {
  const rows = [
    row({ id: "a", company_name: "Asked Co", referral_status: "asked", date_applied: "2026-10-01" }),
    row({ id: "b", company_name: "Late", date_applied: "2026-10-25" }),
    row({ id: "c", company_name: "Early", date_applied: "2026-10-02" }),
    row({ id: "d", referral_status: "referred" }),
    row({ id: "e", referral_status: "declined" }),
    row({ id: "f", referral: false, referral_status: null }),
    row({ id: "g", status: "Rejected" }),
    row({ id: "h", referral_status: null, company_name: "No status yet", date_applied: "2026-10-10" }),
  ];
  assert.deepEqual(referralAsks(rows).map((r) => r.id), ["c", "h", "b", "a"]);
  assert.deepEqual(nextReferralSteps("to_ask"), ["asked"]);
  assert.deepEqual(nextReferralSteps("asked"), ["referred", "declined"]);
});

test("the strip renders each open ask with who to ask, the req ID and the next step", () => {
  const rows = [
    row({ id: "r1", company_name: "Kainos", role: "Graduate Software Engineer", referrer_name: "Sam Lee", req_id: "REQ-2041" }),
    row({ id: "r2", company_name: "Northgate Systems", role: "Backend Engineer", referral_status: "asked", date_applied: "2026-10-05" }),
    row({ id: "r3", company_name: "Closed Ltd", referral_status: "referred" }),
  ];
  const html = renderToStaticMarkup(createElement(ReferralAsks, { rows, onStep: () => {} }));
  assert.match(html, /<section class="referralAsks" aria-labelledby="referral-asks-title" data-referral-asks="true">/);
  assert.match(html, /<h2 id="referral-asks-title"[^>]*>Referral asks <span class="referralAsks__count">2<\/span><\/h2>/);
  assert.match(html, /data-referral-row="r1" data-referral-status="to_ask"/);
  assert.match(html, /Ask Sam Lee · Req ID REQ-2041 · Applied 20 Oct 2026/);
  assert.match(html, /Find someone who can refer you · Applied 5 Oct 2026/);
  assert.match(html, /data-referral-step="asked"[^>]*>Mark asked<\/button>/);
  assert.match(html, /data-referral-step="referred"[^>]*>Referred<\/button>/);
  assert.match(html, /data-referral-step="declined"[^>]*>Declined<\/button>/);
  assert.doesNotMatch(html, /Closed Ltd/, "a referred row is no longer an open ask");
  // The waiting one (to ask) comes before the asked one.
  assert.ok(html.indexOf("Kainos") < html.indexOf("Northgate Systems"));
});

test("the strip is absent with no open asks; a busy row's links are disabled", () => {
  assert.equal(renderToStaticMarkup(createElement(ReferralAsks, { rows: [row({ referral: false })], onStep: () => {} })), "");
  const busy = renderToStaticMarkup(createElement(ReferralAsks, { rows: [row({ id: "r1" })], onStep: () => {}, busyId: "r1" }));
  assert.match(busy, /<button type="button" class="linkBtn" data-referral-step="asked" disabled="">/);
});

test("the editor shows the row's referral; its fields only once a referral is on", () => {
  const on = renderToStaticMarkup(createElement(ReferralEditor, { row: row({ referrer_name: "Sam Lee", req_id: "REQ-2041", referral_status: "asked" }), onSave: async () => null }));
  assert.match(on, /type="checkbox"[^>]*checked=""/);
  assert.match(on, /data-referrer-name="true" value="Sam Lee"/);
  assert.match(on, /data-req-id="true" value="REQ-2041"/);
  assert.match(on, /<option value="asked" selected="">Asked<\/option>/);
  const off = renderToStaticMarkup(createElement(ReferralEditor, { row: row({ referral: false, referral_status: null }), onSave: async () => null }));
  assert.doesNotMatch(off, /data-referrer-name/);
  assert.match(off, /Save referral/);
});
