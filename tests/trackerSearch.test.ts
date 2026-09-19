// Unit tests for the tracker search matcher. node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldText, dateForms, matchesSearch, MAX_SEARCH_CHARS } from "../src/lib/trackerSearch.ts";

const rows = [
  { company_name: "Acme Ltd", role: "Backend Engineer", date_applied: "2026-09-18", notes: "Kafka everywhere", salary: "£65k" },
  { company_name: "Zürich Insurance", role: "Platform Engineer", date_applied: "2026-09-02" },
  { company_name: "Beta Corp", role: "Data Analyst", date_applied: "2026-08-30" },
];
const hits = (q: string) => rows.filter((r) => matchesSearch(r, q)).map((r) => r.company_name);

test("foldText: case, accents and whitespace fold away", () => {
  assert.equal(foldText("  Zürich   Insurance "), "zurich insurance");
  assert.equal(foldText("Café Société"), "cafe societe");
  assert.equal(foldText(null), "");
});

test("dateForms: the spellings a user types for one applied date, mirroring the sheet's '18 Sep 2026'", () => {
  assert.deepEqual(dateForms("2026-09-18"), [
    "2026-09-18",
    "18 sep 2026",
    "18 september 2026",
    "18/09/2026",
    "18-09-2026",
    "sep 2026",
    "september 2026",
  ]);
  assert.deepEqual(dateForms("2026-09-02")[1], "2 sep 2026");
  assert.deepEqual(dateForms("18 Sep 2026"), []);
  assert.deepEqual(dateForms("2026-13-01"), []);
  assert.deepEqual(dateForms(null), []);
});

test("matchesSearch: company, role and date — every token must match, in any field", () => {
  assert.deepEqual(hits("acme"), ["Acme Ltd"]);
  assert.deepEqual(hits("ACME"), ["Acme Ltd"]);
  assert.deepEqual(hits("engineer"), ["Acme Ltd", "Zürich Insurance"]);
  assert.deepEqual(hits("acme eng"), ["Acme Ltd"]);
  assert.deepEqual(hits("acme analyst"), []);
  assert.deepEqual(hits("zurich"), ["Zürich Insurance"]);
  assert.deepEqual(hits("Zürich"), ["Zürich Insurance"]);
});

test("matchesSearch: dates match as typed — ISO, '18 sep', '18/09/2026', a month", () => {
  assert.deepEqual(hits("2026-09-18"), ["Acme Ltd"]);
  assert.deepEqual(hits("18 sep"), ["Acme Ltd"]);
  assert.deepEqual(hits("18 Sep 2026"), ["Acme Ltd"]);
  assert.deepEqual(hits("18/09/2026"), ["Acme Ltd"]);
  assert.deepEqual(hits("2026-09"), ["Acme Ltd", "Zürich Insurance"]);
  assert.deepEqual(hits("sep 2026"), ["Acme Ltd", "Zürich Insurance"]);
  assert.deepEqual(hits("august"), ["Beta Corp"]);
  assert.deepEqual(hits("engineer sep"), ["Acme Ltd", "Zürich Insurance"]);
});

test("matchesSearch: an empty query matches everything; notes and salary are not searched; the query is capped", () => {
  assert.equal(hits("").length, 3);
  assert.equal(hits("   ").length, 3);
  assert.deepEqual(hits("kafka"), []);
  assert.deepEqual(hits("65k"), []);
  assert.equal(matchesSearch(rows[0], undefined), true);
  assert.equal(matchesSearch({}, "acme"), false);
  // Only the first MAX_SEARCH_CHARS are considered.
  const long = "acme" + " x".repeat(MAX_SEARCH_CHARS);
  assert.equal(matchesSearch(rows[0], long), false);
  assert.equal(matchesSearch(rows[0], "acme".padEnd(MAX_SEARCH_CHARS, " ") + "zzz"), true);
});
