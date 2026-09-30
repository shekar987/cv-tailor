// lib/profile: the boundary coercion every renderer relies on, and the
// headline cleanup the preview, the .docx and the PDF share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTagline, normalizeProfile, normalizeCertification } from "../src/lib/profile.ts";

test("cleanTagline strips URL and social forms, keeps bare words", () => {
  assert.equal(cleanTagline("Backend Engineer | https://github.com/jane | linkedin.com/in/jane"), "Backend Engineer");
  // Only the label goes: a bare handle cannot be told from a word.
  assert.equal(cleanTagline("GitHub: jane · Platform Engineer"), "jane · Platform Engineer");
  assert.equal(cleanTagline("Platform Engineer · GitHub: github.com/jane"), "Platform Engineer");
  assert.equal(cleanTagline("Platform Engineer with GitHub Actions and CI"), "Platform Engineer with GitHub Actions and CI");
  assert.equal(cleanTagline("  — Data Engineer —  "), "Data Engineer");
  assert.equal(cleanTagline(""), "");
});

test("normalizeProfile coerces a malformed model answer to the shape renderers assume", () => {
  const p = normalizeProfile({
    name: "  Jane Doe ", email: 42, education: {}, certifications: "None",
    projects: [{ name: "Widget", links: [{ url: "github.com/jane/widget" }, { label: "Paper" }] }],
    extraSections: [{ title: "Awards", bullets: ["Dean's list", 7, ""] }, { title: "", bullets: ["x"] }],
  });
  assert.equal(p.name, "Jane Doe");
  assert.equal(p.email, "42");
  assert.deepEqual(p.education, []);
  assert.deepEqual(p.certifications, []);
  assert.equal(p.projects.length, 1);
  assert.deepEqual(p.projects[0].links, [{ label: "", url: "github.com/jane/widget", text: "" }]);
  assert.deepEqual(p.extraSections, [{ title: "Awards", bullets: ["Dean's list", "7"] }]);
  assert.deepEqual(normalizeProfile(undefined).rightToWork, []);
});

test("normalizeCertification: vendor names and titles as the vendors write them, a trailing provider in brackets, nothing else guessed", () => {
  assert.equal(normalizeCertification("Aws Certified Ai practitioner"), "AWS Certified AI Practitioner");
  assert.equal(normalizeCertification("aws certified cloud practitioner (2025)"), "AWS Certified Cloud Practitioner (2025)");
  assert.equal(normalizeCertification("Cloud Computing- NPTEL"), "Cloud Computing (NPTEL)");
  assert.equal(normalizeCertification("Data Structures – nptel"), "Data Structures (NPTEL)");
  assert.equal(normalizeCertification("Python for Everybody | Coursera"), "Python for Everybody (Coursera)");
  assert.equal(normalizeCertification("Machine Learning (NPTEL)"), "Machine Learning (NPTEL)", "already bracketed stays");
  assert.equal(normalizeCertification("Microsoft azure fundamentals (AZ-900)"), "Microsoft Azure fundamentals (AZ-900)", "only listed names change case");
  assert.equal(normalizeCertification("Some Course by Acme - Level 2"), "Some Course by Acme - Level 2", "an unknown trailing part is not a provider");
  assert.equal(normalizeCertification(""), "");
  assert.deepEqual(normalizeProfile({ certifications: ["Aws Certified Ai practitioner", 42, "Cloud Computing- NPTEL"] }).certifications, ["AWS Certified AI Practitioner", "42", "Cloud Computing (NPTEL)"]);
});
