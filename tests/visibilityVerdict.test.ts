// Unit tests for the search-visibility verdict. node:test, zero deps.
//
// The regression these guard: in production the model wrote the verdict and
// praised every score (3/15 "strong", 6/15 "highly competitive", 9/15 "strong
// and submittable"). The band is now arithmetic and the label fixed text —
// no model output may put praise beside a weak score.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineWithFit,
  bandFor,
  parseCoverage,
  renderBandBlock,
  reconcileAtsScore,
  BAND_LABELS,
  EDIT_LIMITS,
} from "../src/lib/visibilityVerdict.ts";
import type { AtsMatchResult } from "../src/lib/atsMatch.ts";

const PRAISE = /\b(strong|competitive|submittable)\b/i;

const terms = (n: number) => Array.from({ length: n }, (_, i) => `term${i + 1}`);
const coverageOf = (matched: number, total: number): AtsMatchResult => {
  const all = terms(total);
  return { matched, total, matchedKeywords: all.slice(0, matched), missedKeywords: all.slice(matched) };
};

test("combineWithFit: the research Fit Score is authoritative and can only lower the band", () => {
  // The real contradiction: research "Low match 49/100", tailor panel "strong fit".
  const low = combineWithFit("ready", { total: 49, tier: "low" });
  assert.equal(low.band, "weak");
  assert.match(low.label, /^Weak fit\. Company research scored 49\/100 \(low match\)/);
  assert.match(low.label, /do not send as-is/);
  assert.match(low.fitNote ?? "", /49\/100, low match/);
  assert.equal(combineWithFit("weak", { total: 49, tier: "low" }).band, "weak");
  // Medium fit caps a ready band at borderline and leaves lower bands alone.
  const med = combineWithFit("ready", { total: 62, tier: "medium" });
  assert.equal(med.band, "borderline");
  assert.match(med.label, /62\/100 \(potential match\)/);
  assert.equal(combineWithFit("borderline", { total: 62, tier: "medium" }).band, "borderline");
  assert.equal(combineWithFit("weak", { total: 62, tier: "medium" }).label, BAND_LABELS.weak);
  // High fit never raises the band; it is referenced, not contradicted.
  const high = combineWithFit("weak", { total: 88, tier: "high" });
  assert.equal(high.band, "weak");
  assert.equal(high.label, BAND_LABELS.weak);
  assert.match(high.fitNote ?? "", /88\/100, highly positive fit/);
  // No research for this company: the band stands, nothing referenced.
  assert.deepEqual(combineWithFit("ready", null), { band: "ready", label: BAND_LABELS.ready, fitNote: null });
});

test("bandFor: below 50% weak, 50-74% borderline, 75%+ ready — integer edges included", () => {
  assert.equal(bandFor(3, 15), "weak");
  assert.equal(bandFor(6, 15), "weak"); // 40%
  assert.equal(bandFor(7, 15), "weak"); // 46.7%
  assert.equal(bandFor(8, 15), "borderline"); // 53.3%
  assert.equal(bandFor(9, 15), "borderline");
  assert.equal(bandFor(11, 15), "borderline"); // 73.3%
  assert.equal(bandFor(12, 15), "ready"); // 80%
  assert.equal(bandFor(15, 15), "ready");
  assert.equal(bandFor(5, 10), "borderline"); // exactly 50%
  assert.equal(bandFor(7, 10), "borderline"); // 70%
  assert.equal(bandFor(3, 4), "ready"); // exactly 75%
  assert.equal(bandFor(0, 15), "weak");
  assert.equal(bandFor(0, 0), "weak");
  assert.equal(bandFor(-1, 15), "weak");
});

test("labels are the fixed strings and carry no praise below ready", () => {
  assert.equal(BAND_LABELS.weak, "Weak match. Do not send as-is.");
  assert.equal(BAND_LABELS.borderline, "Borderline. Fix these before sending.");
  assert.equal(BAND_LABELS.ready, "Ready to send.");
  assert.doesNotMatch(BAND_LABELS.weak, PRAISE);
  assert.doesNotMatch(BAND_LABELS.borderline, PRAISE);
});

test("parseCoverage reads the panel's X/N figure and rejects anything else", () => {
  assert.deepEqual(parseCoverage("3/15"), { matched: 3, total: 15 });
  assert.deepEqual(parseCoverage(" 12 / 15 "), { matched: 12, total: 15 });
  assert.equal(parseCoverage("13 of 15"), null);
  assert.equal(parseCoverage(undefined), null);
  assert.equal(parseCoverage(""), null);
});

test("3/15 can never produce a verdict containing strong, competitive or submittable — whatever the model wrote", () => {
  const adversarial = {
    keyword_coverage: "15/15",
    required_skill_coverage: "10/10",
    overall_assessment: "Your CV is strong and submittable. You are highly competitive.",
    verdict: "Ready to send.",
    band: "ready",
    hits: terms(15).map((t) => `${t} — skills`),
    misses: [],
    edits: ["Your CV is strong — send it.", "You are highly competitive for this role.", "This is submittable as-is."],
    recommendations: ["Your CV is strong and submittable."],
  };
  const out = reconcileAtsScore(adversarial, coverageOf(3, 15), null);

  assert.equal(out.band, "weak");
  assert.equal(out.verdict, "Weak match. Do not send as-is.");
  assert.equal(out.keyword_coverage, "3/15");
  assert.doesNotMatch(out.verdict, PRAISE);
  for (const edit of out.recommendations) assert.doesNotMatch(edit, PRAISE);
  // The whole rendered block — verdict plus every edit — is praise-free too.
  assert.doesNotMatch([out.verdict, ...out.recommendations].join("\n"), PRAISE);
  // The model's own verdict fields are not carried through.
  assert.equal((out as Record<string, unknown>).overall_assessment, undefined);
  // Membership is the matcher's: 3 hits, 12 misses, no matter what the model listed.
  assert.equal(out.hits.length, 3);
  assert.equal(out.misses.length, 12);
  assert.equal(out.hits.length + out.misses.length, 15);
});

test("the same holds at every weak score, with model edits that are all praise", () => {
  for (let matched = 0; matched <= 7; matched++) {
    const out = reconcileAtsScore(
      { edits: ["Strong CV.", "Very competitive.", "Submittable now."] },
      coverageOf(matched, 15),
      null
    );
    assert.equal(out.band, "weak", `${matched}/15`);
    assert.doesNotMatch([out.verdict, ...out.recommendations].join(" "), PRAISE, `${matched}/15`);
  }
});

test("weak keeps the two highest-impact edits; borderline the gaps; ready is optional polish", () => {
  const edits = ["Move Kubernetes from the projects into the skills line.", "Lead the Acme bullet with the PostgreSQL migration.", "Name Terraform in the summary.", "Reorder projects.", "Fifth."];
  assert.equal(reconcileAtsScore({ edits }, coverageOf(3, 15), null).recommendations.length, EDIT_LIMITS.weak);
  assert.equal(EDIT_LIMITS.weak, 2);
  assert.equal(reconcileAtsScore({ edits }, coverageOf(9, 15), null).recommendations.length, EDIT_LIMITS.borderline);
  assert.equal(reconcileAtsScore({ edits }, coverageOf(13, 15), null).recommendations.length, EDIT_LIMITS.ready);
  assert.equal(reconcileAtsScore({ edits: [] }, coverageOf(13, 15), null).recommendations.length, 0);
  assert.equal(reconcileAtsScore({ edits }, coverageOf(9, 15), null).band, "borderline");
  assert.equal(reconcileAtsScore({ edits }, coverageOf(13, 15), null).verdict, "Ready to send.");
});

test("annotations attach by term prefix only; counts and figures in edits are synced to the real score", () => {
  const cov = coverageOf(2, 4); // term1, term2 present; term3, term4 absent
  const out = reconcileAtsScore(
    {
      hits: ["term1 — skills line", "term3 — experience (claimed, but absent)"],
      misses: ["term4 — you never mention it", "term2 — wrongly listed as missing"],
      edits: ["You have 4 of 4 covered; surface term3 from the master CV (4/4)."],
    },
    cov,
    null
  );
  assert.deepEqual(out.hits, ["term1 — skills line", "term2"]);
  assert.deepEqual(out.misses, ["term3 — not present in the tailored text", "term4 — you never mention it"]);
  assert.equal(out.keyword_coverage, "2/4");
  assert.deepEqual(out.recommendations, ["You have 2 of 4 covered; surface term3 from the master CV (2/4)."]);
});

test("both figures come from the matcher: the required-skill line carries its own denominator and misses", () => {
  const required: AtsMatchResult = { matched: 4, total: 10, matchedKeywords: terms(4), missedKeywords: ["Go", "gRPC", "Kafka", "Terraform", "Helm", "Argo"] };
  const withRequired = reconcileAtsScore({ required_skill_coverage: "10/10" }, coverageOf(9, 15), required);
  assert.equal(withRequired.keyword_coverage, "9/15");
  assert.equal(withRequired.required_skill_coverage, "4/10");
  assert.deepEqual(withRequired.required_misses, required.missedKeywords);
  assert.equal(withRequired.hits.length + withRequired.misses.length, 15);

  // No required list → no figure, even when the model invented one.
  const without = reconcileAtsScore({ required_skill_coverage: "10/10" }, coverageOf(9, 15), null);
  assert.equal(without.required_skill_coverage, undefined);
  assert.equal(without.required_misses, undefined);
});

test("a failed annotation call still yields the deterministic score", () => {
  const out = reconcileAtsScore(null, coverageOf(12, 15), null);
  assert.equal(out.band, "ready");
  assert.equal(out.verdict, "Ready to send.");
  assert.deepEqual(out.hits, terms(12));
  assert.equal(out.misses.length, 3);
  assert.deepEqual(out.recommendations, []);
});

test("renderBandBlock states the band as settled and asks only for edits inside it", () => {
  const weak = renderBandBlock(coverageOf(3, 15), null);
  assert.match(weak, /Band: WEAK — "Weak match\. Do not send as-is\."/);
  assert.match(weak, /3\/15/);
  assert.match(weak, /EXACTLY the 2 highest-impact edits/);
  assert.match(weak, /cannot change it/);
  assert.doesNotMatch(weak, PRAISE);

  const borderline = renderBandBlock(coverageOf(9, 15), { matched: 4, total: 10, matchedKeywords: [], missedKeywords: ["Go"] });
  assert.match(borderline, /Band: BORDERLINE/);
  assert.match(borderline, /Required skills: 4\/10/);
  assert.match(borderline, /Required skills absent: Go/);
  assert.match(borderline, /specific gaps to fix/);

  assert.match(renderBandBlock(coverageOf(15, 15), null), /Band: READY — "Ready to send\."/);
});
