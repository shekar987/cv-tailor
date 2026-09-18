// Unit tests: the exact role title must appear in the professional summary. node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreTitle, titleInText } from "../src/lib/roleTitle.ts";

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
