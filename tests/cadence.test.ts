import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHIVE_AFTER_DAYS, CADENCE_DAYS, CLOSE_AFTER_FOLLOWUPS, archiveCandidates, cadenceStep, canAutoClose,
  closeNoResponseCandidates, daysSinceApplied, isAtsOnly, nextCadenceDate, offerArchive, offerCloseNoResponse,
} from "../src/lib/cadence.ts";

const today = "2026-11-19";
// applied N days ago
const appliedDaysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

test("cadence points are T+7/14/21/30", () => {
  assert.deepEqual([...CADENCE_DAYS], [7, 14, 21, 30]);
});

test("cadenceStep counts the follow-ups that should have been sent", () => {
  assert.equal(cadenceStep({ date_applied: appliedDaysAgo(3) }, today), 0);
  assert.equal(cadenceStep({ date_applied: appliedDaysAgo(7) }, today), 1);
  assert.equal(cadenceStep({ date_applied: appliedDaysAgo(20) }, today), 2);
  assert.equal(cadenceStep({ date_applied: appliedDaysAgo(21) }, today), 3);
  assert.equal(cadenceStep({ date_applied: appliedDaysAgo(40) }, today), 4);
  assert.equal(cadenceStep({ date_applied: null }, today), 0);
});

test("nextCadenceDate gives the next owed date, null after T+30", () => {
  assert.equal(daysSinceApplied({ date_applied: appliedDaysAgo(10) }, today), 10);
  assert.equal(nextCadenceDate({ date_applied: appliedDaysAgo(10) }, today), appliedDaysAgo(10 - 14)); // T+14 ahead
  assert.equal(nextCadenceDate({ date_applied: appliedDaysAgo(40) }, today), null);
});

test("never-auto-close: a row at interview or screening is never a close candidate", () => {
  for (const status of ["screening", "interview", "assessment", "offer"]) {
    const row = { status, date_applied: appliedDaysAgo(60) };
    assert.equal(canAutoClose(row), false, `${status} is live`);
    assert.equal(offerCloseNoResponse(row, today), false);
    assert.equal(offerArchive(row, today), false);
  }
});

test("never-auto-close: a row where a human replied is never a close candidate", () => {
  const row = { status: "applied", date_applied: appliedDaysAgo(60), last_contact_from: "them" as const };
  assert.equal(canAutoClose(row), false);
  assert.equal(isAtsOnly(row), false);
  assert.equal(offerCloseNoResponse(row, today), false);
  assert.equal(offerArchive(row, today), false);
});

test("offerCloseNoResponse: ATS-only Applied row past the third follow-up", () => {
  assert.equal(CLOSE_AFTER_FOLLOWUPS, 3);
  assert.equal(offerCloseNoResponse({ status: "applied", date_applied: appliedDaysAgo(21) }, today), true);
  assert.equal(offerCloseNoResponse({ status: "applied", date_applied: appliedDaysAgo(20) }, today), false, "not yet T+21");
  // A named contact makes it not ATS-only.
  assert.equal(offerCloseNoResponse({ status: "applied", date_applied: appliedDaysAgo(30), contact_email: "a@b.com" }, today), false);
  // A referral too.
  assert.equal(offerCloseNoResponse({ status: "applied", date_applied: appliedDaysAgo(30), referral: true }, today), false);
});

test("offerArchive needs more than 45 days and confirmation (candidate only)", () => {
  assert.equal(ARCHIVE_AFTER_DAYS, 45);
  assert.equal(offerArchive({ status: "applied", date_applied: appliedDaysAgo(46) }, today), true);
  assert.equal(offerArchive({ status: "applied", date_applied: appliedDaysAgo(45) }, today), false, "exactly 45 is not past 45");
  assert.equal(offerArchive({ status: "applied", date_applied: appliedDaysAgo(100), last_contact_from: "them" as const }, today), false);
});

test("the candidate lists only return rows that pass the guard", () => {
  const rows = [
    { id: "ats-old", status: "applied", date_applied: appliedDaysAgo(50) },
    { id: "live", status: "interview", date_applied: appliedDaysAgo(50) },
    { id: "replied", status: "applied", date_applied: appliedDaysAgo(50), last_contact_from: "them" as const },
    { id: "fresh", status: "applied", date_applied: appliedDaysAgo(5) },
  ];
  assert.deepEqual(closeNoResponseCandidates(rows, today).map((r) => r.id), ["ats-old"]);
  assert.deepEqual(archiveCandidates(rows, today).map((r) => r.id), ["ats-old"]);
});
