import { test } from "node:test";
import assert from "node:assert/strict";
import { byFollowupPriority, followupPriority, todaysFollowups, TODAYS_FOLLOWUPS_LIMIT } from "../src/lib/followupPriority.ts";

const today = "2026-11-19";
const due = (over: Record<string, unknown>) => ({ followup_date: "2026-11-10", status: "applied", ...over });

test("stage outranks every lesser signal combined", () => {
  const interview = followupPriority(due({ status: "interview" }));
  const atsWithEverything = followupPriority(
    due({ status: "applied", last_contact_from: "them", contact_email: "x@y.com", referral: true })
  );
  assert.ok(interview > atsWithEverything, "an interview-stage follow-up is always read first");
});

test("the order is stage > human replied > named contact > referral > ATS-only", () => {
  const stage = followupPriority(due({ status: "screening" }));
  const replied = followupPriority(due({ last_contact_from: "them" }));
  const named = followupPriority(due({ contact_email: "a@b.com" }));
  const referral = followupPriority(due({ referral: true }));
  const ats = followupPriority(due({}));
  assert.ok(stage > replied && replied > named && named > referral && referral > ats);
  assert.equal(ats, 0);
});

test("assessment and offer count as progressed stages", () => {
  assert.ok(followupPriority(due({ status: "assessment" })) >= 1000);
  assert.ok(followupPriority(due({ status: "offer" })) >= 1000);
});

test("byFollowupPriority ranks high first, oldest date breaking a tie", () => {
  const rows = [
    { id: "a", followup_date: "2026-11-15", status: "applied" },
    { id: "b", followup_date: "2026-11-01", status: "applied" },
    { id: "c", followup_date: "2026-11-18", status: "interview" },
  ];
  const ranked = byFollowupPriority(rows).map((r) => r.row.id);
  assert.deepEqual(ranked, ["c", "b", "a"], "interview first, then the older ATS follow-up");
});

test("todaysFollowups caps at 15 and reports how many are hidden", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, followup_date: "2026-11-10", status: "applied" }));
  // One warm row dated later; it must still surface above the overdue ATS backlog.
  rows.push({ id: "warm", followup_date: "2026-11-19", status: "interview" });
  const out = todaysFollowups(rows, today);
  assert.equal(out.items.length, TODAYS_FOLLOWUPS_LIMIT);
  assert.equal(out.total, 41);
  assert.equal(out.hidden, 41 - 15);
  assert.equal(out.items[0].row.id, "warm", "the interview follow-up leads the list");
});

test("todaysFollowups skips rows not due and ended rows", () => {
  const rows = [
    { id: "future", followup_date: "2026-12-01", status: "applied" },
    { id: "rejected", followup_date: "2026-11-01", status: "rejected" },
    { id: "due", followup_date: "2026-11-10", status: "applied" },
  ];
  const out = todaysFollowups(rows, today);
  assert.deepEqual(out.items.map((i) => i.row.id), ["due"]);
});

test("ATS parser and no-reply addresses never receive the named-contact priority boost", () => {
  const parserAddresses = [
    "holiday-extras@jobs.workablemail.com",
    "no-reply@hire.lever.co",
    "hello+noreply@ably.com",
    "noreply@pinpoint.email",
    "notifications@smartrecruiters.com",
    "mailer-daemon@googlemail.com",
  ];
  for (const addr of parserAddresses) {
    assert.equal(followupPriority(due({ contact_email: addr })), 0, `${addr} should rank as ATS-only`);
  }
  assert.equal(followupPriority(due({ contact_email: "tom.mcdonnell@fanvue.com" })), 10);
  assert.equal(followupPriority(due({ contact_email: "no-reply@hire.lever.co", referrer_name: "Alex" })), 10);
});
