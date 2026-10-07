// Unit tests for the one-page letter fit (lib/letterFit). node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLetterToOnePage, LETTER_FIT_MAX_REMOVALS } from "../src/lib/letterFit.ts";

const LETTER = [
  "Dear Acme team,",
  "",
  "I am applying for the Backend Engineer role at Acme. At Northwind Labs I cut response times by 25%.",
  "",
  "I have read the job description and feel that I'm a great fit due to the following reasons:",
  "1. Python and FastAPI services: at Northwind Labs I built REST services in Python and FastAPI. Response times fell by 25%. Deploys went from 40 minutes to 12.",
  "2. PostgreSQL: I optimised queries with indexing and caching. Read times improved by 30%. The cache cut load on the primary.",
  "",
  "I have not yet worked with Kafka, and I would expect to learn it from your team.",
  "",
  "I have the permanent right to work in the UK and will not require visa sponsorship.",
  "",
  "Kind regards,",
  "Alex Tester",
].join("\n");

// A fake page counter: one page per 420 characters of body text.
const counter = (perPage: number) => (text: string) => Math.max(1, Math.ceil(text.replace(/\s+/g, " ").length / perPage));

test("a letter that fits is returned untouched", () => {
  const r = fitLetterToOnePage(LETTER, () => 1);
  assert.equal(r.text, LETTER);
  assert.deepEqual(r.report, { target: 1, pagesBefore: 1, pagesAfter: 1, removed: [], fits: true });
});

test("over one page, the longest body line gives up its last sentence first; the opening, the sign-off and the protected statement never move", () => {
  const rtw = "I have the permanent right to work in the UK and will not require visa sponsorship.";
  const r = fitLetterToOnePage(LETTER, counter(560), { protect: [rtw] });
  assert.ok(r.report.pagesBefore > 1);
  assert.equal(r.report.pagesAfter, 1);
  assert.ok(r.report.fits);
  assert.equal(r.report.removed[0], "Deploys went from 40 minutes to 12.", "the longest line's last sentence goes first");
  assert.ok(r.text.includes("I am applying for the Backend Engineer role at Acme."), "the opening stays");
  assert.ok(r.text.includes(rtw), "the protected statement stays");
  assert.ok(r.text.includes("Kind regards,\nAlex Tester"), "the sign-off stays");
  assert.ok(r.text.startsWith("Dear Acme team,"));
});

test("a line reduced to nothing is removed with its blank; the cap stops a letter that cannot fit", () => {
  const r = fitLetterToOnePage(LETTER, () => 3, { maxRemovals: 3 });
  assert.equal(r.report.removed.length, 3);
  assert.equal(r.report.fits, false);
  assert.ok(!/\n{3,}/.test(r.text), "no triple blank lines");
  const all = fitLetterToOnePage(LETTER, () => 2);
  assert.ok(all.report.removed.length <= LETTER_FIT_MAX_REMOVALS);
  assert.ok(all.text.includes("I am applying for the Backend Engineer role at Acme."), "even a hopeless fit never removes the opening");
  assert.ok(all.text.includes("Kind regards,"));
});
