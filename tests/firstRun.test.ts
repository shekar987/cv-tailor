import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstRunStep,
  firstRunMode,
  planRailIsEmpty,
  showsStagesCaveat,
  withRightToWork,
  rtwChoiceLabel,
  RTW_CHOICES,
  STAGES_RECORDED_FROM,
  type FirstRunFacts,
} from "../src/lib/firstRun.ts";
import { EMPTY_ELIGIBILITY, normalizeEligibility, isEligibilitySet } from "../src/lib/knockouts.ts";
import { buildAnswerBank } from "../src/lib/answerBank.ts";
import { rightToWorkStatement } from "../src/lib/rightToWorkText.ts";

const facts = (f: Partial<FirstRunFacts>): FirstRunFacts => ({ hasCv: false, rtwStatus: "unknown", applicationCount: 0, ...f });

test("the steps come in order: CV, right to work, first job, then none", () => {
  assert.equal(firstRunStep(facts({})), "cv");
  // A right-to-work answer given before the CV still leaves the CV first.
  assert.equal(firstRunStep(facts({ rtwStatus: "full" })), "cv");
  assert.equal(firstRunStep(facts({ hasCv: true })), "rtw");
  assert.equal(firstRunStep(facts({ hasCv: true, rtwStatus: "time_limited" })), "job");
  assert.equal(firstRunStep(facts({ hasCv: true, rtwStatus: "needs_sponsorship", applicationCount: 1 })), null);
});

test("the whole guide only for an account with no application; a banner only for a missing CV", () => {
  assert.equal(firstRunMode(null), null);
  assert.equal(firstRunMode(facts({})), "guide");
  assert.equal(firstRunMode(facts({ hasCv: true })), "guide");
  assert.equal(firstRunMode(facts({ hasCv: true, rtwStatus: "full" })), "guide");
  // Rows kept by hand or by an automation, no CV: the one step that unblocks tailoring.
  assert.equal(firstRunMode(facts({ applicationCount: 40 })), "banner");
  // An established account that never answered right to work is not nagged.
  assert.equal(firstRunMode(facts({ hasCv: true, applicationCount: 40 })), null);
  assert.equal(firstRunMode(facts({ hasCv: true, rtwStatus: "full", applicationCount: 1 })), null);
});

test("the plan's rail hides only when there is no application and no event", () => {
  assert.equal(planRailIsEmpty(0, 0), true);
  assert.equal(planRailIsEmpty(0, 1), false);
  assert.equal(planRailIsEmpty(3, 0), false);
});

test("the 3 Nov stages caveat is for accounts made before that day", () => {
  assert.equal(STAGES_RECORDED_FROM, "2026-11-03");
  assert.equal(showsStagesCaveat("2026-09-01T10:00:00Z"), true);
  assert.equal(showsStagesCaveat("2026-11-02T23:59:59.999Z"), true);
  assert.equal(showsStagesCaveat("2026-11-03T00:00:00Z"), false);
  assert.equal(showsStagesCaveat("2026-11-12T14:00:00+00:00"), false);
  // Unknown keeps it: the caveat only ever understates.
  assert.equal(showsStagesCaveat(null), true);
  assert.equal(showsStagesCaveat(undefined), true);
  assert.equal(showsStagesCaveat("not a date"), true);
});

test("choosing right to work changes that answer alone", () => {
  const saved = normalizeEligibility({
    rightToWork: { status: "unknown", countries: ["UK"], permissionEnds: "2027-01" },
    yearsExperience: 2,
    licences: ["Full UK driving licence"],
    availability: { status: "now", from: null },
  });
  const next = withRightToWork(saved, "time_limited");
  assert.equal(next.rightToWork.status, "time_limited");
  assert.deepEqual(next.rightToWork.countries, ["UK"]);
  assert.equal(next.rightToWork.permissionEnds, "2027-01");
  assert.deepEqual({ ...next, rightToWork: saved.rightToWork }, saved);
  // The saved value is not touched.
  assert.equal(saved.rightToWork.status, "unknown");
  // From nothing saved, nothing else is filled in: one answer, the user's.
  const fromEmpty = withRightToWork(EMPTY_ELIGIBILITY, "full");
  assert.deepEqual({ ...fromEmpty, rightToWork: EMPTY_ELIGIBILITY.rightToWork }, EMPTY_ELIGIBILITY);
});

test("three explicit answers, none of them 'not set', none pre-chosen", () => {
  assert.deepEqual(RTW_CHOICES.map((c) => c.status), ["full", "time_limited", "needs_sponsorship"]);
  assert.equal(rtwChoiceLabel("unknown"), "Not set");
  assert.equal(rtwChoiceLabel("time_limited"), "Time-limited visa");
});

// Step 0.1 of the 12 Nov walkthrough: a brand-new account's form answers. The screenshots
// showed "No" to sponsorship and a permanent right to work; those came from the capture
// harness seeding Eligibility, not from the app. Pinned so it can never become a default.
test("a new account's form answers and right-to-work statement are all 'not set'", () => {
  for (const e of [EMPTY_ELIGIBILITY, normalizeEligibility({}), normalizeEligibility(null), normalizeEligibility({ rightToWork: { status: "permanent" } })]) {
    assert.equal(e.rightToWork.status, "unknown");
    assert.equal(e.availability.status, "unknown");
    assert.equal(e.canWorkFullTime, "unknown");
    assert.equal(isEligibilitySet(e), false);
    for (const entry of buildAnswerBank(e)) assert.equal(entry.answer, null, entry.key);
    assert.equal(rightToWorkStatement(e).formBlock, "");
  }
  assert.ok(buildAnswerBank(null).every((entry) => entry.answer === null));
});
