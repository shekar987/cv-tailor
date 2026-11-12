import { test } from "node:test";
import { cameFromPage } from "../src/lib/pageOnly.ts";
import { MAX_NOTES_CHARS } from "../src/lib/limits.ts";
import assert from "node:assert/strict";
import {
  CONFIRMATION_MESSAGE,
  MOVE_BACK_MESSAGE,
  PENDING_VIA_PATCH,
  REOPEN_QUIET_DAYS,
  REOPEN_RECORDED,
  UNDO_WINDOW_MS,
  activePending,
  backfillPatch,
  closedAtFromDate,
  closedRows,
  conversionBy,
  decideClosingWrite,
  dismissPending,
  dismissalMatches,
  highestStage,
  isClosed,
  isMoveBack,
  isStepBack,
  liveOrder,
  mergePendingOutcome,
  needsConfirmation,
  normalizePendingOutcome,
  normalizeUndoSnapshot,
  pendingBanner,
  pendingLine,
  progressChip,
  reachedInterview,
  reachedScreening,
  reasonForStatus,
  removableStages,
  removedStageNote,
  reopenTarget,
  reportedNote,
  resultLine,
  sourceOf,
  stageSummary,
  statusForReason,
  undoIsLive,
  undoWrite,
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

const NOW = "2026-11-04T20:00:00.000Z";
const noFlags = { confirmed: false, confirmedMoveBack: false, confirmedReopen: false };
const word = { ...noFlags, confirmed: true };
const backWord = { ...noFlags, confirmedMoveBack: true };
const reopenWord = { ...noFlags, confirmedReopen: true };
const refused = (d: ReturnType<typeof decideClosingWrite>) => ("refuse" in d ? d.refuse : null);
const fieldsOf = (d: ReturnType<typeof decideClosingWrite>) => ("fields" in d ? d.fields : null);
const askOf = (d: ReturnType<typeof decideClosingWrite>) => ("ask" in d ? d.ask : null);

test("a 409 without confirmation, and success with it", () => {
  const no = refused(decideClosingWrite(screened, { status: "rejected" }, noFlags, NOW));
  assert.equal(no?.status, 409);
  assert.equal(no?.error, CONFIRMATION_MESSAGE);
  const yes = fieldsOf(decideClosingWrite(screened, { status: "rejected" }, word, NOW));
  assert.equal(yes?.status, "rejected");
  assert.equal(yes?.closed_at, NOW, "a confirmation alone still dates it");
  assert.equal(yes?.close_reason, "rejected");
  const chosen = fieldsOf(decideClosingWrite(screened, { status: "withdrawn", closed_at: "2026-11-02T12:00:00.000Z", close_reason: "role_closed", lesson: "frozen" }, word, NOW));
  assert.equal(chosen?.closed_at, "2026-11-02T12:00:00.000Z");
  assert.equal(chosen?.close_reason, "role_closed");
  assert.equal(chosen?.lesson, "frozen");
});

test("no two writes around the rule: moving a screened row back needs the user too", () => {
  for (const status of ["applied", "saved"] as const) {
    assert.equal(isMoveBack(screened, status), true);
    const no = refused(decideClosingWrite(screened, { status }, noFlags, NOW));
    assert.equal(no?.status, 409, status);
    assert.equal(no?.error, MOVE_BACK_MESSAGE);
    assert.ok(fieldsOf(decideClosingWrite(screened, { status }, backWord, NOW)), "the user can still say where it stands");
    assert.ok(refused(decideClosingWrite(screened, { status }, word, NOW)), "the closing word is not the same word");
  }
  const closedRow = { status: "rejected", stages_reached: ["applied", "screening", "rejected"] };
  assert.equal(refused(decideClosingWrite(closedRow, { status: "applied" }, reopenWord, NOW))?.status, 409, "reopening below screening needs both words");
  assert.ok(fieldsOf(decideClosingWrite(closedRow, { status: "applied" }, { ...reopenWord, confirmedMoveBack: true }, NOW)));
  // The history is append-only, so a row moved back is still a row that reached screening.
  const movedBack = { status: "applied", stages_reached: ["applied", "screening"] };
  assert.equal(refused(decideClosingWrite(movedBack, { status: "rejected" }, noFlags, NOW))?.error, CONFIRMATION_MESSAGE, "no two writes around the rule");
  assert.ok(fieldsOf(decideClosingWrite({ status: "applied", stages_reached: ["applied"] }, { status: "saved" }, noFlags, NOW)), "below screening moves as ever");
  assert.ok(fieldsOf(decideClosingWrite(screened, { status: "interview" }, noFlags, NOW)), "forward moves as ever");
  assert.ok(fieldsOf(decideClosingWrite({ status: "interview", stages_reached: ["applied", "interview"] }, { status: "screening" }, backWord, NOW)), "above screening, on the user's word");
  assert.equal(isMoveBack({ status: "applied", stages_reached: ["applied"] }, "applied"), false, "the status it already has");
});

test("closed_at can't be written around the rule", () => {
  assert.equal(refused(decideClosingWrite(null, { closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" }, noFlags, NOW))?.status, 400, "no status");
  assert.equal(refused(decideClosingWrite(null, { closed_at: null }, noFlags, NOW))?.status, 400, "nor clearing it with none");
  assert.equal(refused(decideClosingWrite(screened, { status: "screening", closed_at: "2026-11-02T12:00:00.000Z" }, noFlags, NOW))?.status, 409, "an open status");
  assert.equal(refused(decideClosingWrite(screened, { status: "screening", closed_at: "2026-11-02T12:00:00.000Z" }, word, NOW))?.status, 409, "even confirmed, an open status never closes");
  assert.equal(refused(decideClosingWrite(screened, { status: "screening", close_reason: "rejected" }, noFlags, NOW))?.status, 409);
  const plain = { status: "applied", stages_reached: ["applied"] };
  assert.equal(refused(decideClosingWrite(plain, { status: "rejected", closed_at: "2026-11-02T12:00:00.000Z" }, noFlags, NOW))?.status, 409, "a date needs the word on any row");
  assert.ok(fieldsOf(decideClosingWrite(null, { lesson: "wanted 3+ yrs" }, noFlags, NOW)), "a lesson edits alone");
  const ended = { status: "rejected", stages_reached: ["applied", "screening", "rejected"] };
  assert.equal(refused(decideClosingWrite(ended, { status: "rejected", closed_at: null, close_reason: null }, noFlags, NOW))?.status, 409, "nor wiping a close by writing the same status");
});

test("a detected outcome goes through its own route, so the merge rule holds", () => {
  const pending = { outcome: "rejected" as const, date: "2026-11-02", source: "gmail" };
  assert.equal(refused(decideClosingWrite(screened, { pending_outcome: pending }, noFlags, NOW))?.error, PENDING_VIA_PATCH);
  assert.equal(refused(decideClosingWrite(screened, { status: "screening", pending_outcome: pending }, noFlags, NOW))?.error, PENDING_VIA_PATCH);
  assert.equal(refused(decideClosingWrite({ status: "rejected", stages_reached: ["applied", "screening", "rejected"] }, { status: "screening", closed_at: null, close_reason: null, pending_outcome: pending }, reopenWord, NOW))?.error, PENDING_VIA_PATCH, "Undo has its own path now");
  assert.ok(fieldsOf(decideClosingWrite(screened, { pending_outcome: null }, noFlags, NOW)), "clearing is allowed");
});

test("a close keeps what it took as dismissed, so a reopened row isn't re-flagged by the same email", () => {
  const stored = { status: "screening", stages_reached: ["applied", "screening"], pending_outcome: { outcome: "rejected", date: "2026-11-02", source: "gmail" } };
  const closed = fieldsOf(decideClosingWrite(stored, { status: "rejected", pending_outcome: null }, word, NOW));
  assert.deepEqual(closed?.pending_outcome, { outcome: "rejected", date: "2026-11-02", source: "gmail", dismissed: true });
  assert.equal(mergePendingOutcome(closed?.pending_outcome, { outcome: "rejected", date: "2026-11-02", source: "sweep" }).ignored, true);
  assert.equal(fieldsOf(decideClosingWrite(screened, { status: "rejected" }, word, NOW))?.pending_outcome, null, "nothing stored, nothing kept");
});

test("an open status on a closed row asks, and only the user's word reopens it", () => {
  const closedRow = { status: "rejected", stages_reached: ["applied", "screening", "rejected"], closed_at: "2026-11-02T12:00:00.000Z" };
  const ask = askOf(decideClosingWrite(closedRow, { status: "interview" }, noFlags, NOW));
  assert.deepEqual(ask, { outcome: "reopen", date: "2026-11-04", source: "sweep", status: "interview" });
  assert.ok(askOf(decideClosingWrite({ status: "rejected", stages_reached: ["applied", "rejected"] }, { status: "screening" }, noFlags, NOW)), "any ended row: the match may be wrong");
  assert.ok(askOf(decideClosingWrite(closedRow, { status: "interview" }, word, NOW)), "the closing word is not this word");
  const open = fieldsOf(decideClosingWrite(closedRow, { status: "interview" }, reopenWord, NOW));
  assert.equal(open?.closed_at, null);
  assert.equal(open?.close_reason, null);
  assert.equal(fieldsOf(decideClosingWrite(closedRow, { status: "rejected" }, noFlags, NOW))?.closed_at, undefined, "a sweep rewriting the same status leaves the close alone");
  assert.equal(fieldsOf(decideClosingWrite(screened, { status: "interview" }, noFlags, NOW))?.closed_at, null, "a live row is not asked about");
  assert.match(REOPEN_RECORDED, /nothing was written/);
});

test("the reopen question: its answer clears it, and a dismissal holds until the stage changes", () => {
  const asked = { outcome: "reopen", date: "2026-11-05", source: "sweep", status: "interview" };
  const closedRow = { status: "rejected", stages_reached: ["applied", "screening", "rejected"], pending_outcome: asked };
  assert.deepEqual(normalizePendingOutcome(asked), asked);
  assert.equal(fieldsOf(decideClosingWrite(closedRow, { status: "interview" }, reopenWord, NOW))?.pending_outcome, null, "answered");
  const memory = { ...closedRow, pending_outcome: { outcome: "rejected", date: "2026-11-02", source: "gmail", dismissed: true } };
  assert.equal(fieldsOf(decideClosingWrite(memory, { status: "screening" }, reopenWord, NOW))?.pending_outcome, undefined, "a dismissal kept from a close stays as memory");
  const dismissed = { ...asked, dismissed: true };
  assert.equal(mergePendingOutcome(dismissed, { ...asked, date: "2026-11-09" } as never).ignored, true, "a wrong-row match stays quiet on the next run");
  assert.equal(mergePendingOutcome(dismissed, { ...asked, status: "offer" } as never).ignored, false, "further than the one dismissed is new news");
  assert.equal(mergePendingOutcome(dismissed, { ...asked, status: "applied" } as never).ignored, true, "lower than the one dismissed is not");
  const noStage = { outcome: "reopen", date: "2026-11-05", source: "sweep" };
  assert.equal(mergePendingOutcome(dismissed, noStage as never).ignored, true, "a report naming no stage matches");
  assert.equal(mergePendingOutcome({ ...noStage, dismissed: true }, asked as never).ignored, true, "in either direction");
  assert.equal(REOPEN_QUIET_DAYS, 14);
  const late = dismissPending({ outcome: "reopen", date: "2026-11-01", source: "sweep", status: "interview" }, "2026-11-20");
  assert.equal(late.date, "2026-11-20", "the window starts at the dismissal, not at whenever the sweep ran");
  assert.equal(mergePendingOutcome(late, { outcome: "reopen", date: "2026-11-21", source: "sweep", status: "interview" }).ignored, true);
  assert.equal(dismissPending({ outcome: "rejected", date: "2026-11-02", source: "gmail" }, "2026-11-20").date, "2026-11-02", "an ending keeps the date it is known by");
  assert.equal(mergePendingOutcome(dismissed, { ...asked, date: "2026-11-18" } as never).ignored, true, "thirteen days on");
  assert.equal(mergePendingOutcome(dismissed, { ...asked, date: "2026-11-19" } as never).ignored, false, "a real invite weeks later still reaches the user");
  assert.equal(normalizePendingOutcome({ outcome: "reopen", date: "2026-11-05", status: "rejected" })?.status, undefined, "it can't ask for an ending");
});

test("the report's words reach the banner, and the row only if the user reopens it", () => {
  assert.equal(reportedNote("Mine\nOlder line", "Mine\nOlder line\nInvite for 12 Nov 14:00"), "Invite for 12 Nov 14:00", "only what the report adds");
  assert.equal(reportedNote("Mine", "Mine"), undefined);
  assert.equal(reportedNote(null, "One\nTwo"), "One · Two");
  assert.equal(reportedNote("Mine", undefined), undefined);
  assert.equal(reportedNote(null, null), undefined);
  assert.equal(reportedNote(null, "x".repeat(900))?.length, 240);
  const closedRow = { status: "rejected", stages_reached: ["applied", "screening", "rejected"], notes: "Mine" };
  const ask = askOf(decideClosingWrite(closedRow, { status: "interview", notes: "Mine\nInvite for 12 Nov" }, noFlags, NOW));
  assert.equal(ask?.note, "Invite for 12 Nov");
  const stored = { ...closedRow, pending_outcome: ask };
  assert.equal(normalizePendingOutcome(ask)?.note, "Invite for 12 Nov", "it survives being stored");
  assert.equal(fieldsOf(decideClosingWrite(stored, { status: "interview" }, reopenWord, NOW))?.notes, "Mine\nInvite for 12 Nov", "the row takes it on the user's word");
  assert.equal(fieldsOf(decideClosingWrite({ ...closedRow, pending_outcome: { ...ask, dismissed: true } }, { status: "interview" }, reopenWord, NOW))?.notes, undefined, "not after they said it isn't about this row");
  assert.equal(fieldsOf(decideClosingWrite(stored, { status: "interview", notes: "Theirs" }, reopenWord, NOW))?.notes, "Theirs", "what the user writes wins");
  assert.equal(fieldsOf(decideClosingWrite({ ...stored, notes: "x".repeat(MAX_NOTES_CHARS - 10) }, { status: "interview" }, reopenWord, NOW))?.notes, undefined, "past the cap it never truncates their notes");
  assert.equal(mergePendingOutcome(ask, { outcome: "reopen", date: "2026-11-06", source: "sweep", status: "interview" }).value.note, "Invite for 12 Nov", "a repeat keeps the words");
  const lower = mergePendingOutcome(ask, { outcome: "reopen", date: "2026-11-06", source: "sweep", status: "applied" }).value;
  assert.equal(lower.status, "interview", "and a later, lower report doesn't overwrite a higher question");
  assert.equal(lower.date, "2026-11-06");
  assert.equal(mergePendingOutcome(ask, { outcome: "reopen", date: "2026-11-06", source: "sweep" }).value.status, "interview");
  assert.equal(mergePendingOutcome(ask, { outcome: "reopen", date: "2026-11-06", source: "sweep", status: "offer" }).value.status, "offer");
});

test("a question on a closed row keeps what the close remembered, so answering it brings nothing back", () => {
  const ending = { outcome: "rejected", date: "2026-11-02", source: "gmail" };
  const live = { status: "screening", stages_reached: ["applied", "screening"], pending_outcome: ending };
  const close = fieldsOf(decideClosingWrite(live, { status: "rejected" }, word, NOW))!;
  const closedRow = { status: "rejected", stages_reached: ["applied", "screening", "rejected"], pending_outcome: close.pending_outcome };
  const ask = mergePendingOutcome(closedRow.pending_outcome, { outcome: "reopen", date: "2026-11-05", source: "sweep", status: "interview" }).value;
  assert.equal(ask.outcome, "reopen");
  assert.deepEqual(ask.earlier, { ...ending, dismissed: true });
  assert.equal(pendingBanner({ ...closedRow, pending_outcome: ask })?.kind, "reopen");
  const again = mergePendingOutcome(ask, { outcome: "reopen", date: "2026-11-06", source: "sweep", status: "interview" }).value;
  assert.deepEqual(again.earlier, { ...ending, dismissed: true }, "through a repeat too");
  const reopened = fieldsOf(decideClosingWrite({ ...closedRow, pending_outcome: again }, { status: "interview" }, reopenWord, NOW))!;
  assert.deepEqual(reopened.pending_outcome, { ...ending, dismissed: true }, "the answer restores it");
  const report = mergePendingOutcome(reopened.pending_outcome, ending as never);
  assert.equal(report.ignored, true, "the same email after the Reopen stays quiet");
  assert.equal(pendingBanner({ status: "interview", pending_outcome: report.value }), null);
  assert.equal(normalizePendingOutcome({ ...ending, earlier: ending })?.earlier, undefined, "only a question carries one");
  assert.equal(normalizePendingOutcome({ outcome: "reopen", date: "2026-11-05", earlier: { outcome: "reopen", date: "2026-11-01" } })?.earlier, undefined, "and it is an ending, one level deep");
  let deep: Record<string, unknown> = { outcome: "reopen", date: "2026-11-05" };
  for (let i = 0; i < 20000; i++) deep = { outcome: "reopen", date: "2026-11-05", earlier: deep };
  assert.equal(normalizePendingOutcome(deep)?.earlier, undefined, "a value written by hand can't recurse");
});

test("the banner: an ending asks a live row, a reopen asks a closed one", () => {
  const ending = { outcome: "rejected", date: "2026-11-02", source: "gmail" };
  const asked = { outcome: "reopen", date: "2026-11-05", source: "sweep", status: "interview" };
  assert.equal(pendingBanner({ status: "screening", pending_outcome: ending })?.kind, "close");
  assert.equal(pendingBanner({ status: "rejected", pending_outcome: ending }), null);
  assert.equal(pendingBanner({ status: "rejected", pending_outcome: asked })?.kind, "reopen");
  assert.equal(pendingBanner({ status: "screening", pending_outcome: asked }), null);
  assert.equal(pendingBanner({ status: "rejected", pending_outcome: { ...asked, dismissed: true } }), null);
  assert.equal(pendingLine(normalizePendingOutcome(asked)!, "Shell"), "New activity from Shell — Reopen?");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "screening", "rejected"], pending_outcome: asked }), "interview", "where the report asked");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "interview", "rejected"] }), "interview", "else the furthest it reached");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "rejected"] }), "applied");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "interview", "rejected"], pending_outcome: { ...asked, status: "applied" } }), "interview", "a lower report never sets a row back");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "interview", "rejected"], pending_outcome: { ...asked, status: "screening" } }), "interview");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "rejected"], pending_outcome: { ...asked, status: "screening" } }), "screening", "a higher one moves it on");
  assert.equal(reopenTarget({ status: "rejected", stages_reached: ["applied", "offer", "rejected"], pending_outcome: { ...asked, status: "accepted" } }), "accepted");
  for (const row of [{ status: "rejected", stages_reached: ["applied", "interview", "rejected"], pending_outcome: { ...asked, status: "applied" } }, { status: "ghosted", stages_reached: ["applied", "screening", "ghosted"] }]) {
    assert.equal(isMoveBack(row, reopenTarget(row)), false, "so a Reopen never needs the move-back word");
  }
});

test("a close stores what it replaced, and Undo restores from that without touching the history", () => {
  const pending = { outcome: "rejected", date: "2026-11-02", source: "gmail" };
  const current = { status: "Screening", stages_reached: ["applied", "screening"], pending_outcome: pending, lesson: "old", followup_date: "2026-11-20" };
  const close = fieldsOf(decideClosingWrite(current, { status: "rejected", lesson: "new" }, word, NOW));
  assert.deepEqual(close?.undo_snapshot, { status: "screening", closed_at: null, close_reason: null, lesson: "old", pending_outcome: pending, followup_date: "2026-11-20", at: NOW });
  const snapshot = normalizeUndoSnapshot(close?.undo_snapshot)!;
  const back = undoWrite(snapshot, { followup_date: null, notes: "Mine\nFollow-up 2026-11-20 cleared when marked rejected on 2026-11-04." });
  assert.equal(back.status, "screening");
  assert.equal(back.closed_at, null);
  assert.equal(back.close_reason, null);
  assert.equal(back.lesson, "old");
  assert.deepEqual(back.pending_outcome, pending);
  assert.equal(back.followup_date, "2026-11-20");
  assert.equal(back.notes, "Mine");
  assert.equal(back.undo_snapshot, null);
  assert.equal("stages_reached" in back, false, "the history is not edited");
  assert.equal("followup_date" in undoWrite({ ...snapshot, followup_date: null }, { notes: "Mine" }), false, "no follow-up to restore, and the notes are left alone");
  assert.equal(normalizeUndoSnapshot({ status: "nonsense", at: NOW }), null);
  assert.equal(normalizeUndoSnapshot(null), null);
});

test("a sweep stepping a live row back asks, and only the user's word moves it", () => {
  const interview = { status: "interview", stages_reached: ["applied", "screening", "interview"], notes: "Mine" };
  assert.equal(isStepBack(interview, "screening"), true);
  assert.equal(isStepBack({ status: "Interview" }, "Screening"), true, "old labels read the same");
  assert.equal(isStepBack(interview, "assessment"), false, "they come in either order");
  assert.equal(isStepBack({ status: "assessment" }, "interview"), false);
  assert.equal(isStepBack({ status: "offer" }, "interview"), true);
  assert.equal(isStepBack({ status: "accepted" }, "offer"), true);
  assert.equal(isStepBack({ status: "screening" }, "interview"), false);
  assert.equal(isStepBack(interview, "rejected"), false, "an ending has its own rule");
  const ask = askOf(decideClosingWrite(interview, { status: "screening", notes: "Mine\nRecruiter call" }, noFlags, NOW));
  assert.deepEqual(ask, { outcome: "move_back", date: "2026-11-04", source: "sweep", status: "screening", note: "Recruiter call" });
  assert.ok(askOf(decideClosingWrite(interview, { status: "screening" }, word, NOW)), "the closing word is not this word");
  assert.ok(askOf(decideClosingWrite(interview, { status: "screening" }, reopenWord, NOW)), "nor is the reopen word");
  assert.equal(fieldsOf(decideClosingWrite(interview, { status: "screening" }, backWord, NOW))?.status, "screening");
  assert.ok(fieldsOf(decideClosingWrite(interview, { status: "assessment" }, noFlags, NOW)), "a move across needs nothing");
  assert.ok(fieldsOf(decideClosingWrite(interview, { status: "offer" }, noFlags, NOW)), "nor a move forward");
  assert.ok(fieldsOf(decideClosingWrite(interview, { status: "interview", notes: "Sweep" }, noFlags, NOW)), "nor a rewrite of the same status");
  assert.equal(refused(decideClosingWrite(interview, { status: "applied" }, noFlags, NOW))?.errorType, "needs_move_back_confirmation", "below screening stays a 409, as the owner chose");
  assert.equal(normalizePendingOutcome({ outcome: "move_back", date: "2026-11-05" }), null, "it asks for somewhere to go");
  assert.equal(normalizePendingOutcome({ outcome: "move_back", date: "2026-11-05", status: "rejected" }), null);
});

test("the move-back banner: a live row that would really step back, until it is answered", () => {
  const asked = { outcome: "move_back", date: "2026-11-05", source: "sweep", status: "screening", note: "Recruiter call" };
  const row = { status: "interview", stages_reached: ["applied", "screening", "interview"], pending_outcome: asked, notes: "Mine" };
  assert.equal(pendingBanner(row)?.kind, "move_back");
  assert.equal(pendingLine(normalizePendingOutcome(asked)!, "Shell"), "New activity from Shell — Move back to Screening?");
  assert.equal(pendingBanner({ ...row, status: "screening" }), null, "already there");
  assert.equal(pendingBanner({ ...row, status: "rejected" }), null, "closed");
  assert.equal(pendingBanner({ ...row, pending_outcome: { ...asked, dismissed: true } }), null);
  const yes = fieldsOf(decideClosingWrite(row, { status: "screening" }, backWord, NOW));
  assert.equal(yes?.pending_outcome, null, "answered");
  assert.equal(yes?.notes, "Mine\nRecruiter call", "and the row takes the report's words");
  const forward = fieldsOf(decideClosingWrite(row, { status: "offer" }, noFlags, NOW));
  assert.equal(forward?.pending_outcome, null, "moving on answers it too");
  assert.equal(forward?.notes, undefined, "without taking words it didn't act on");
  const rewrite = fieldsOf(decideClosingWrite(row, { status: "interview", notes: "Sweep" }, noFlags, NOW));
  assert.equal(rewrite?.pending_outcome, undefined, "a sweep rewriting the same status answers nothing");
  const dismissed = dismissPending(normalizePendingOutcome(asked)!, "2026-11-06");
  assert.equal(dismissed.date, "2026-11-06");
  assert.equal(mergePendingOutcome(dismissed, { ...asked, date: "2026-11-07" } as never).ignored, true, "Not true holds");
  assert.equal(mergePendingOutcome(dismissed, { ...asked, date: "2026-11-20" } as never).ignored, false, "for fourteen days");
});

test("a stale banner can't bury what replaced its question", () => {
  const ending = { outcome: "rejected", date: "2026-11-02", source: "gmail" };
  const row = { status: "interview", stages_reached: ["applied", "interview"], pending_outcome: ending };
  assert.equal(dismissalMatches(normalizePendingOutcome(ending)!, { outcome: "move_back", date: "2026-11-05" }), false, "Not true answered something else");
  assert.equal(dismissalMatches(normalizePendingOutcome(ending)!, { outcome: "rejected", date: "2026-11-09" }), false, "a different email");
  assert.equal(dismissalMatches(normalizePendingOutcome(ending)!, { outcome: "rejected", date: "2026-11-02" }), true);
  assert.equal(dismissalMatches(normalizePendingOutcome({ outcome: "move_back", date: "2026-11-06", source: "", status: "screening" })!, { outcome: "move_back", date: "2026-11-05" }), true, "a question's date is only when the sweep ran");
  assert.equal(dismissalMatches(normalizePendingOutcome(ending)!, {}), true, "a request naming nothing");
  const moved = fieldsOf(decideClosingWrite(row, { status: "screening", pending_outcome: null }, backWord, NOW));
  assert.equal(moved?.status, "screening", "Move back still moves it");
  assert.equal("pending_outcome" in (moved ?? {}), false, "and the rejection it never saw stays");
  assert.equal("pending_outcome" in (fieldsOf(decideClosingWrite(row, { pending_outcome: null }, noFlags, NOW)) ?? {}), false, "nor can a null clear it on its own");
});

test("a dismissed move back stays remembered when the row moves on, and further back is news", () => {
  const dismissed = { outcome: "move_back", date: "2026-11-05", source: "sweep", status: "interview", dismissed: true };
  const row = { status: "offer", stages_reached: ["applied", "interview", "offer"], pending_outcome: dismissed };
  assert.equal("pending_outcome" in (fieldsOf(decideClosingWrite(row, { status: "accepted" }, noFlags, NOW)) ?? {}), false, "the memory survives the move");
  assert.equal(mergePendingOutcome(dismissed, { ...dismissed, dismissed: undefined, date: "2026-11-06", status: "screening" } as never).ignored, false, "further back is new news");
  assert.equal(mergePendingOutcome({ ...dismissed, status: "screening" }, { ...dismissed, dismissed: undefined, date: "2026-11-06", status: "interview" } as never).ignored, true, "milder is not");
  const open = { outcome: "move_back", date: "2026-11-05", source: "sweep", status: "interview" };
  assert.equal(mergePendingOutcome(open, { ...open, date: "2026-11-06", status: "screening" } as never).value.status, "screening", "the latest report says where");
});

test("a move-back question never takes a rejection's place, and keeps its memory", () => {
  const ending = { outcome: "rejected", date: "2026-11-02", source: "gmail" };
  const question = { outcome: "move_back", date: "2026-11-05", source: "sweep", status: "screening" } as const;
  const held = mergePendingOutcome(ending, question);
  assert.equal(held.ignored, true);
  assert.equal(held.value.outcome, "rejected", "the rejection still waiting stays on the row");
  const kept = mergePendingOutcome({ ...ending, dismissed: true }, question);
  assert.equal(kept.ignored, false);
  assert.deepEqual(kept.value.earlier, { ...ending, dismissed: true });
  assert.equal(mergePendingOutcome(kept.value, ending as never).ignored, true, "the same email stays quiet behind the question");
  assert.equal(mergePendingOutcome(kept.value, { ...ending, date: "2026-11-09" } as never).value.outcome, "rejected", "a new one takes over");
  assert.equal(normalizePendingOutcome({ ...question, earlier: question })?.earlier, undefined, "a question can't hide behind a question");
});

test("removing a stage: what the menu offers, and the line the row keeps", () => {
  assert.deepEqual(removableStages({ status: "screening", stages_reached: ["applied", "screening", "interview", "rejected"] }), ["interview"], "not where it stands, and only what counts");
  assert.deepEqual(removableStages({ status: "rejected", stages_reached: ["applied", "Screening", "Offer", "rejected"] }), ["screening", "offer"], "old labels too");
  assert.deepEqual(removableStages({ status: "interview", stages_reached: ["applied", "interview"] }), []);
  assert.deepEqual(removableStages({ status: "applied", stages_reached: null }), []);
  assert.equal(removedStageNote("interview", new Date("2026-11-05T10:00:00Z")), "Removed 'interview' on 5 Nov — picked by mistake");
  assert.equal(removedStageNote("interview", new Date("2026-07-01T23:30:00Z")), "Removed 'interview' on 2 Jul — picked by mistake", "the UK's day, not the server's");
});

test("only the page can ask to remove a stage", () => {
  const from = (headers: Record<string, string>) => cameFromPage({ get: (name: string) => headers[name] ?? null });
  assert.equal(from({ "sec-fetch-site": "same-origin" }), true);
  assert.equal(from({ "sec-fetch-site": "cross-site" }), false);
  assert.equal(from({ "sec-fetch-site": "none", origin: "https://www.jobhuntz.app", host: "www.jobhuntz.app" }), false, "the browser's word wins");
  assert.equal(from({}), false, "a script sends neither");
  assert.equal(from({ "sec-fetch-mode": "cors" }), false, "as Node's fetch does");
  assert.equal(from({ origin: "https://www.jobhuntz.app", host: "www.jobhuntz.app" }), true, "an older browser");
  assert.equal(from({ origin: "https://evil.example", host: "www.jobhuntz.app" }), false);
  assert.equal(from({ origin: "not a url", host: "www.jobhuntz.app" }), false);
});

test("Ready to submit to Applied is the one step forward below screening", () => {
  const movedBack = { status: "saved", stages_reached: ["applied", "screening", "saved"] };
  assert.equal(isMoveBack(movedBack, "applied"), false, "Submit is a step forward");
  assert.ok(fieldsOf(decideClosingWrite(movedBack, { status: "applied" }, noFlags, NOW)));
  const applied = { status: "applied", stages_reached: ["applied", "interview"] };
  assert.equal(isMoveBack(applied, "saved"), true, "Applied to Ready to submit is the owner's call");
  assert.equal(refused(decideClosingWrite(applied, { status: "saved" }, noFlags, NOW))?.errorType, "needs_move_back_confirmation");
  assert.ok(fieldsOf(decideClosingWrite(applied, { status: "saved" }, backWord, NOW)));
  assert.equal(isMoveBack({ status: "screening", stages_reached: ["applied", "screening"] }, "applied"), true);
  assert.equal(isMoveBack({ status: "rejected", stages_reached: ["applied", "screening", "rejected"] }, "applied"), true, "an ended row still stands above it");
});

test("a replaced close comes back as it was", () => {
  const earlier = { status: "rejected", stages_reached: ["applied", "screening", "rejected"], closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", lesson: "first" };
  const snapshot = normalizeUndoSnapshot(fieldsOf(decideClosingWrite(earlier, { status: "withdrawn", close_reason: "role_closed" }, word, NOW))?.undo_snapshot)!;
  const back = undoWrite(snapshot, {});
  assert.equal(back.status, "rejected");
  assert.equal(back.closed_at, "2026-11-02T12:00:00.000Z");
  assert.equal(back.close_reason, "rejected");
  assert.equal(back.lesson, "first");
});

test("Undo lasts the toast's ten seconds, and a little for the click to arrive", () => {
  const at = Date.parse(NOW);
  const snapshot = normalizeUndoSnapshot({ status: "screening", at: NOW })!;
  assert.equal(UNDO_WINDOW_MS, 10000);
  assert.equal(undoIsLive(snapshot, at + UNDO_WINDOW_MS), true);
  assert.equal(undoIsLive(snapshot, at + UNDO_WINDOW_MS + 4000), true, "the click was on its way");
  assert.equal(undoIsLive(snapshot, at + 60000), false);
  assert.equal(undoIsLive({ ...snapshot, at: "nonsense" }, at), false);
});

test("an ended row that reached screening is never lost from the page", () => {
  const ended = { status: "rejected", stages_reached: ["applied", "screening", "rejected"] };
  assert.equal(isClosed(ended), true, "no closed_at, still closed");
  assert.equal(closedRows([ended], "screening").length, 1);
  assert.equal(stageSummary([ended], "screening", 0).text, "Your CV reached screening 1 time · 0 live · 1 closed");
  assert.equal(isClosed({ status: "screening" }), false);
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
  assert.equal(progressChip(screened, [{ kind: "video", status: "cancelled" }]), "Screening call", "a cancelled video never happened");
  assert.equal(progressChip(screened, [{ kind: "screening_questions" }]), "Screening call", "answers to questions are not a test");
  assert.equal(progressChip({ stages_reached: ["interview"] }, [{ kind: "interview", title: "Final panel" }]), "Final", "the title can say so too");
  assert.equal(progressChip({ stages_reached: ["interview"] }, [{ kind: "interview", title: "Final Year Placement interview" }]), "Interview", "a final-year placement is not a final round");
  assert.equal(progressChip(screened, [{ kind: "video", status: "to_book" }]), "Screening call", "never booked");
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
  assert.equal(winsFunnel([{ status: "saved", stages_reached: ["saved", "applied"] }])[0].count, 0, "nor is one with an undone Submit in its history");
  assert.deepEqual(winsFunnel([{ status: "screening", stages_reached: ["applied", "screening", "interview"] }]).map((s) => s.count), [1, 1, 1, 0], "moved back, it still counts as reaching interview");
  assert.deepEqual(winsFunnel([{ status: "saved", stages_reached: ["applied", "screening", "saved"] }]).map((s) => s.count), [1, 1, 0, 0], "moved back to unsent, too");
  const [group] = conversionBy([{ status: "saved", stages_reached: ["applied", "screening", "saved"] }], () => "Added by hand");
  assert.equal(group?.reached, 1, "and the by-source table agrees with the funnel above it");
  assert.equal(conversionBy([{ status: "saved", stages_reached: ["saved", "applied"] }], () => "Added by hand").length, 0);
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
