// JD triage (lib/triage/jdTriage, 1 Nov 2026, Chunk 8): Apply / Review /
// Skip read off a posting's own text. The postings are made up; the first is
// shaped like the real one that was submitted although its Essential list
// asked for 5+ years.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { triageJd, triageText, normalizeTriage, triageProfileOf, eligibilityTriageProfile } from "../src/lib/triage/jdTriage.ts";
import TriageBadge from "../src/app/TriageBadge.tsx";

const FDE_POSTING = `Forward Deployed Engineer
Acme Savings · London Office

About Acme Savings

Acme Savings has helped people save for over 10 years. Our core stack is .NET and we host on Azure.

What You'll Do
- Own engagement delivery end to end, from prototype to production.

Who You Are
- A production engineer with AI at the core.

Skills & Experience
Essential
- 5+ years of software engineering with meaningful production ownership.
- Production-grade Python as your primary language.
Desirable
- Experience with Azure and/or .NET. Existing expertise is a bonus rather than a requirement.
- 3+ years in financial services.`;

test("an Essential list asking for 5+ years is a Skip, and the reason is the phrase: 'Skip: 5+ years'", () => {
  const t = triageJd(FDE_POSTING);
  assert.equal(t.verdict, "skip");
  assert.deepEqual(t.reasons, ["5+ years"]);
  assert.equal(triageText(t), "Skip: 5+ years");
  const hit = t.hits.find((h) => h.rule === "years");
  assert.match(hit?.sentence ?? "", /^5\+ years of software engineering/);
  // The company's "over 10 years" and the Desirable .NET / 3+ years are not Skips.
  assert.ok(!t.hits.some((h) => h.level === "skip" && /10 years/.test(h.phrase)));
  assert.ok(!t.hits.some((h) => h.rule === "languages"), ".NET only under Desirable or in the company blurb");
  assert.ok(t.hits.some((h) => h.rule === "years_review" && h.phrase === "3+ years"), "a Desirable minimum is a Review");
});

test("'5+ years of software engineering' under Essential → skip; with no minimum → apply", () => {
  assert.equal(triageJd("Essential\n- 5+ years of software engineering").verdict, "skip");
  assert.equal(triageJd("Essential: 5+ years of software engineering").verdict, "skip", "an inline label sets its line");
  assert.equal(triageJd("You'll have at least three years of commercial Python.").verdict, "skip", "a requirement cue, number in words");
  assert.equal(triageJd("Requirements\n- 4 years' experience with TypeScript").verdict, "skip");
  assert.equal(triageJd("We don't set a minimum number of years — show us what you've built.").verdict, "apply");
  // A softener in a later clause leaves the minimum standing; in its own clause it softens it.
  assert.equal(triageJd("Experience\n- 3+ years’ experience in Product Management, ideally delivering digital products").verdict, "skip");
  assert.equal(triageJd("Experience\n- Ideally 3+ years in Product Management").verdict, "review");
  assert.equal(triageJd("Experience\n- 3+ years in Product Management preferred").verdict, "review");
});

test("clearance and residence, including the screening-question forms → skip", () => {
  const sc = triageJd("Are you willing to complete UK Security Clearance (SC) checks?");
  assert.equal(sc.verdict, "skip");
  assert.equal(sc.hits[0].rule, "clearance");
  const fuzzy = triageJd("Screening questions\nHave you lived in UK 5+ years?\nAre you willing to do SC?");
  assert.equal(fuzzy.verdict, "skip");
  assert.deepEqual(fuzzy.hits.map((h) => h.rule).sort(), ["clearance", "residence"]);
  assert.equal(triageJd("You must be eligible for SC clearance.").verdict, "skip");
  assert.equal(triageJd("This role requires DV clearance.").verdict, "skip");
  assert.equal(triageJd("Candidates need five years' residence in the UK.").verdict, "skip");
  assert.equal(triageJd("No security clearance is required for this role.").verdict, "apply");
  assert.equal(triageJd("We run campaigns on DV360 and search.").verdict, "apply", "DV inside a product name");
});

test("sponsorship: 'now or in the future' / 'at any time' → skip; 'at this time' → apply", () => {
  assert.equal(triageJd("We are unable to sponsor visas at this time.").verdict, "apply");
  const future = triageJd("Please note we are unable to sponsor visa applications now or in the future.");
  assert.equal(future.verdict, "skip");
  assert.equal(future.reasons[0], "unable to sponsor visa applications now or in the future");
  assert.equal(triageJd("We cannot offer sponsorship at any time.").verdict, "skip");
  assert.equal(triageJd("Will you now or in the future require sponsorship?").verdict, "apply", "a question, not a refusal");
});

test("a time-limited visa (the owner's profile): 'at this time' stays Apply; only 'now or in the future' / 'at any time' is Skip", () => {
  const owner = { rightToWork: "time_limited", yearsExperience: 2 };
  for (const jd of [
    "We are unable to sponsor visas at this time.",
    "Unfortunately we cannot offer visa sponsorship at this time.",
    "At this time we cannot offer visa sponsorship for this role.",
  ]) {
    const t = triageJd(jd, owner);
    assert.equal(t.verdict, "apply", jd);
    assert.deepEqual(t.hits, [], jd);
  }
  for (const [jd, reason] of [
    ["We won't sponsor visas now or in the future.", "won't sponsor visas now or in the future"],
    ["We are unable to sponsor now or in the future.", "unable to sponsor now or in the future"],
    ["We cannot offer sponsorship at any time.", "cannot offer sponsorship at any time"],
  ]) {
    const t = triageJd(jd, owner);
    assert.equal(t.verdict, "skip", jd);
    assert.deepEqual(t.reasons, [reason], jd);
    assert.equal(t.hits[0].rule, "sponsorship");
  }
});

test("contractor roles → skip; a permanent contract or smart contracts → apply", () => {
  assert.equal(triageJd("Initial 6-month contract, outside IR35.").verdict, "skip");
  assert.equal(triageJd("£550 day rate.").verdict, "skip");
  assert.equal(triageJd("Python Developer (Contract)").verdict, "skip");
  assert.equal(triageJd("Rolling 3-month contract.").verdict, "skip");
  assert.equal(triageJd("This is a permanent contract with 25 days' holiday.").verdict, "apply");
  assert.equal(triageJd("You'll write and audit smart contracts in Solidity.").verdict, "apply");
});

test("fixed-term contracts → review, reason 'Fixed-term contract (N months)'", () => {
  const cases: [string, string][] = [
    ["Marketing Insight & Analytics Lead - 9 Month FTC", "Fixed-term contract (9 months)"],
    ["This is a 12-month fixed-term contract.", "Fixed-term contract (12 months)"],
    ["Contract type: Fixed term (6 months)", "Fixed-term contract (6 months)"],
    ["A 12 month contract to cover a team member's maternity leave.", "Fixed-term contract (12 months)"],
    ["Maternity cover for nine months.", "Fixed-term contract (9 months)"],
    ["This role is offered on a fixed term basis.", "Fixed-term contract"],
    ["Data Analyst (Maternity Cover)", "Fixed-term contract"],
    ["Offered as a 1 year FTC.", "Fixed-term contract (12 months)"],
  ];
  for (const [jd, reason] of cases) {
    const t = triageJd(jd);
    assert.equal(t.verdict, "review", jd);
    assert.deepEqual(t.reasons, [reason], jd);
    assert.equal(t.hits[0].rule, "fixed_term", jd);
  }
  // Said twice, once with its length: one reason, the one that says how long.
  const twice = triageJd("Analytics Lead - 9 Month FTC\n\nAbout the role\nYou'll join the team on a fixed-term basis.");
  assert.deepEqual(twice.reasons, ["Fixed-term contract (9 months)"]);
  assert.equal(twice.hits.length, 1);
  // Contractor wording beside the length makes it a contract Skip, never both.
  const contractor = triageJd("6-month contract, outside IR35, £500 day rate.");
  assert.equal(contractor.verdict, "skip");
  assert.ok(!contractor.hits.some((h) => h.rule === "fixed_term"));
  // A savings product is not a contract; a contract's length is not experience.
  assert.equal(triageJd("You'll build the onboarding flow for our Fixed Term ISA.").verdict, "apply");
  assert.ok(!triageJd("A 2 year fixed-term contract.").hits.some((h) => h.rule === "years_review"));
});

test("about two years, a 2–3 year range, and right to work for the duration → review", () => {
  const two = triageJd("Approximately two years");
  assert.equal(two.verdict, "review");
  assert.deepEqual(two.reasons, ["two years"]);
  const range = triageJd("Requirements\n- 2-3 years of backend experience");
  assert.equal(range.verdict, "review", "the range's minimum is 2, so its 3 is not a Skip");
  assert.equal(triageJd("You must have the right to work in the UK for the duration of your employment.").verdict, "review");
  assert.equal(triageJd("Requirements\n- 1-2 years of experience").verdict, "apply");
});

test("C#, .NET, Java, Kotlin or C++ as a core language → review; an option or a Desirable line → apply", () => {
  const java = triageJd("Java Developer\nWe build payments software.");
  assert.equal(java.verdict, "review");
  assert.deepEqual(java.reasons, ["Java"]);
  assert.deepEqual(triageJd("Requirements\n- Strong C# and .NET Core in production").reasons, ["C#", ".NET"]);
  assert.equal(triageJd("Requirements\n- Commercial experience in Python or Java").verdict, "apply");
  assert.equal(triageJd("Requirements\n- Strong JavaScript and TypeScript").verdict, "apply", "JavaScript is not Java");
  assert.equal(triageJd("Nice to have\n- Kotlin").verdict, "apply");
  assert.equal(triageJd("You should apply if\n- You have experience in programming in Kotlin").verdict, "review");
  assert.equal(triageJd("About you\n- Some experience with strongly-typed languages (Go, Java, C, Scala etc.)").verdict, "apply", "one example among several");
});

test("spans of time and ages are not requirements", () => {
  assert.equal(triageJd("Requirements\n- Graduated within the last 2 years").verdict, "apply");
  assert.equal(triageJd("Requirements\n- You must be 18 years old or over").verdict, "apply");
  assert.equal(triageJd("About us\nFounded 12 years ago, we have grown for over 5 years in a row.").verdict, "apply");
});

test("a profile drops what plainly does not apply: full right to work, years that meet the minimum", () => {
  const jd = "Essential\n- 5+ years of software engineering\nWe are unable to sponsor now or in the future.";
  assert.equal(triageJd(jd).hits.length, 2);
  assert.equal(triageJd(jd, { rightToWork: "full", yearsExperience: 6 }).verdict, "apply");
  assert.deepEqual(triageJd(jd, { rightToWork: "time_limited", yearsExperience: 2 }).hits.map((h) => h.rule).sort(), ["sponsorship", "years"]);
  assert.deepEqual(triageProfileOf({ rightToWork: "full", yearsExperience: 6.4 }), { rightToWork: "full", yearsExperience: 6 });
  assert.equal(triageProfileOf("x"), undefined);
  assert.equal(triageProfileOf({}), undefined);
});

test("every phrase is at most 120 characters; a stored triage is re-bounded on read", () => {
  const long = `We are unable to sponsor ${"applicants holding any of the many kinds of visa ".repeat(2)}now or in the future.`;
  const t = triageJd(long);
  assert.equal(t.verdict, "skip");
  assert.ok(t.reasons[0].length <= 120);
  assert.deepEqual(normalizeTriage(JSON.parse(JSON.stringify(t))), t);
  assert.equal(normalizeTriage({ verdict: "maybe", reasons: [] }), null);
  assert.equal(normalizeTriage(null), null);
  const n = normalizeTriage({ verdict: "skip", reasons: ["x".repeat(500), 3], hits: [{ level: "skip", rule: "nope", phrase: "a", sentence: "b" }] });
  assert.equal(n?.reasons.length, 1);
  assert.ok((n?.reasons[0].length ?? 0) <= 120);
  assert.deepEqual(n?.hits, []);
  assert.equal(triageText({ verdict: "apply", reasons: [], hits: [] }), "Apply");
});

test("an Eligibility answer becomes the profile; 'unknown' says nothing", () => {
  assert.deepEqual(eligibilityTriageProfile({ rightToWork: { status: "time_limited", countries: [] }, yearsExperience: 2 }), { rightToWork: "time_limited", yearsExperience: 2 });
  assert.equal(eligibilityTriageProfile({ rightToWork: { status: "unknown" }, yearsExperience: null }), undefined);
  assert.equal(eligibilityTriageProfile(null), undefined);
});

test("the badge reads 'Skip: 5+ years' with the sentence behind a disclosure; Apply says nothing is out of criteria", () => {
  const html = renderToStaticMarkup(createElement(TriageBadge, { triage: triageJd(FDE_POSTING) }));
  assert.match(html, /<div class="triage triage--skip" data-triage="skip">/);
  assert.match(html, /<span class="triage__verdict">Skip:<\/span><span class="triage__reasons" data-triage-reasons="true"> 5\+ years<\/span>/);
  assert.match(html, /data-triage-rule="years" data-triage-level="skip"><strong>Years of experience:<\/strong> “5\+ years of software engineering/);
  const apply = renderToStaticMarkup(createElement(TriageBadge, { triage: triageJd("Graduate Software Engineer\nPython and React.") }));
  assert.match(apply, /data-triage="apply"/);
  assert.match(apply, />Apply<\/span><span class="triage__note"> Nothing in the posting is out of your criteria/);
  assert.doesNotMatch(apply, /<details/);
  assert.equal(renderToStaticMarkup(createElement(TriageBadge, { triage: null })), "");
});
