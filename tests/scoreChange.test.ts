import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreChange, scoreChangeLine } from "../src/lib/scoreChange.ts";
import { matchAtsKeywords } from "../src/lib/atsMatch.ts";
import { toListRow, toPageRow } from "../src/lib/applicationRows.ts";

const TERMS = ["Python", "FastAPI", "PostgreSQL", "Kubernetes", "Computer Science"];
const MASTER = `Alex Tester

WORK EXPERIENCE
Software Engineer | Northwind Labs | Jul 2024 – Present
• Built REST services in Python and FastAPI on PostgreSQL

EDUCATION
BSc Computer Science, University of Leeds`;

// /api/analyze scores the master CV text /app sends as cvText; the "before" reads the same
// whole text, Education included, which the score after tailoring does not read.
test("the 'before' reads the whole master CV, Education included; the 'after' only what it is given", () => {
  const c = scoreChange(MASTER, "Built services in Python", TERMS);
  assert.ok(c);
  assert.ok(c.before.matchedKeywords.includes("Computer Science"));
  assert.equal(matchAtsKeywords(MASTER.replace(/EDUCATION[\s\S]*$/, ""), TERMS).matchedKeywords.includes("Computer Science"), false);
  assert.deepEqual(c.after.matchedKeywords, ["Python"]);
  assert.equal(c.before.total, c.after.total);
});

test("terms gained and terms no longer counted are named", () => {
  // The tailored sections carry FastAPI and Python but not the degree, which only Education names.
  const tailored = "Software Engineer building Python and FastAPI services on PostgreSQL";
  const c = scoreChange(MASTER, tailored, TERMS);
  assert.ok(c);
  assert.equal(c.before.matched, 4);
  assert.equal(c.after.matched, 3);
  assert.deepEqual(c.gained, []);
  assert.deepEqual(c.lost, ["Computer Science"]);
  assert.match(scoreChangeLine(c), /^Before tailoring: 4\/5 in your master CV\. No longer counted: Computer Science \(/);
});

test("an unchanged count says so", () => {
  const c = scoreChange("Python and FastAPI", "Python, FastAPI", ["Python", "FastAPI", "Go"]);
  assert.ok(c);
  assert.equal(scoreChangeLine(c), "Before tailoring: 2/3 in your master CV. Tailoring did not change which terms are matched.");
});

test("a gained term is named", () => {
  const c = scoreChange("Python", "Python on Kubernetes", ["Python", "Kubernetes"]);
  assert.equal(c && scoreChangeLine(c), "Before tailoring: 1/2 in your master CV. Now matched: Kubernetes.");
});

test("no line rather than one that contradicts the figure on the card", () => {
  assert.equal(scoreChange(MASTER, "Python", TERMS, 4), null);
  assert.ok(scoreChange(MASTER, "Python", TERMS, 1));
  assert.equal(scoreChange(MASTER, "Python", []), null);
  assert.equal(scoreChange(MASTER, "Python", undefined), null);
});

// Chunk 24: the list says a tailored row holds a letter without sending the letter.
test("the list flags a stored letter and never carries its text", () => {
  const row = { id: "a", company_name: "Acme", role: "Engineer", status: "applied", source: "tailored", cover_letter_text: "Dear Acme team,\nI am applying…" };
  const listed = toListRow(row);
  assert.equal(listed.has_cover_letter, true);
  assert.equal("cover_letter_text" in listed, false);
  assert.equal(toPageRow(row).has_cover_letter, true);
  assert.equal("has_cover_letter" in toListRow({ ...row, cover_letter_text: "  " }), false);
  assert.equal("has_cover_letter" in toListRow({ ...row, cover_letter_text: null }), false);
});
