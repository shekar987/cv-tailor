import test from "node:test";
import assert from "node:assert/strict";
import { checkPdfTextLayer, countWords, MIN_WORDS } from "../src/lib/pdfTextCheck.ts";

const body = Array.from({ length: 40 }, (_, i) => `Shipped feature ${i} with measurable impact on users.`).join(" ");

test("a real text layer with the name, the email and enough words passes", () => {
  const extracted = `Test Candidate\nLondon · test@example.com · LinkedIn\n${body}`;
  const r = checkPdfTextLayer(extracted, { name: "Test Candidate", email: "test@example.com", sourceWords: 400 });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.ok(r.words >= MIN_WORDS);
});

test("the rasterised-PDF regression: no text extracted fails on every count", () => {
  const r = checkPdfTextLayer("", { name: "Test Candidate", email: "test@example.com", sourceWords: 400 });
  assert.equal(r.ok, false);
  assert.equal(r.words, 0);
  assert.equal(r.problems.length, 3);
  assert.match(r.problems[0], /only 0 words extracted \(needed 150\)/);
});

test("name and email are compared ignoring spacing and case; a missing one is named", () => {
  const extracted = `TEST  CANDIDATE\ntest@Example.com\n${body}`;
  assert.equal(checkPdfTextLayer(extracted, { name: "Test Candidate", email: "test@example.com", sourceWords: 400 }).ok, true);
  const r = checkPdfTextLayer(`Somebody Else\n${body}`, { name: "Test Candidate", email: "test@example.com", sourceWords: 400 });
  assert.deepEqual(r.problems, ["the candidate's name is missing from the text layer", "the email address is missing from the text layer"]);
  // An empty profile (blank header) expects nothing of the header.
  assert.equal(checkPdfTextLayer(body, { name: "", email: "", sourceWords: 400 }).ok, true);
});

test("a short source document is judged against itself, not against 150 words", () => {
  const letter = "Dear Hiring Manager, I am applying for the role. Kind regards, Soma";
  const r = checkPdfTextLayer(letter, { sourceWords: countWords(letter) });
  assert.equal(r.ok, true, r.problems.join("; "));
  // Losing most of it still fails.
  const lost = checkPdfTextLayer("Dear Hiring Manager,", { sourceWords: countWords(letter) });
  assert.equal(lost.ok, false);
});

test("countWords ignores bare punctuation and separators", () => {
  assert.equal(countWords("London · +44 7700 900000 · a@b.com | — ·"), 5);
});
