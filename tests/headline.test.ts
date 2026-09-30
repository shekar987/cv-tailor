import test from "node:test";
import assert from "node:assert/strict";
import { buildHeadline, qualificationLabel, topProductionSkill, yearsLabel } from "../src/lib/headline.ts";

const claims = {
  skills: [
    { name: "React", level: "production" },
    { name: "Node.js", level: "production" },
    { name: "LangChain", level: "project" },
    { name: "Kubernetes", level: "learning" },
  ],
};

test("qualificationLabel reads the status off the entry itself, never guesses", () => {
  assert.equal(qualificationLabel({ degree: "MSc Computer Science", dates: "Sep 2024 – Present" }, 2026), "MSc Computer Science (in progress)", "a start year is never the expected year");
  assert.equal(qualificationLabel({ degree: "MSc Computer Science", dates: "2024 – 2026", note: "Expected graduation 2026" }, 2026), "MSc Computer Science (in progress, expected 2026)");
  assert.equal(qualificationLabel({ degree: "MSc Computer Science", dates: "Sep 2025 – Sep 2026" }, 2026), "MSc Computer Science (in progress, expected 2026)", "an end year that has not passed is in progress");
  assert.equal(qualificationLabel({ degree: "BSc (Hons) Computer Science", dates: "2020 – 2023" }, 2026), "BSc (Hons) Computer Science (2023)");
  assert.equal(qualificationLabel({ degree: "BSc Computing", dates: "" }), "BSc Computing");
  assert.equal(qualificationLabel(undefined), "");
});

test("topProductionSkill: the posting's first term that the registry holds at production level, in registry spelling", () => {
  assert.equal(topProductionSkill(claims, ["LangChain", "Node.js", "React"], ["Kubernetes"]), "Node.js", "project-level LangChain is skipped");
  assert.equal(topProductionSkill(claims, ["Kubernetes"], ["react.js"]), "React", "learning is never a headline; keywords come after required skills");
  assert.equal(topProductionSkill(claims, ["Go", "Rust"], ["Terraform"]), null);
  assert.equal(topProductionSkill(null, ["React"], []), null, "no registry, no claim");
  assert.equal(topProductionSkill({ skills: [{ name: "React", level: "project" }] }, ["React"], []), null);
});

test("yearsLabel uses only the stated figure", () => {
  assert.equal(yearsLabel(2), "2 years' experience");
  assert.equal(yearsLabel(1), "1 year' experience".replace("year'", "year'"));
  assert.equal(yearsLabel(null), "");
  assert.equal(yearsLabel(0), "");
});

test("buildHeadline joins only the parts that exist, in UKJI order — the positioning variant, never the posting's title", () => {
  const full = buildHeadline({
    education: [{ degree: "MSc Computer Science", dates: "2024 – 2026, expected 2026" }],
    claims,
    requiredSkills: ["React", "TypeScript"],
    keywords: [],
    yearsExperience: 2,
    positioning: "Backend engineer (Java, Spring Boot)",
  });
  assert.equal(full.headline, "MSc Computer Science (in progress, expected 2026) · React · 2 years' experience · Backend engineer (Java, Spring Boot)");
  const sparse = buildHeadline({ education: [], claims: null, requiredSkills: ["React"], keywords: [], yearsExperience: null, positioning: "Platform Engineer" });
  assert.equal(sparse.headline, "Platform Engineer");
  assert.deepEqual(sparse.parts, { qualification: "", skill: "", years: "", positioning: "Platform Engineer" });
  // No variant picked: the three stated parts, no role word at all.
  const none = buildHeadline({ education: [{ degree: "BSc Computing", dates: "2020 – 2023" }], claims, requiredSkills: ["React"], keywords: [], yearsExperience: 2, positioning: null });
  assert.equal(none.headline, "BSc Computing (2023) · React · 2 years' experience");
  // Every letter of the variant's headline survives — "Data Scientist" once lost its lowercase s.
  assert.equal(buildHeadline({ education: [], claims: null, requiredSkills: [], keywords: [], yearsExperience: null, positioning: "Data Scientist   (Python,  statistics)" }).headline, "Data Scientist (Python, statistics)");
  // A picked variant with an empty headline is the same as none.
  assert.equal(buildHeadline({ education: [], claims: null, requiredSkills: [], keywords: [], yearsExperience: null, positioning: "   " }).headline, "");
  // The posting's title is not an input the type accepts — a stray one is ignored.
  const stray = { education: [], claims: null, requiredSkills: [], keywords: [], yearsExperience: null, positioning: null, roleTitle: "Python Developer - Options Market Making" };
  assert.equal(buildHeadline(stray).headline, "");
});
