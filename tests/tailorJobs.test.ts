// The Local Tailor contract (Chunk TL-1): the summary prompt, cleaning, the
// honesty number check (rule 4), the cost counter, and a logic-level queue
// round trip. node:test, no dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSummaryPrompt,
  cleanSummary,
  summaryFromRaw,
  summaryNumbersSupported,
  readSummaryResult,
  normalizeNumber,
  totalSavedGbp,
  formatGbp,
  engineLabel,
  PREMIUM_SUMMARY_GBP,
  SUMMARY_SCHEMA,
  MAX_SUMMARY_LINES,
  type TailorJobInput,
} from "../src/lib/tailorJobs.ts";

const MASTER_CV = [
  "Alex Tester — Full Stack Engineer",
  "2 years' production experience with TypeScript, React, Node.js and PostgreSQL.",
  "Rebuilt a logistics dashboard used by 40 depots and cut page load time by 35%.",
  "Shipped to three environments on AWS.",
].join("\n");

test("summaryNumbersSupported: every number in the summary must be in the master CV", () => {
  const good = "Full Stack Engineer with 2 years' experience; cut load time by 35% for 40 depots.";
  assert.deepEqual(summaryNumbersSupported(good, MASTER_CV), { ok: true, unsupported: [] });

  // An invented metric the CV never states.
  const bad = "Full Stack Engineer who improved performance by 80% across 12 teams.";
  const res = summaryNumbersSupported(bad, MASTER_CV);
  assert.equal(res.ok, false);
  assert.ok(res.unsupported.some((u) => /80%/.test(u)));
  assert.ok(res.unsupported.some((u) => /12/.test(u)));
});

test("summaryNumbersSupported: spelled-out numbers in the CV support digit forms", () => {
  // "three environments" in the CV supports a summary that writes "3 environments".
  assert.equal(summaryNumbersSupported("Deployed to 3 environments.", MASTER_CV).ok, true);
});

test("summaryNumbersSupported: a currency/£ figure matches regardless of commas", () => {
  const cv = "Managed a budget of £45,000 across the team.";
  assert.equal(summaryNumbersSupported("Owned a £45,000 budget.", cv).ok, true);
  assert.equal(summaryNumbersSupported("Owned a £60,000 budget.", cv).ok, false);
});

test("normalizeNumber folds currency, commas and spaces", () => {
  assert.equal(normalizeNumber("£45,000"), "45000");
  assert.equal(normalizeNumber("40 %"), "40%");
  assert.equal(normalizeNumber("150k"), "150k");
});

test("cleanSummary caps at three lines and strips bullets/markdown", () => {
  const raw = "- **Line one**\n- Line two\n- Line three\n- Line four";
  const out = cleanSummary(raw);
  const lines = out.split("\n");
  assert.equal(lines.length, MAX_SUMMARY_LINES);
  assert.ok(!out.includes("**"));
  assert.ok(!out.includes("- "));
  assert.equal(lines[0], "Line one");
});

test("summaryFromRaw reads {summary}, {lines} and plain text", () => {
  assert.equal(summaryFromRaw({ summary: "A line." }), "A line.");
  assert.equal(summaryFromRaw({ lines: ["one", "two"] }), "one\ntwo");
  assert.equal(summaryFromRaw("plain text"), "plain text");
  assert.equal(summaryFromRaw(null), "");
});

test("buildSummaryPrompt embeds the honesty rules, the CV and the JD", () => {
  const { system, prompt } = buildSummaryPrompt({ jdText: "React role at Acme", masterCv: MASTER_CV });
  assert.match(system, /ABSOLUTE RULES/);
  assert.match(system, /JSON/);
  assert.match(prompt, /MASTER CV/);
  assert.match(prompt, /JOB DESCRIPTION/);
  assert.match(prompt, /Acme/);
  assert.match(prompt, /logistics dashboard/);
});

test("SUMMARY_SCHEMA requires a single summary string", () => {
  assert.equal((SUMMARY_SCHEMA.properties.summary as { type: string }).type, "string");
  assert.deepEqual([...SUMMARY_SCHEMA.required], ["summary"]);
});

test("the cost counter totals only done rows, in GBP", () => {
  const rows = [
    { status: "done", estimated_gbp: PREMIUM_SUMMARY_GBP },
    { status: "done", estimated_gbp: PREMIUM_SUMMARY_GBP },
    { status: "queued", estimated_gbp: PREMIUM_SUMMARY_GBP },
    { status: "failed", estimated_gbp: PREMIUM_SUMMARY_GBP },
  ];
  assert.equal(totalSavedGbp(rows), PREMIUM_SUMMARY_GBP * 2);
  assert.equal(formatGbp(0.07), "£0.07");
  assert.equal(formatGbp(Number.NaN), "£0.00");
  assert.equal(engineLabel("local"), "Local (free)");
  assert.equal(engineLabel("premium"), "Premium (uses your key)");
});

test("queue round trip (logic): input → worker output → verified result", () => {
  // The website enqueues this input (it also stores master_cv so the worker
  // needs no DB read of its own).
  const input: TailorJobInput = { kind: "summary", jd_text: "React role", master_cv: MASTER_CV };

  // The worker runs the model and reports this JSON output. It (honestly) uses
  // only numbers from the master CV.
  const workerOutput = { summary: "Full Stack Engineer with 2 years' experience; cut load time by 35%." };

  // The website reads the result back and runs the honesty check itself (never
  // trusting the worker's own verdict) against the master CV from the input.
  const result = readSummaryResult(workerOutput, input.master_cv);
  assert.ok(result.summary.includes("Full Stack Engineer"));
  assert.equal(result.numbersOk, true);

  // A dishonest worker output is caught here, whatever it claims.
  const bad = readSummaryResult({ summary: "Led 9 teams to 99% uptime." }, input.master_cv);
  assert.equal(bad.numbersOk, false);
  assert.ok((bad.unsupportedNumbers ?? []).length >= 1);
});
