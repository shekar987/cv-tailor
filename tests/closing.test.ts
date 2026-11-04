import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRMATION_MESSAGE,
  activePending,
  backfillPatch,
  closedAtFromDate,
  closedRows,
  conversionBy,
  highestStage,
  liveOrder,
  mergePendingOutcome,
  needsConfirmation,
  normalizePendingOutcome,
  pendingLine,
  progressChip,
  reachedInterview,
  reachedScreening,
  reasonForStatus,
  resultLine,
  sourceOf,
  stageSummary,
  statusForReason,
  winsFunnel,
} from "../src/lib/closing.ts";

const screened = { status: "screening", stages_reached: ["applied", "screening"] };

test("a screened row needs the user's word to end, and only to end", () => {
  assert.equal(needsConfirmation(screened, "rejected", false), true);
  assert.equal(needsConfirmation(screened, "Rejected", false), true, "the sweeps' spelling");
  assert.equal(needsConfirmation(screened, "Withdrawn", false), true);
  assert.equal(needsConfirmation(screened, "ghosted", false), true);
  assert.equal(needsConfirmation(screened, "rejected", true), false, "confirmed");
  assert.equal(needsConfirmation(screened, "Interview", false), false, "a move forward needs nothing");
  assert.equal(CONFIRMATION_MESSAGE, "Needs the user's confirmation; set pending_outcome instead.");
});

test("writing the status a row already has moves nothing, so a sweep's notes update lands", () => {
  const ended = { status: "rejected", stages_reached: ["applied", "screening", "rejected"] };
  assert.equal(needsConfirmation(ended, "Rejected", false), false);
  assert.equal(needsConfirmation(ended, "Withdrawn", false), true, "another ending is still a move");
});

test("every stage from screening up is held, including a past one", () => {
  for (const stage of ["screening", "assessment", "interview", "offer", "accepted"]) {
    assert.equal(needsConfirmation({ status: stage, stages_reached: ["applied", stage] }, "rejected", false), true, stage);
  }
  assert.equal(needsConfirmation({ status: "applied", stages_reached: ["applied", "screening", "applied"] }, "rejected", false), true, "it has been there");
  assert.equal(needsConfirmation({ status: "Interview", stages_reached: null }, "Rejected", false), true, "no history yet: the status still counts");
});

test("an application that never got that far moves freely, as the sweeps expect", () => {
  assert.equal(needsConfirmation({ status: "applied", stages_reached: ["applied"] }, "Rejected", false), false);
  assert.equal(needsConfirmation({ status: "saved", stages_reached: ["saved"] }, "withdrawn", false), false);
});

test("highest stage: screening < assessment < interview < offer", () => {
  assert.equal(highestStage({ stages_reached: ["applied"] }), null);
  assert.equal(highestStage({ stages_reached: ["applied", "screening"] }), "screening");
  assert.equal(highestStage({ stages_reached: ["applied", "interview", "assessment"] }), "interview");
  assert.equal(highestStage({ stages_reached: ["applied", "screening", "assessment", "rejected"] }), "assessment");
  assert.equal(highestStage({ stages_reached: ["applied", "accepted"] }), "offer");
});

test("the chip says how far it got, more exactly where an event says", () => {
  assert.equal(progressChip(screened), "Screening call");
  assert.equal(progressChip(screened, [{ kind: "take_home" }]), "Test");
  assert.equal(progressChip(screened, [{ kind: "video" }]), "Video");
  assert.equal(progressChip({ stages_reached: ["applied", "assessment"] }), "Test");
  assert.equal(progressChip({ stages_reached: ["interview"] }), "Interview");
  assert.equal(progressChip({ stages_reached: ["interview"] }, [{ kind: "interview", stage_label: "Final round" }]), "Final");
  assert.equal(progressChip({ stages_reached: ["offer"] }), "Offer");
});

test("a reason stores a status, and one that says nothing of the CV sits with Withdrawn", () => {
  assert.equal(statusForReason("rejected"), "rejected");
  assert.equal(statusForReason("ghosted"), "ghosted");
  assert.equal(statusForReason("withdrawn"), "withdrawn");
  assert.equal(statusForReason("declined_by_me"), "withdrawn");
  assert.equal(statusForReason("role_closed"), "withdrawn");
  assert.equal(reasonForStatus("Rejected"), "rejected");
  assert.equal(reasonForStatus("Withdrawn"), "withdrawn");
});

test("a pending outcome is an ending, a real date and a short source, or nothing", () => {
  assert.deepEqual(normalizePendingOutcome({ outcome: "rejected", date: "2026-11-02", source: "gmail" }), { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  assert.deepEqual(normalizePendingOutcome({ outcome: "Rejected", date: "2026-11-02" }), { outcome: "rejected", date: "2026-11-02", source: "" });
  assert.equal(normalizePendingOutcome({ outcome: "interview", date: "2026-11-02" }), null, "only an ending");
  assert.equal(normalizePendingOutcome({ outcome: "rejected", date: "2026-02-31" }), null, "not a real day");
  assert.equal(normalizePendingOutcome({ outcome: "rejected" }), null);
  assert.equal(normalizePendingOutcome("rejected"), null);
  assert.equal(normalizePendingOutcome(null), null);
  assert.equal(normalizePendingOutcome({ outcome: "rejected", date: "2026-11-02", source: "x".repeat(99) })?.source.length, 40);
});

test("the banner says what, when and where from", () => {
  assert.equal(pendingLine({ outcome: "rejected", date: "2026-11-02", source: "gmail" }), "Rejected on 2 Nov (from Gmail).");
  assert.equal(pendingLine({ outcome: "ghosted", date: "2026-11-04", source: "sweep" }), "Ghosted on 4 Nov (from a sweep).");
  assert.equal(pendingLine({ outcome: "withdrawn", date: "2026-10-21", source: "" }), "Withdrawn on 21 Oct.");
});

test("what the user dismissed stays dismissed when the sweep sees it again", () => {
  const dismissed = { outcome: "rejected", date: "2026-11-02", source: "gmail", dismissed: true };
  assert.equal(activePending(dismissed), null);
  const again = mergePendingOutcome(dismissed, { outcome: "rejected", date: "2026-11-02", source: "sweep" });
  assert.equal(again.ignored, true);
  assert.equal(again.value.dismissed, true);
  const later = mergePendingOutcome(dismissed, { outcome: "rejected", date: "2026-11-09", source: "gmail" });
  assert.equal(later.ignored, false, "a new email is new news");
  assert.equal(activePending(later.value)?.date, "2026-11-09");
});

test("a closing date keeps its day wherever it is read", () => {
  assert.equal(closedAtFromDate("2026-11-02"), "2026-11-02T12:00:00.000Z");
  assert.equal(closedAtFromDate("2026-13-02"), null);
  assert.equal(closedAtFromDate("yesterday"), null);
});

test("the result reads as the brief writes it", () => {
  assert.equal(resultLine({ status: "rejected", close_reason: "rejected", closed_at: "2026-11-02T12:00:00.000Z" }), "Rejected 2 Nov");
  assert.equal(resultLine({ status: "withdrawn", close_reason: "withdrawn", closed_at: "2026-10-21T12:00:00.000Z" }), "Withdrawn 21 Oct");
  assert.equal(resultLine({ status: "withdrawn", close_reason: "role_closed", closed_at: "2026-10-21T12:00:00.000Z" }), "Role closed 21 Oct");
  assert.equal(resultLine({ status: "screening" }), "Live");
  assert.equal(resultLine({ status: "rejected" }), "Rejected");
});

test("the backfill touches only an ended row that got shortlisted", () => {
  const updated_at = "2026-10-01T09:00:00Z";
  assert.deepEqual(backfillPatch({ status: "rejected", stages_reached: ["applied", "screening", "rejected"], updated_at }), { closed_at: updated_at, close_reason: "rejected" });
  assert.deepEqual(backfillPatch({ status: "Withdrawn", stages_reached: ["applied", "interview", "withdrawn"], updated_at }), { closed_at: updated_at, close_reason: "withdrawn" });
  assert.equal(backfillPatch({ status: "screening", stages_reached: ["applied", "screening"], updated_at }), null, "a live row is the user's to move");
  assert.equal(backfillPatch({ status: "rejected", stages_reached: ["applied", "rejected"], updated_at }), null, "never got that far");
  assert.equal(backfillPatch({ status: "rejected", stages_reached: ["screening", "rejected"], closed_at: updated_at, updated_at }), null, "already closed");
});

type TestRow = { status: string; stages_reached: string[]; closed_at?: string; close_reason?: string };
const rows: TestRow[] = [
  ...Array.from({ length: 10 }, () => ({ status: "screening", stages_reached: ["applied", "screening"] })),
  ...Array.from({ length: 8 }, () => ({ status: "interview", stages_reached: ["applied", "interview"] })),
  { status: "rejected", stages_reached: ["applied", "screening", "rejected"], closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" },
  { status: "rejected", stages_reached: ["applied", "interview", "rejected"], closed_at: "2026-11-03T12:00:00.000Z", close_reason: "rejected" },
  ...Array.from({ length: 30 }, () => ({ status: "applied", stages_reached: ["applied"] })),
  { status: "rejected", stages_reached: ["applied", "rejected"] },
  { status: "saved", stages_reached: ["saved"] },
];

test("the summary counts every row that ever got here, from all time and all statuses", () => {
  assert.equal(stageSummary(rows, "screening", 10).text, "Your CV reached screening 20 times · 10 live · 2 closed");
  assert.equal(stageSummary(rows, "interview", 8).text, "Reached interview 9 times · 8 live · 1 closed");
  assert.equal(rows.filter(reachedScreening).length, 20);
  assert.equal(rows.filter(reachedInterview).length, 9);
});

test("closed rows are the closed ones that got this far, latest first", () => {
  assert.deepEqual(closedRows(rows, "screening").map((r) => r.closed_at), ["2026-11-03T12:00:00.000Z", "2026-11-02T12:00:00.000Z"]);
  assert.equal(closedRows(rows, "interview").length, 1);
});

test("live order: next event, then a pending outcome, then the last update", () => {
  const none = () => Infinity;
  const a = { id: "a", updated_at: "2026-11-04" };
  const b = { id: "b", updated_at: "2026-11-01", pending_outcome: { outcome: "rejected", date: "2026-11-02", source: "gmail" } };
  const c = { id: "c", updated_at: "2026-10-01" };
  const dismissed = { id: "d", updated_at: "2026-09-01", pending_outcome: { outcome: "rejected", date: "2026-11-02", source: "gmail", dismissed: true } };
  assert.deepEqual([c, a, dismissed, b].sort((x, y) => liveOrder(x, y, none)).map((r) => r.id), ["b", "a", "c", "d"]);
  const soon = (r: { id: string }) => (r.id === "c" ? 5 : Infinity);
  assert.deepEqual([b, a, c].sort((x, y) => liveOrder(x, y, soon)).map((r) => r.id), ["c", "b", "a"]);
});

test("the funnel counts by stages_reached, all time", () => {
  const funnel = winsFunnel(rows);
  assert.deepEqual(funnel.map((s) => [s.key, s.count]), [["applied", 51], ["screening", 20], ["interview", 9], ["offer", 0]]);
  assert.equal(funnel[1].fromPrevious, 39.2);
  assert.equal(funnel[2].fromPrevious, 45);
  assert.equal(funnel[0].fromPrevious, null);
  assert.equal(winsFunnel([{ status: "saved", stages_reached: ["saved"] }])[0].count, 0, "an unsent row is no application");
  assert.equal(winsFunnel([{ status: "accepted", stages_reached: ["applied", "accepted"] }])[3].count, 1, "won counts as an offer");
});

test("conversion shows a rate only once a group is big enough to mean one", () => {
  const list = [
    ...Array.from({ length: 3 }, () => ({ status: "interview", stages_reached: ["interview"], referral: true })),
    ...Array.from({ length: 7 }, () => ({ status: "applied", stages_reached: ["applied"], referral: true })),
    { status: "screening", stages_reached: ["screening"], source: "tailored" },
    { status: "saved", stages_reached: ["saved"], source: "tailored" },
  ];
  const byGroup = conversionBy(list, sourceOf);
  assert.deepEqual(byGroup[0], { label: "Referral", submitted: 10, reached: 3, rate: 30 });
  assert.deepEqual(byGroup[1], { label: "Tailored here", submitted: 1, reached: 1, rate: null }, "1 of 1 is not 100%");
});

test("a source: a referral first, then how the row was made", () => {
  assert.equal(sourceOf({ referral: true, source: "manual" }), "Referral");
  assert.equal(sourceOf({ company_name: "AECOM (AIApply)", source: "manual" }), "AIApply");
  assert.equal(sourceOf({ role: "Via AIApply (role to confirm)", source: "manual" }), "AIApply");
  assert.equal(sourceOf({ source: "tailored" }), "Tailored here");
  assert.equal(sourceOf({ source: "manual" }), "Added by hand");
});
