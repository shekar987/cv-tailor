// lib/agent: ATS detection from a URL, the duplicate-key normalisation, and the
// guardrail lists. Pure functions — nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAts, normaliseJobUrl, isLinkedIn, ATS_LABELS } from "../src/lib/agent/ats.ts";
import {
  LINKEDIN_BLOCKED,
  SENSITIVE_QUESTIONS,
  matchSensitiveQuestion,
  isSensitiveQuestion,
} from "../src/lib/agent/guardrails.ts";

// ── 15 real URL shapes ────────────────────────────────────────────────────────

test("detectAts covers the six systems across 15 real URL shapes", () => {
  const cases: Array<[string, string]> = [
    // Greenhouse: boards, job-boards, embed, EU, and the grnh.se short link.
    ["https://boards.greenhouse.io/acme/jobs/1234567", "greenhouse"],
    ["https://job-boards.greenhouse.io/acme/jobs/7654321", "greenhouse"],
    ["https://boards.greenhouse.io/embed/job_app?token=1234567", "greenhouse"],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/9999", "greenhouse"],
    ["https://grnh.se/abcd1234ef", "greenhouse"],
    // Lever, home and EU board.
    ["https://jobs.lever.co/acme/3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c", "lever"],
    ["https://jobs.eu.lever.co/acme-labs/3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c/apply", "lever"],
    // Ashby.
    ["https://jobs.ashbyhq.com/synthflow/a1b2c3d4-e5f6-4789-abcd-ef0123456789", "ashby"],
    // Workday across two data-centre subdomains.
    ["https://acme.wd1.myworkdayjobs.com/en-US/careers/job/London/Software-Engineer_R-123", "workday"],
    ["https://acme.wd5.myworkdayjobs.com/External/job/Remote/Data-Scientist_JR-42", "workday"],
    // Pinpoint.
    ["https://acme.pinpointhq.com/en/postings/5d8f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b", "pinpoint"],
    // Workable apply link and a company subdomain.
    ["https://apply.workable.com/acme/j/ABCDEF1234/", "workable"],
    ["https://acme.workable.com/jobs/1234567", "workable"],
    // A company careers page on no known ATS.
    ["https://careers.monzo.com/jobs/1234", "other"],
    // Bare host, no scheme.
    ["jobs.lever.co/acme/3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c", "lever"],
  ];
  assert.equal(cases.length, 15);
  for (const [url, expected] of cases) {
    assert.equal(detectAts(url), expected, url);
  }
});

test("detectAts returns unknown for junk, other for an unrecognised valid URL", () => {
  assert.equal(detectAts("not a url"), "unknown");
  assert.equal(detectAts(""), "unknown");
  assert.equal(detectAts("ftp://example.com/x"), "unknown");
  assert.equal(detectAts("javascript:alert(1)"), "unknown");
  assert.equal(detectAts("https://example.com/careers/42"), "other");
});

test("every Ats value has a label", () => {
  for (const key of ["greenhouse", "lever", "ashby", "workday", "pinpoint", "workable", "other", "unknown"] as const) {
    assert.equal(typeof ATS_LABELS[key], "string");
  }
});

// ── LinkedIn ──────────────────────────────────────────────────────────────────

test("LinkedIn is recognised (and blocked) but is not an ATS value", () => {
  assert.equal(isLinkedIn("https://www.linkedin.com/jobs/view/1234567890"), true);
  assert.equal(isLinkedIn("https://uk.linkedin.com/jobs/view/999"), true);
  assert.equal(isLinkedIn("https://lnkd.in/abcdef"), true);
  assert.equal(isLinkedIn("https://jobs.lever.co/acme/x"), false);
  // Its ATS still classifies as "other", so a non-linkedin check never mislabels it.
  assert.equal(detectAts("https://www.linkedin.com/jobs/view/1234567890"), "other");
  assert.equal(LINKEDIN_BLOCKED, true);
});

// ── Normalisation (the duplicate key) ───────────────────────────────────────────

test("normaliseJobUrl folds scheme, www, trailing slash and tracking params", () => {
  const a = normaliseJobUrl("https://boards.greenhouse.io/acme/jobs/123?utm_source=x&gh_src=y");
  const b = normaliseJobUrl("http://boards.greenhouse.io/acme/jobs/123/");
  assert.equal(a, "https://boards.greenhouse.io/acme/jobs/123");
  assert.equal(a, b);
});

test("normaliseJobUrl strips www and keeps meaningful params, sorted", () => {
  assert.equal(
    normaliseJobUrl("https://www.jobs.ashbyhq.com/acme/uuid/"),
    "https://jobs.ashbyhq.com/acme/uuid"
  );
  assert.equal(
    normaliseJobUrl("https://x.wd1.myworkdayjobs.com/careers/job?b=1&a=2"),
    "https://x.wd1.myworkdayjobs.com/careers/job?a=2&b=1"
  );
});

test("two links that differ only by a utm tag dedupe to one", () => {
  const one = normaliseJobUrl("https://jobs.lever.co/acme/abc?lever-source=LinkedIn");
  const two = normaliseJobUrl("https://jobs.lever.co/acme/abc");
  assert.equal(one, two);
});

test("an unparseable string normalises to itself (lowercased), so junk dedupes too", () => {
  assert.equal(normaliseJobUrl("  Not A URL  "), "not a url");
});

// ── Guardrails ──────────────────────────────────────────────────────────────────

test("sensitive questions are caught across every category", () => {
  const byKey = (text: string) => matchSensitiveQuestion(text)?.key ?? null;
  assert.equal(byKey("Do you have the right to work in the UK?"), "right_to_work");
  assert.equal(byKey("Will you now or in the future require visa sponsorship?"), "sponsorship");
  assert.equal(byKey("What is your current immigration status?"), "visa");
  assert.equal(byKey("What are your salary expectations?"), "salary");
  assert.equal(byKey("This form includes equal opportunities monitoring."), "diversity");
  assert.equal(byKey("Do you have any unspent criminal convictions?"), "criminal_record");
  assert.equal(byKey("Please enter your date of birth."), "date_of_birth");
  assert.equal(byKey("What is your home address?"), "home_address");
  assert.equal(byKey("In your own words, why do you want this role?"), "own_words");
});

test("ordinary questions are not flagged", () => {
  assert.equal(isSensitiveQuestion("What is your favourite programming language?"), false);
  assert.equal(isSensitiveQuestion("How many years have you used React?"), false);
  assert.equal(isSensitiveQuestion("When can you start?"), false);
});

test("every sensitive question carries a key, label and pattern", () => {
  assert.ok(SENSITIVE_QUESTIONS.length >= 9);
  for (const q of SENSITIVE_QUESTIONS) {
    assert.equal(typeof q.key, "string");
    assert.equal(typeof q.label, "string");
    assert.ok(q.pattern instanceof RegExp);
  }
});
