import test from "node:test";
import assert from "node:assert/strict";
import { isGraduateScheme, graduateSectionOrder } from "../src/lib/graduateMode.ts";
import { DEFAULT_SECTION_ORDER } from "../src/lib/sectionOrder.ts";

test("isGraduateScheme reads the title, then the posting's own words", () => {
  assert.equal(isGraduateScheme("Technology – Software Engineering Graduate Scheme"), true);
  assert.equal(isGraduateScheme("Software Engineer Placement (12 months)"), true);
  assert.equal(isGraduateScheme("Early Careers Software Developer"), true);
  assert.equal(isGraduateScheme("Software Engineer", "Join our two-year graduate programme in London."), true);
  assert.equal(isGraduateScheme("Software Engineer", "We are a graduate-led team shipping daily."), false, "a passing 'graduate' is not a scheme");
  assert.equal(isGraduateScheme("Senior Software Engineer", "5+ years required."), false);
  assert.equal(isGraduateScheme(undefined, ""), false);
});

test("graduateSectionOrder moves Education under the summary, keeps the user's order otherwise", () => {
  assert.deepEqual(graduateSectionOrder(null), { order: ["summary", "education", "skills", "experience", "projects"], changed: true });
  assert.deepEqual(graduateSectionOrder(DEFAULT_SECTION_ORDER), { order: ["summary", "education", "skills", "experience", "projects"], changed: true });
  // Already education-first: untouched.
  const custom = ["education", "summary", "skills", "experience", "projects"];
  assert.deepEqual(graduateSectionOrder(custom), { order: custom, changed: false });
  // No summary: education goes first.
  assert.deepEqual(graduateSectionOrder(["skills", "experience", "projects", "education", "summary"]).order, ["education", "skills", "experience", "projects", "summary"]);
});
