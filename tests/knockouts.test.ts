// Unit tests for the knockout-gate detector and comparator. node:test, zero
// dependencies: `npm test`. Every JD below is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectGates,
  compareGates,
  mergeModelGates,
  normalizeEligibility,
  isEligibilitySet,
  readVerdict,
  jdQuality,
  summarizeGates,
  EMPTY_ELIGIBILITY,
  MIN_FULL_JD_CHARS,
  type Eligibility,
  type Gate,
} from "../src/lib/knockouts.ts";

const profile = (over: Partial<Eligibility> = {}): Eligibility => ({ ...EMPTY_ELIGIBILITY, ...over });
const one = (jd: string, category: Gate["category"]) => {
  const gates = detectGates(jd).filter((g) => g.category === category);
  assert.equal(gates.length, 1, `expected exactly one ${category} gate, got ${gates.length}: ${JSON.stringify(gates.map((g) => g.requirement))}`);
  return gates[0];
};
const verdictOf = (jd: string, category: Gate["category"], e: Eligibility) =>
  compareGates([one(jd, category)], e)[0];

// ── acceptance cases from the brief ──────────────────────────────────────────

test("acceptance: 'must hold active SC clearance' is a hard fail for a no-clearance profile", () => {
  const jd = "Requirements:\n- Must hold active SC clearance.\n- Python.";
  const r = verdictOf(jd, "clearance", profile({ clearance: { held: "none", eligible: null } }));
  assert.equal(r.verdict, "hard");
  assert.equal(r.gate.value.kind, "clearance");
  assert.ok(/without the CV being read/.test(r.reason));
});

test("acceptance: '3+ years' is a soft fail, not hard, for a candidate with 2", () => {
  const jd = "You will have 3+ years of experience building backend services.";
  const r = verdictOf(jd, "years", profile({ yearsExperience: 2 }));
  assert.equal(r.verdict, "soft");
  assert.ok(r.wording && /don't round up/.test(r.wording));
});

test("acceptance: nothing is ever inferred - an empty profile yields only unknown", () => {
  const jd = "Requirements:\n- Must hold active SC clearance.\n- 5+ years of experience.\n- We cannot offer visa sponsorship.\n- Hybrid, 3 days a week in our Manchester office.\n- A 2:1 degree in Computer Science.\n- Must hold a full UK driving licence.\nThis is a 12-month fixed-term contract.";
  const verdicts = compareGates(detectGates(jd), EMPTY_ELIGIBILITY);
  assert.ok(verdicts.length >= 6, `got ${verdicts.length}`);
  for (const x of verdicts) {
    // the contract-type gate passes when no preference is stated - it's not eligibility
    if (x.gate.category === "employment_type") continue;
    assert.equal(x.verdict, "unknown", `${x.gate.category}: ${x.verdict}`);
  }
  assert.equal(isEligibilitySet(EMPTY_ELIGIBILITY), false);
});

// ── sponsorship ──────────────────────────────────────────────────────────────

test("sponsorship: 'unable to offer sponsorship' is hard for needs_sponsorship, pass for full right to work", () => {
  const jd = "Please note we are unable to offer visa sponsorship for this role.";
  assert.equal(verdictOf(jd, "sponsorship", profile({ rightToWork: { status: "needs_sponsorship", countries: [], permissionEnds: null } })).verdict, "hard");
  assert.equal(verdictOf(jd, "sponsorship", profile({ rightToWork: { status: "full", countries: ["UK"], permissionEnds: null } })).verdict, "pass");
});

test("sponsorship: right-to-work country mismatch is unknown, never a guess", () => {
  const jd = "You must have the right to work in the United States without sponsorship.";
  const g = one(jd, "sponsorship");
  assert.equal(g.value.kind === "sponsorship" && g.value.country, "us");
  const r = verdictOf(jd, "sponsorship", profile({ rightToWork: { status: "full", countries: ["UK"], permissionEnds: null } }));
  assert.equal(r.verdict, "unknown");
});

test("sponsorship: 'sponsorship available' passes even for needs_sponsorship; citizenship is unknown for full", () => {
  assert.equal(verdictOf("Visa sponsorship is available for the right candidate.", "sponsorship", profile({ rightToWork: { status: "needs_sponsorship", countries: [], permissionEnds: null } })).verdict, "pass");
  const r = verdictOf("Requirements:\n- British citizenship required for this post.", "sponsorship", profile({ rightToWork: { status: "full", countries: ["UK"], permissionEnds: null } }));
  assert.equal(r.verdict, "unknown");
});

test("sponsorship: a time-limited visa passes 'no sponsorship' softly and fails 'permanent right to work' hard", () => {
  const tl = profile({ rightToWork: { status: "time_limited", countries: ["UK"], permissionEnds: "2027-01" } });
  // Can start without sponsorship: not a knockout, but the employer won't sponsor later.
  const soft = verdictOf("Please note we are unable to offer visa sponsorship for this role.", "sponsorship", tl);
  assert.equal(soft.verdict, "soft");
  assert.match(soft.reason, /until Jan 2027/);
  assert.equal(verdictOf("You must have the right to work in the UK without sponsorship.", "sponsorship", tl).verdict, "soft");
  // Permanent status is asked for: a visa never satisfies it.
  for (const jd of [
    "Requirements:\n- Permanent right to work in the UK is required.",
    "Requirements:\n- Indefinite leave to remain or British citizenship required.",
    "Requirements:\n- Applicants must have settled status.",
  ]) {
    const r = verdictOf(jd, "sponsorship", tl);
    assert.equal(r.verdict, "hard", jd);
    assert.match(r.reason, /permanent right to work, settled status or citizenship/);
  }
  // A preferred phrasing still never fails hard.
  assert.equal(verdictOf("Ideally you hold permanent right to work in the UK.", "sponsorship", tl).verdict, "soft");
  // Sponsorship offered, or nothing said beyond "right to work in the UK": pass.
  assert.equal(verdictOf("Visa sponsorship is available for the right candidate.", "sponsorship", tl).verdict, "pass");
  assert.equal(verdictOf("You must be eligible to work in the UK.", "sponsorship", tl).verdict, "pass", "eligible now, nothing said about sponsorship");
  // Without the end month the wording has no date in it.
  const noDate = verdictOf("We cannot sponsor visas.", "sponsorship", profile({ rightToWork: { status: "time_limited", countries: [], permissionEnds: null } }));
  assert.equal(noDate.verdict, "soft");
  assert.doesNotMatch(noDate.reason, /until/);
  // "full" is unchanged: permanent status asked for → unknown (confirm yours qualifies).
  assert.equal(verdictOf("Permanent right to work in the UK is required.", "sponsorship", profile({ rightToWork: { status: "full", countries: ["UK"], permissionEnds: null } })).verdict, "unknown");
});

test("sponsorship: 'cannot sponsor clearance' is about vetting, not visas", () => {
  const jd = "Requirements:\n- Must hold active SC clearance (we cannot sponsor clearance for this role).";
  const gates = detectGates(jd);
  assert.equal(gates.filter((g) => g.category === "sponsorship").length, 0, JSON.stringify(gates));
  assert.equal(gates.filter((g) => g.category === "clearance").length, 1);
  // ...but a visa line in the same posting still counts
  assert.equal(detectGates(jd + "\n- We cannot offer visa sponsorship.").filter((g) => g.category === "sponsorship").length, 1);
});

test("sponsorship: a nice-to-have phrasing never yields hard", () => {
  const jd = "Ideally you would already have the right to work in the UK without sponsorship.";
  const r = verdictOf(jd, "sponsorship", profile({ rightToWork: { status: "needs_sponsorship", countries: [], permissionEnds: null } }));
  assert.equal(r.gate.strictness, "preferred");
  assert.notEqual(r.verdict, "hard");
});

// ── clearance ────────────────────────────────────────────────────────────────

test("clearance: 'eligible for SC' passes when the profile says eligible, hard when not, unknown when unanswered", () => {
  const jd = "Requirements:\n- You must be eligible for SC clearance (5 years UK residency).";
  const g = one(jd, "clearance");
  assert.equal(g.value.kind === "clearance" && g.value.mustHold, false);
  assert.equal(verdictOf(jd, "clearance", profile({ clearance: { held: "none", eligible: true } })).verdict, "pass");
  assert.equal(verdictOf(jd, "clearance", profile({ clearance: { held: "none", eligible: false } })).verdict, "hard");
  assert.equal(verdictOf(jd, "clearance", profile({ clearance: { held: "none", eligible: null } })).verdict, "unknown");
});

test("clearance: holding DV satisfies an SC requirement; 'sc' inside a word is not a clearance", () => {
  assert.equal(verdictOf("Requirements:\n- Active SC clearance essential.", "clearance", profile({ clearance: { held: "dv", eligible: null } })).verdict, "pass");
  assert.equal(detectGates("Requirements:\n- Clear communication skills and a scientific mindset.").filter((g) => g.category === "clearance").length, 0);
});

// ── years ────────────────────────────────────────────────────────────────────

test("years: shortfall over 2 is hard, a preferred phrasing stays soft, prose about the company is ignored", () => {
  assert.equal(verdictOf("Requirements:\n- Minimum 8 years' experience in Java.", "years", profile({ yearsExperience: 3 })).verdict, "hard");
  assert.equal(verdictOf("Ideally 8+ years of experience with Java.", "years", profile({ yearsExperience: 3 })).verdict, "soft");
  assert.equal(detectGates("We have been building payments software for 12 years and love it.").filter((g) => g.category === "years").length, 0);
  const g = one("Requirements:\n- At least 4 years of experience with Kubernetes.", "years");
  assert.deepEqual(g.value, { kind: "years", years: 4, subject: "Kubernetes" });
});

// ── location ─────────────────────────────────────────────────────────────────

test("location: on-site in a city you're not in and won't relocate to is hard; hybrid is soft", () => {
  const onsite = "This role is fully on-site at our Manchester office.";
  assert.equal(verdictOf(onsite, "location", profile({ location: { base: ["London"], onsiteOk: true, hybridOk: true, relocateOk: false } })).verdict, "hard");
  assert.equal(verdictOf(onsite, "location", profile({ location: { base: ["Manchester"], onsiteOk: true, hybridOk: true, relocateOk: false } })).verdict, "pass");
  const hybrid = "Hybrid working: 3 days a week in our Manchester office.";
  const g = one(hybrid, "location");
  assert.equal(g.value.kind === "location" && g.value.daysInOffice, 3);
  assert.equal(verdictOf(hybrid, "location", profile({ location: { base: ["London"], onsiteOk: true, hybridOk: true, relocateOk: false } })).verdict, "soft");
  assert.equal(verdictOf(hybrid, "location", profile({ location: { base: ["London"], onsiteOk: true, hybridOk: true, relocateOk: true } })).verdict, "soft");
  assert.equal(verdictOf(hybrid, "location", profile({ location: { base: [], onsiteOk: null, hybridOk: null, relocateOk: null } })).verdict, "unknown");
});

test("location: a street inside your base city passes; 'Hub, City' with no mode word is a located gate that never fails hard", () => {
  const tcr = "Office-based role, central London near Tottenham Court Road.";
  const london = profile({ location: { base: ["London"], onsiteOk: true, hybridOk: true, relocateOk: true } });
  const r = verdictOf(tcr, "location", london);
  assert.equal(r.verdict, "pass");
  assert.ok(/London/.test(r.reason));
  assert.equal(verdictOf(tcr, "location", profile({ location: { base: ["Leeds, UK"], onsiteOk: true, hybridOk: true, relocateOk: true } })).verdict, "soft");
  const hub = "Full Stack Developer - Matalan - Support Hub, Liverpool - Permanent, Full Time, 38.75 hours";
  const g = one(hub, "location");
  assert.deepEqual(g.value, { kind: "location", mode: "unstated", daysInOffice: null, place: "Liverpool", relocation: "none" });
  assert.equal(verdictOf(hub, "location", london).verdict, "soft");
  assert.equal(verdictOf(hub, "location", profile({ location: { base: ["London"], onsiteOk: true, hybridOk: true, relocateOk: false } })).verdict, "soft");
  assert.equal(verdictOf(hub, "location", profile({ location: { base: ["Liverpool"], onsiteOk: true, hybridOk: true, relocateOk: false } })).verdict, "pass");
  // A hub line with a hybrid word elsewhere in the same sentence is still hybrid.
  const hybridHub = "Based at our Hub, Manchester, hybrid with 2 days a week in the office.";
  const hv = one(hybridHub, "location").value;
  assert.equal(hv.kind === "location" ? hv.mode : null, "hybrid");
});

test("location: remote roles are not a gate unless restricted to a country", () => {
  assert.equal(detectGates("This is a fully remote role with quarterly meetups.").filter((g) => g.category === "location").length, 0);
  const jd = "Remote (UK only) - you must be based in the UK.";
  const r = verdictOf(jd, "location", profile({ location: { base: ["Leeds, UK"], onsiteOk: null, hybridOk: null, relocateOk: null } }));
  assert.equal(r.verdict, "pass");
});

// ── degree ───────────────────────────────────────────────────────────────────

test("degree: a required 2:1 is hard for a 2:2, soft when 'or equivalent experience' is allowed, unknown without a profile answer", () => {
  const jd = "Requirements:\n- A 2:1 degree in Computer Science or a related field.";
  assert.equal(verdictOf(jd, "degree", profile({ degree: { level: "bachelors", classification: "2:2" } })).verdict, "hard");
  assert.equal(verdictOf(jd, "degree", profile({ degree: { level: "masters", classification: "first" } })).verdict, "pass");
  assert.equal(verdictOf(jd, "degree", profile({ degree: { level: "bachelors", classification: "unknown" } })).verdict, "unknown");
  const equiv = "Requirements:\n- Bachelor's degree in a STEM subject or equivalent experience.";
  assert.equal(verdictOf(equiv, "degree", profile({ degree: { level: "none", classification: "unknown" } })).verdict, "soft");
  assert.equal(verdictOf("Requirements:\n- PhD in machine learning required.", "degree", profile({ degree: { level: "masters", classification: "first" } })).verdict, "hard");
});

// ── licence ──────────────────────────────────────────────────────────────────

test("licence: missing from the list is soft (never hard); present passes; only in requirement context", () => {
  const jd = "Requirements:\n- Must hold a full UK driving licence.";
  assert.equal(verdictOf(jd, "licence", profile({ licences: ["AWS Solutions Architect"] })).verdict, "soft");
  assert.equal(verdictOf(jd, "licence", profile({ licences: ["Full UK driving licence"] })).verdict, "pass");
  assert.equal(verdictOf(jd, "licence", profile({ licences: [] })).verdict, "unknown");
  assert.equal(detectGates("Benefits:\n- Company car for those who hold a driving licence.").filter((g) => g.category === "licence").length, 0);
});

// ── employment type ──────────────────────────────────────────────────────────

test("employment type: a 12-month FTC is soft for a permanent-only profile and passes with no preference", () => {
  const jd = "This is a 12-month fixed-term contract, inside IR35.";
  const g = one(jd, "employment_type");
  assert.equal(g.value.kind === "employment_type" && g.value.type, "fixed_term");
  assert.equal(g.value.kind === "employment_type" && g.value.months, 12);
  assert.equal(verdictOf(jd, "employment_type", profile({ employmentTypes: ["permanent"] })).verdict, "soft");
  assert.equal(verdictOf(jd, "employment_type", EMPTY_ELIGIBILITY).verdict, "pass");
  assert.equal(detectGates("Available on a permanent or contract basis.").filter((g) => g.category === "employment_type").length, 0);
});

// ── detector hygiene ─────────────────────────────────────────────────────────

test("a plain JD with no gates yields no gates (no false positives)", () => {
  const jd = `Backend Engineer
About us:
We build tooling for warehouses across Europe. Founded in 2019, we now serve 400 customers.
The role:
You'll own our order-ingestion services, working with Python, PostgreSQL and Kafka, and ship to production weekly.
Requirements:
- Strong Python and SQL.
- Experience with event-driven systems.
- Clear communication with product managers.
Benefits:
- 27 days holiday, pension, budget for conferences.`;
  assert.deepEqual(detectGates(jd), []);
});

test("preferred-section gates are preferred and never hard", () => {
  const jd = "Nice to have:\n- SC clearance.\n- 10+ years of experience.";
  const verdicts = compareGates(detectGates(jd), profile({ clearance: { held: "none", eligible: null }, yearsExperience: 1 }));
  assert.ok(verdicts.length === 2);
  for (const x of verdicts) {
    assert.equal(x.gate.strictness, "preferred");
    assert.notEqual(x.verdict, "hard");
  }
});

test("model gates are kept only when quoted verbatim from the JD, re-parsed, and deduped against detector gates", () => {
  const jd = "Requirements:\n- Must hold active SC clearance.\n- Applicants must be able to commute to our Bristol office three days per week.\n- Candidates need to be able to travel to client sites across the South West regularly.";
  const detected = detectGates(jd);
  // The commute sentence is a detector gate in its own right (hybrid, Bristol, 3 days).
  const commute = detected.find((g) => g.category === "location");
  assert.ok(commute && commute.source === "detector");
  assert.deepEqual(commute.value, { kind: "location", mode: "hybrid", daysInOffice: 3, place: "Bristol", relocation: "none" });
  const merged = mergeModelGates(
    detected,
    [
      { category: "clearance", requirement: "Must hold active SC clearance.", strictness: "must" }, // duplicate of a detector gate
      { category: "location", requirement: "Applicants must be able to commute to our Bristol office three days per week.", strictness: "must" }, // duplicate too
      { category: "location", requirement: "Candidates need to be able to travel to client sites across the South West regularly.", strictness: "must" }, // genuine addition the detector can't parse
      { category: "sponsorship", requirement: "We cannot offer sponsorship.", strictness: "must" }, // NOT in the JD - dropped
      { category: "bogus", requirement: "Must hold active SC clearance." },
    ],
    jd
  );
  assert.equal(merged.filter((g) => g.category === "sponsorship").length, 0);
  assert.equal(merged.filter((g) => g.category === "clearance").length, 1);
  const locs = merged.filter((g) => g.category === "location");
  assert.equal(locs.length, 2);
  const travel = locs.find((g) => g.source === "model");
  assert.ok(travel);
  assert.deepEqual(travel.value, { kind: "unparsed" });
  assert.equal(compareGates([travel], EMPTY_ELIGIBILITY)[0].verdict, "unknown");
  assert.equal(mergeModelGates(detected, "not an array", jd).length, detected.length);
});

test("normalizeEligibility clamps, defaults and drops junk", () => {
  const e = normalizeEligibility({
    rightToWork: { status: "full", countries: ["UK", "UK", 42, " Ireland "], permissionEnds: "2027-13" },
    clearance: { held: "wizard", eligible: "yes" },
    yearsExperience: 99.6,
    location: { base: ["London"], onsiteOk: "true", relocateOk: false },
    degree: { level: "masters", classification: "2:1" },
    licences: ["x".repeat(200)],
    employmentTypes: ["permanent", "gig", "contract"],
    updatedAt: 5,
  });
  assert.deepEqual(e.rightToWork, { status: "full", countries: ["UK", "Ireland"], permissionEnds: null }, "a malformed month is dropped");
  assert.equal(normalizeEligibility({ rightToWork: { status: "time_limited", permissionEnds: "2027-01" } }).rightToWork.permissionEnds, "2027-01");
  assert.deepEqual(e.clearance, { held: "unknown", eligible: null });
  assert.equal(e.yearsExperience, 60);
  assert.deepEqual(e.location, { base: ["London"], onsiteOk: null, hybridOk: null, relocateOk: false });
  assert.equal(e.licences[0].length, 80);
  assert.deepEqual(e.employmentTypes, ["permanent", "contract"]);
  assert.equal(e.updatedAt, null);
  assert.equal(isEligibilitySet(e), true);
  assert.deepEqual(normalizeEligibility(null), EMPTY_ELIGIBILITY);
});

// ── the read ─────────────────────────────────────────────────────────────────

test("readVerdict: hard -> skip; soft or weak required coverage -> long shot; otherwise apply; unknowns don't move it", () => {
  const jd = "Requirements:\n- Must hold active SC clearance.\n- 3+ years of experience.\n- Must hold a full UK driving licence.";
  const gates = detectGates(jd);
  const skip = readVerdict(compareGates(gates, profile({ clearance: { held: "none", eligible: null }, yearsExperience: 10 })), { matched: 9, total: 10 }, { matched: 14, total: 15 });
  assert.equal(skip.read, "skip");
  const soft = readVerdict(compareGates(gates, profile({ clearance: { held: "sc", eligible: null }, yearsExperience: 2 })), { matched: 9, total: 10 }, { matched: 14, total: 15 });
  assert.equal(soft.read, "long_shot");
  const weak = readVerdict([], { matched: 2, total: 10 }, { matched: 14, total: 15 });
  assert.equal(weak.read, "long_shot");
  const apply = readVerdict(compareGates(gates, profile({ clearance: { held: "sc", eligible: null }, yearsExperience: 5 })), { matched: 8, total: 10 }, { matched: 12, total: 15 });
  assert.equal(apply.read, "apply");
  assert.ok(/1 to check yourself/.test(apply.reason)); // the licence is unknown (no licences listed)
  const summary = summarizeGates(compareGates(gates, profile({ clearance: { held: "sc", eligible: null }, yearsExperience: 5 })), apply.read);
  assert.deepEqual([summary.read, summary.hard, summary.soft, summary.unknown, summary.items.length], ["apply", 0, 0, 1, 3]);
});

test("jdQuality: partial below the threshold, never for an empty box", () => {
  assert.deepEqual(jdQuality("x".repeat(MIN_FULL_JD_CHARS - 1)), { chars: MIN_FULL_JD_CHARS - 1, partial: true });
  assert.deepEqual(jdQuality("x".repeat(MIN_FULL_JD_CHARS)), { chars: MIN_FULL_JD_CHARS, partial: false });
  assert.deepEqual(jdQuality("   "), { chars: 0, partial: false });
});
