// Unit tests: the exact role title must appear in the professional summary. node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreTitle, titleInText, titleAsIdentity } from "../src/lib/roleTitle.ts";

test("coreTitle strips qualifiers and keeps the title itself", () => {
  assert.equal(coreTitle("Software Engineer (AI/Backend)"), "Software Engineer");
  assert.equal(coreTitle("Forward Deployed Engineer - London"), "Forward Deployed Engineer");
  assert.equal(coreTitle("Applied AI Engineer | Seamflow"), "Applied AI Engineer");
  assert.equal(coreTitle("Senior Full Stack Developer (Java)"), "Senior Full Stack Developer");
  assert.equal(coreTitle("Fullstack Engineer (TypeScript / Python / AWS)"), "Fullstack Engineer");
  assert.equal(coreTitle(""), "");
  assert.equal(coreTitle(null), "");
});

test("titleInText: the two real gaps are caught, natural phrasings pass", () => {
  const missing = "Full-stack engineer with two years shipping Python/FastAPI services and React frontends.\nBuilt Jobhuntz, an LLM product, solo.\nAWS Certified AI Practitioner.";
  assert.equal(titleInText(missing, "Forward Deployed Engineer"), false);
  assert.equal(titleInText(missing, "Applied AI Engineer"), false);
  const present = "Full-stack engineer with two years shipping Python/FastAPI services, targeting a Forward Deployed Engineer role.\nBuilt Jobhuntz solo.\nAWS certified.";
  assert.equal(titleInText(present, "Forward Deployed Engineer"), true);
  assert.equal(titleInText("Applied AI Engineer with two years of production Python.", "Applied AI Engineer"), true);
  // Case, hyphens and punctuation don't matter; partial words do.
  assert.equal(titleInText("Seeking a forward-deployed engineer position.", "Forward Deployed Engineer"), true);
  assert.equal(titleInText("Seeking a Forward Deployed Engineering position.", "Forward Deployed Engineer"), false);
  assert.equal(titleInText("Backend engineer.", "Engineer"), true);
  assert.equal(titleInText("", "Engineer"), false);
  assert.equal(titleInText("Engineer", ""), false);
});

test("titleAsIdentity: a plain software title or one the candidate held opens the summary; a specialised or senior one never does", () => {
  const held = ["Research Assistant", "Full Stack Engineer", "Full Stack Development Intern"];
  assert.equal(titleAsIdentity("Software Developer – AI & Business Systems", held), true);
  assert.equal(titleAsIdentity("Junior Software Engineer", held), true);
  assert.equal(titleAsIdentity("Graduate Software Engineer", held), true);
  assert.equal(titleAsIdentity("Fullstack Engineer (TypeScript / Python / AWS)", held), true, "held, spelled differently");
  assert.equal(titleAsIdentity("Full Stack Developer", held), true, "developer and engineer read alike");
  assert.equal(titleAsIdentity("Product Engineer", held), false);
  assert.equal(titleAsIdentity("Forward Deployed Engineer", held), false);
  assert.equal(titleAsIdentity("Frontend Engineer", held), false);
  assert.equal(titleAsIdentity("Senior Software Engineer", held), false, "never claims seniority");
  assert.equal(titleAsIdentity("Lead Full Stack Engineer", held), false);
  assert.equal(titleAsIdentity("", held), false);
});
