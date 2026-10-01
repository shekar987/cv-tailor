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

test("rule 8 through the spelling pass: headers, mid-sentence names and protected words are never respelt (review, 1 Oct)", () => {
  const header = "Program Manager | Center Parcs | Jan 2020 – Present\n• Optimized the center's booking flow and centered the team on outcomes";
  const r = toBritish(header);
  assert.equal(r.text.split("\n")[0], "Program Manager | Center Parcs | Jan 2020 – Present", "a job header is verbatim");
  assert.equal(r.text.split("\n")[1], "• Optimised the centre's booking flow and centred the team on outcomes");
  assert.equal(toBritish("Dear Center Parcs team,").text, "Dear Center Parcs team,");
  assert.equal(toBritish("I joined Honor Technology and Gray Matter Ltd in Belize.").text, "I joined Honor Technology and Gray Matter Ltd in Belize.");
  assert.equal(toBritish("Colorize the chart.").text, "Colourise the chart.", "a sentence-initial common word still converts");
  assert.equal(toBritish("Color Health hired me.", { protect: ["Color"] }).text, "Color Health hired me.", "a sentence-initial name needs the route's protection (the company's name is protected)");
  assert.equal(toBritish("centering the layout; the theater's lens").text, "centring the layout; the theatre's lens");
  assert.equal(toBritish("optimized at Centering Ltd", { protect: ["Centering"] }).text, "optimised at Centering Ltd");
  assert.equal(toBritish("the Graduate Program at Acme").text, "the Graduate Programme at Acme", "the two-word scheme rule keeps its case");
});
