// A grouped skills block keeps only its label lines (lib/skillsLines
// dropStrayLines): the 17 Oct eval's recsys run put a 23-line "EVIDENCE &
// RATIONALE" block under the groups and every line reached the CV. A flat
// (UKJI) block is never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropStrayLines } from "../src/lib/skillsLines.ts";
import { applyFormatRules, formatRulesFor } from "../src/lib/formatRules.ts";
import { SKILLS_SHAPE } from "../src/lib/formatStyles/ids.ts";
import { FORMAT_STYLES } from "../src/lib/formatStyles/index.ts";

const GROUPED = [
  "Functional Competencies: Recommendation systems | Model monitoring | Feature engineering",
  "Technical Tools:",
  "Languages & Frameworks: Python, PyTorch, scikit-learn",
  "",
  "Databases: PostgreSQL",
  "Cloud & DevOps: Docker, AWS SageMaker",
  "",
  "EVIDENCE & RATIONALE:",
  "**Included (master CV shows these explicitly):**",
  "- Recommendation systems: \"Recommendation model raising basket size 9%\" (Nimbus Retail).",
  "- Kubeflow, JAX: Listed under \"Currently learning\" — explicitly excluded by rule 2.",
  "**Revision to include Pandas:**",
].join("\n");

test("dropStrayLines keeps the label lines and blanks of a grouped block and reports the rest", () => {
  const out = dropStrayLines(GROUPED, SKILLS_SHAPE.careerset);
  assert.deepEqual(out.skills.split("\n"), [
    "Functional Competencies: Recommendation systems | Model monitoring | Feature engineering",
    "Technical Tools:",
    "Languages & Frameworks: Python, PyTorch, scikit-learn",
    "",
    "Databases: PostgreSQL",
    "Cloud & DevOps: Docker, AWS SageMaker",
    "",
  ]);
  assert.equal(out.dropped.length, 5);
  assert.ok(out.dropped.includes("EVIDENCE & RATIONALE:"));
  assert.ok(out.dropped.some((l) => l.startsWith("- Kubeflow, JAX")));
  // Bold labels still count as labels.
  assert.deepEqual(dropStrayLines("**Technical Tools:**\n**Databases:** PostgreSQL", SKILLS_SHAPE.careerset).dropped, []);
  // A clean block comes back as the same string.
  const clean = "Functional Competencies: A | B\nTechnical Tools:\nDatabases: PostgreSQL";
  assert.equal(dropStrayLines(clean, SKILLS_SHAPE.careerset).skills, clean);
});

test("a flat (UKJI) block is returned untouched, commentary and all", () => {
  const flat = "Functional Competencies: A | B\nTechnical Tools: Python | SQL\nNote: Kubeflow is only being learned.";
  assert.deepEqual(dropStrayLines(flat, SKILLS_SHAPE.ukji), { skills: flat, dropped: [] });
});

test("applyFormatRules reports strayLines for CareerSet and never for UKJI", () => {
  const analysis = { top_15_ats_keywords: ["Python"], required_skills: ["Python"] };
  const cv = "SKILLS\nPython, PyTorch, scikit-learn, PostgreSQL, Docker, AWS SageMaker\nEXPERIENCE\nBuilt the recommendation model in Python and PyTorch on PostgreSQL, deployed with Docker on AWS SageMaker.";
  const cs = applyFormatRules({ summary: "S.", skills: GROUPED }, analysis, [cv], "", null, formatRulesFor(FORMAT_STYLES.careerset));
  assert.equal(cs.fixes.strayLines?.length, 5);
  assert.ok(!String(cs.skills).includes("EVIDENCE"));
  assert.ok(String(cs.skills).includes("Databases: PostgreSQL"));
  const ukji = applyFormatRules({ summary: "S.", skills: "Functional Competencies: A | B\nTechnical Tools: Python | PyTorch\nNote: kept as written." }, analysis, [cv], "", null, formatRulesFor(FORMAT_STYLES.ukji));
  assert.equal(ukji.fixes.strayLines, null);
  assert.ok(String(ukji.skills).includes("Note: kept as written."));
});
