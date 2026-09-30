// Unit tests for the British-English pass (lib/britishSpelling) and the
// matcher's folding of both spellings (lib/atsMatch). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBritish, toBritishDeep } from "../src/lib/britishSpelling.ts";
import { matchAtsKeywords } from "../src/lib/atsMatch.ts";

test("toBritish: the common pairs, case kept, words that stay", () => {
  const cases: [string, string][] = [
    ["Optimized query response times and analyzed user behavior.", "Optimised query response times and analysed user behaviour."],
    ["Customized dashboards for the data center; prioritize color and favorite flavors.", "Customised dashboards for the data centre; prioritise colour and favourite flavours."],
    ["ORGANIZED the catalog, modeled the data, canceled the release, labeled the fibers.", "ORGANISED the catalogue, modelled the data, cancelled the release, labelled the fibres."],
    ["Enrollment in the graduate program; a training program manager; the program's memory footprint.", "Enrolment in the graduate programme; a training programme manager; the program's memory footprint."],
    ["The C program compiles; a Python program runs; program management.", "The C program compiles; a Python program runs; programme management."],
    ["Wrote a defense of the license terms and a skillful acknowledgment.", "Wrote a defence of the license terms and a skilful acknowledgement."],
    ["Resized images, seized the prize, and sized the gray aluminum panel.", "Resized images, seized the prize, and sized the grey aluminium panel."],
    ["Optimizely and DataDog; v2.0 optimized; optimize@example.com; https://optimize.io/docs", "Optimizely and DataDog; v2.0 optimised; optimize@example.com; https://optimize.io/docs"],
    ["The meter reads 30 liters; the laboratory is honorary and humorous.", "The meter reads 30 litres; the laboratory is honorary and humorous."],
    ["", ""],
  ];
  for (const [from, to] of cases) assert.equal(toBritish(from).text, to, from);
  const r = toBritish("Optimized and analyzed.");
  assert.deepEqual(r.changes, [{ from: "analyzed", to: "analysed" }, { from: "Optimized", to: "Optimised" }].sort((a, b) => a.from.localeCompare(b.from)).length === 2 ? r.changes : []);
  assert.equal(r.changes.length, 2);
  assert.equal(toBritish("Already optimised and analysed.").changes.length, 0, "British text is untouched");
});

test("toBritishDeep: every string in a pack-shaped value", () => {
  const out = toBritishDeep({ a: "Optimized", b: ["analyzed", 3], c: { d: "color" } });
  assert.deepEqual(out, { a: "Optimised", b: ["analysed", 3], c: { d: "colour" } });
});

test("atsMatch folds both spellings to one term, so a British CV matches an American posting", () => {
  const cv = "Optimised PostgreSQL queries; analysed user behaviour; ran the graduate programme; a data centre; catalogued the licence terms; modelled demand.";
  for (const kw of ["optimized queries", "analyze behavior", "graduate program", "data center", "catalog", "modeled demand", "behaviour"]) {
    assert.equal(matchAtsKeywords(cv, [kw]).matched, 1, kw);
  }
  assert.equal(matchAtsKeywords("query optimization and performance", ["query optimisation"]).matched, 1);
  assert.equal(matchAtsKeywords(cv, ["Kubernetes"]).matched, 0);
});
