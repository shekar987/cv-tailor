// Unit tests: every proper noun in a cover letter must come from the JD, the research or the CV. node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { properNounRuns, unsupportedProperNouns, sentencesNaming, dropSentences } from "../src/lib/properNouns.ts";

const JD = "Forward Deployed Engineer at Seamflow. Location: London (hybrid). You will work with our customers in regulated industries.";
const RESEARCH = JSON.stringify({ company_name: "Seamflow", what_they_build: "Certification workflow automation for regulated manufacturers", engineering_stack: ["Python", "PostgreSQL"] });
const CV = "SOMA SHEKAR KEESARI\nLondon, UK\nFull Stack Engineer — Brane Group\nBuilt FastAPI services. Built Jobhuntz, an LLM product, and RideX, a ride-hailing platform.\nMSc Computer Science — University of East London";
const LETTER = `Dear Hiring Manager,

I am writing about the Forward Deployed Engineer role at Seamflow. At Brane Group I built FastAPI services for enterprise workflows. My own LLM product, Jobhuntz, is live today. RideX followed it.

I'm in London and available for on-site work in Shoreditch. Your work with regulated manufacturers is exactly the kind of problem I want to solve.

Kind regards,
Soma Shekar Keesari`;

test("properNounRuns: names, not letter furniture, acronyms or sentence-initial words", () => {
  const runs = properNounRuns(LETTER);
  for (const expected of ["Forward Deployed Engineer", "Seamflow", "Brane Group", "Jobhuntz", "London", "Shoreditch", "Soma Shekar Keesari"]) {
    assert.ok(runs.includes(expected), `${expected} in ${JSON.stringify(runs)}`);
  }
  for (const not of ["Dear Hiring Manager", "Kind", "Your", "At", "I'm", "LLM", "My"]) {
    assert.ok(!runs.includes(not), `${not} should not be a name`);
  }
  // A product-spelled word is a name even at sentence start; a plain
  // sentence-initial word is grammar (the deliberate blind spot).
  assert.ok(runs.includes("RideX"));
  assert.deepEqual(properNounRuns("Shoreditch is lovely. Having said that, I like it."), []);
});

test("unsupportedProperNouns: Shoreditch is invented; everything else traces to a source", () => {
  assert.deepEqual(unsupportedProperNouns(LETTER, [JD, RESEARCH, CV]), ["Shoreditch"]);
  // Without the research, the company still comes from the JD; without the CV, the projects are unsupported.
  assert.deepEqual(unsupportedProperNouns(LETTER, [JD, CV]), ["Shoreditch"]);
  assert.ok(unsupportedProperNouns(LETTER, [JD, RESEARCH]).includes("Jobhuntz"));
  // Possessives and hyphenation do not matter.
  assert.deepEqual(unsupportedProperNouns("Seamflow's customers trust Brane-Group tooling.", [JD, CV]), []);
  assert.deepEqual(unsupportedProperNouns("", [JD]), []);
});

test("sentencesNaming and dropSentences: the offending sentence goes, the paragraph stays", () => {
  const offending = sentencesNaming(LETTER, ["Shoreditch"]);
  assert.deepEqual(offending, ["I'm in London and available for on-site work in Shoreditch."]);
  const fixed = dropSentences(LETTER, offending);
  assert.ok(!/Shoreditch/.test(fixed));
  assert.ok(/Your work with regulated manufacturers/.test(fixed));
  assert.ok(/^Dear Hiring Manager,\n\nI am writing/.test(fixed));
  assert.ok(/Kind regards,\nSoma Shekar Keesari$/.test(fixed));
  assert.equal(dropSentences(LETTER, []), LETTER);
  // Dropping the only sentence of a paragraph drops the paragraph.
  const two = "First paragraph here.\n\nOnly Shoreditch here.\n\nLast paragraph.";
  assert.equal(dropSentences(two, ["Only Shoreditch here."]), "First paragraph here.\n\nLast paragraph.");
});

test("sentencesNaming: a possessive still names the noun (AssetGuard's platform)", () => {
  const letter = "I admire AssetGuard's platform.\n\nAt Brane Group I shipped 20+ API modules.";
  assert.deepEqual(sentencesNaming(letter, ["AssetGuard"]), ["I admire AssetGuard's platform."]);
  assert.equal(dropSentences(letter, sentencesNaming(letter, ["AssetGuard"])), "At Brane Group I shipped 20+ API modules.");
});
