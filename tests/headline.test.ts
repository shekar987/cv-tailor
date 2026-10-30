import test from "node:test";
import assert from "node:assert/strict";
import { buildHeadline, rolePhrase, topProductionSkills, yearsLabel, MAX_TAGLINE_CHARS } from "../src/lib/headline.ts";
import { cleanTagline, dedupeParentheticals, stripSkillGroupLabels } from "../src/lib/profile.ts";

const claims = {
  skills: [
    { name: "React", level: "production" },
    { name: "Node.js", level: "production" },
    { name: "LangChain", level: "project" },
    { name: "Kubernetes", level: "learning" },
  ],
};

test("topProductionSkills: the posting's terms the registry holds at production level, in registry spelling", () => {
  assert.deepEqual(topProductionSkills(claims, ["LangChain", "Node.js", "React"], ["Kubernetes"], 3), ["Node.js", "React"], "project-level LangChain and learning Kubernetes are skipped");
  assert.deepEqual(topProductionSkills(claims, ["Kubernetes"], ["react.js"], 3), ["React"], "keywords come after required skills");
  assert.deepEqual(topProductionSkills(claims, ["Go", "Rust"], ["Terraform"], 3), []);
  assert.deepEqual(topProductionSkills(null, ["React"], [], 3), [], "no registry, no claim");
  assert.deepEqual(topProductionSkills({ skills: [{ name: "Languages & Frameworks: React", level: "production" }] }, ["React"], [], 3), [], "a registry entry that is a label is never a skill");
});

test("yearsLabel uses only the stated figure, never 'production'", () => {
  assert.equal(yearsLabel(2), "2 years' experience");
  assert.equal(yearsLabel(1), "1 year' experience");
  assert.equal(yearsLabel(null), "");
  assert.equal(yearsLabel(0), "");
});

test("rolePhrase: the first segment naming a role, labels and tool brackets gone, one short bracket kept", () => {
  assert.equal(rolePhrase("Languages & Frameworks: Python, React | Full Stack Engineer (Python, FastAPI) (Python, FastAPI)"), "Full Stack Engineer");
  assert.equal(rolePhrase("Product Engineer (Full Stack)"), "Product Engineer (Full Stack)", "a short qualifier stays");
  assert.equal(rolePhrase("Product Engineer (Full Stack) (Full Stack)"), "Product Engineer (Full Stack)", "said once");
  assert.equal(rolePhrase("Software Engineering Graduate Scheme (2027 intake)"), "", "no role noun");
  assert.equal(rolePhrase("Java Software Engineer - Associate"), "Java Software Engineer");
  assert.equal(rolePhrase("MSc Computer Science, University of Hartwell | 2+ YoE | Full Stack Engineer | AI Engineer"), "Full Stack Engineer");
  assert.equal(rolePhrase("Technical Tools: Python, React"), "");
  assert.equal(rolePhrase(undefined), "");
});

test("buildHeadline: role · years · stack; the posting's title only as the identity the route allows", () => {
  const input = { claims, requiredSkills: ["React", "Node.js"], keywords: [], yearsExperience: 2, heldTitles: ["Full Stack Engineer"] };
  assert.equal(buildHeadline({ ...input, identityTitle: "Software Developer" }).headline, "Software Developer · 2 years' experience · React, Node.js");
  // No identity title: the candidate's own role — variant, then saved tagline, then held title.
  assert.equal(buildHeadline({ ...input, identityTitle: null, positioning: "Platform engineer", savedTagline: "Backend Developer" }).headline, "Platform engineer · 2 years' experience · React, Node.js");
  assert.equal(buildHeadline({ ...input, savedTagline: "Backend Developer (Full-Time, 2 years)" }).headline, "Backend Developer · 2 years' experience · React, Node.js", "a bracket with a figure goes");
  assert.equal(buildHeadline(input).headline, "Full Stack Engineer · 2 years' experience · React, Node.js");
  // A stack item the role already names is not said twice.
  assert.equal(buildHeadline({ ...input, identityTitle: "React Developer" }).headline, "React Developer · 2 years' experience · Node.js");
  // Nothing stated, nothing printed.
  assert.equal(buildHeadline({ claims: null, requiredSkills: [], keywords: [], yearsExperience: null }).headline, "");
  // The posting's title is not an input — a stray one is ignored.
  const stray = { claims: null, requiredSkills: [], keywords: [], yearsExperience: null, roleTitle: "Python Developer - Options Market Making" };
  assert.equal(buildHeadline(stray).headline, "");
});

test("buildHeadline stays one line: past the cap the stack gives up its last items, then the years", () => {
  const long = { skills: ["PostgreSQL", "TypeScript", "Kubernetes Operators"].map((name) => ({ name, level: "production" })) };
  const role = "Senior Machine Learning Platform Infrastructure Engineer";
  const r = buildHeadline({ claims: long, requiredSkills: ["PostgreSQL", "TypeScript", "Kubernetes Operators"], keywords: [], yearsExperience: 12, positioning: role });
  assert.ok(r.headline.length <= MAX_TAGLINE_CHARS, `${r.headline.length} chars`);
  assert.equal(r.headline, "Senior Machine Learning Platform Infrastructure Engineer · 12 years' experience");
  assert.ok(!r.headline.includes("\n"));
});

test("cleanTagline (every renderer's last guard): no skills group label, no repeated bracket", () => {
  assert.equal(stripSkillGroupLabels("Languages & Frameworks: Python").trim(), "Python");
  assert.equal(cleanTagline("Languages & Frameworks: Python, React | Full Stack Engineer (Python, FastAPI) (FastAPI, Python)"), "Python, React | Full Stack Engineer (Python, FastAPI)");
  assert.equal(cleanTagline("Technical Tools: Python · Databases: PostgreSQL"), "Python · PostgreSQL");
  assert.equal(dedupeParentheticals("Engineer (Full Stack) · (full  stack)"), "Engineer (Full Stack) ·");
  assert.equal(cleanTagline("Software Engineer · Developer Experience"), "Software Engineer · Developer Experience", "no label, untouched");
});
