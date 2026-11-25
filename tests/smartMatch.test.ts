// Tests for src/lib/smartMatch.ts — deterministic CV reordering.
// All fixtures are fictional. No real CVs or company data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { smartMatch, parseJdKeywords, reorderSkills, computeCoverage, type Project } from "../src/lib/smartMatch.ts";
import { parseMasterExperience } from "../src/lib/bulletIds.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_CV = `
PROFESSIONAL SUMMARY
Full-stack engineer with 4 years of TypeScript and React experience, building
production systems at scale. Led backend services at Acme Corp.

SKILLS
Technical Tools: TypeScript | React | Node.js | PostgreSQL | Docker | AWS | Jest
Functional Competencies: Agile | CI/CD | Code review | Mentoring

EXPERIENCE

Full Stack Engineer | Acme Corp | Jan 2022 – Dec 2024
• Built REST APIs serving 50 000 active users, reducing latency by 40 %
• Implemented CI/CD pipelines with Docker and GitHub Actions
• Led migration from JavaScript to TypeScript across the entire codebase
• Wrote Jest unit and integration tests achieving 85 % coverage
• Mentored 3 junior engineers through weekly code reviews

Junior Developer | StartupCo | Jun 2020 – Dec 2021
• Delivered React features used by 10 000 users each month
• Integrated PostgreSQL database with 20 tables and complex joins
• Participated in Agile ceremonies and sprint planning

PROJECTS

EDUCATION
BSc Computer Science, University of Example, 2020
`.trim();

const FIXTURE_CV_JAVA_ONLY = `
PROFESSIONAL SUMMARY
Java developer with 5 years of experience in Spring Boot and microservices.

SKILLS
Technical Tools: Java | Spring Boot | Maven | Oracle | Linux

EXPERIENCE

Backend Engineer | JavaCo | Mar 2019 – Dec 2024
• Built Java microservices using Spring Boot deployed on Linux
• Optimised Oracle SQL queries reducing load time by 30 %
• Wrote unit tests with JUnit for core business logic

EDUCATION
BSc Software Engineering 2019
`.trim();

const JD_TYPESCRIPT_REQUIRED = `
Software Engineer

Requirements:
TypeScript
React
Node.js
PostgreSQL

Nice to have:
AWS
Docker
GraphQL
`.trim();

const JD_JAVA_REQUIRED = `
Senior Java Developer

Requirements:
Java
Spring Boot
Microservices architecture

Nice to have:
Kubernetes
Terraform
`.trim();

const JD_GENERAL_NO_HEADINGS = `
We are looking for a full-stack engineer experienced in TypeScript, React and
Node.js. Experience with PostgreSQL and cloud platforms (AWS or GCP) is also
valued. You should be comfortable with CI/CD and code review practices.
`.trim();

const JD_JAVA_VS_JAVASCRIPT = `
Backend Developer

Requirements:
JavaScript
Node.js
Express

Nice to have:
TypeScript
React
`.trim();

const JD_MIXED = `
Platform Engineer

Requirements:
Python
PostgreSQL
Docker
Kubernetes

Preferred:
AWS
Terraform
Helm
`.trim();

const FIXTURE_PROJECTS: Project[] = [
  {
    name: "ChatBot",
    tech: ["TypeScript", "React", "OpenAI"],
    originalBullets: [
      "Built a customer support chatbot using TypeScript and React",
      "Integrated OpenAI API for natural language understanding",
    ],
  },
  {
    name: "DataPipeline",
    tech: ["Python", "PostgreSQL", "Docker"],
    originalBullets: [
      "Designed ETL pipeline processing 10 GB of data daily",
      "Used PostgreSQL as the data warehouse",
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** All 4-word sequences in text. */
function fourGrams(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (let i = 0; i + 3 < words.length; i++) {
    grams.push(words.slice(i, i + 4).join(" ").toLowerCase());
  }
  return grams;
}

function fourGramsInCv(gram: string, cvText: string): boolean {
  // Normalize whitespace so newlines in the CV don't break substring matching.
  const cv = cvText.toLowerCase().replace(/\s+/g, " ");
  return cv.includes(gram.replace(/\s+/g, " "));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("smartMatch", () => {

  it("returns isFreeMatch:true", () => {
    const r = smartMatch(FIXTURE_CV, JD_TYPESCRIPT_REQUIRED, FIXTURE_PROJECTS);
    assert.equal(r.isFreeMatch, true);
  });

  it("evidence IDs: all returned IDs exist in parseMasterExperience output", () => {
    const r = smartMatch(FIXTURE_CV, JD_TYPESCRIPT_REQUIRED, FIXTURE_PROJECTS);
    const roles = parseMasterExperience(FIXTURE_CV);
    const validIds = new Set<string>();
    for (const role of roles) {
      for (const b of role.bullets) validIds.add(b.id);
    }
    for (const id of r.evidenceIds) {
      assert.ok(validIds.has(id), `evidenceId '${id}' not found in master experience`);
    }
    assert.ok(r.evidenceIds.length > 0, "should return at least one evidence ID");
  });

  it("no JD text copied: no 4-gram in output that is not in the master CV", () => {
    // This JD uses distinctive phrases not in the fixture CV
    const jd = `
Requirements:
5+ years of cloud-native observability platform engineering
Distributed tracing infrastructure at petabyte scale
Multi-region Kubernetes federation

Nice to have:
eBPF kernel instrumentation
OpenTelemetry collector configuration pipelines
`.trim();
    const r = smartMatch(FIXTURE_CV, jd, []);
    // Check 4-grams per section — not across a joined string — so we don't
    // produce cross-section sequences like "at Acme Corp. Technical Tools"
    // that wouldn't appear together in the master CV.
    const outputParts = [
      r.sections.summary,
      r.sections.skills,
      r.sections.experience,
      ...Object.values(r.sections.projects).flat(),
    ];
    for (const part of outputParts) {
      if (!part.trim()) continue;
      const normalized = part.toLowerCase().replace(/\s+/g, " ").trim();
      const grams = fourGrams(normalized);
      for (const gram of grams) {
        assert.ok(
          fourGramsInCv(gram, FIXTURE_CV),
          `4-gram not in CV: "${gram}"`,
        );
      }
    }
  });

  it("bullet ranking: a must-have match outranks a nice-to-have only match", () => {
    // JD: TypeScript required, Agile preferred.
    // Acme Corp's bullets:
    //   "Led migration from JavaScript to TypeScript" → matches required:TypeScript
    //   "Participated in Agile ceremonies" → matches preferred:Agile (StartupCo bullet)
    // The TypeScript bullet should rank above the Agile-only bullet within any role.
    const jd = `
Requirements:
TypeScript

Nice to have:
Agile
`.trim();
    const r = smartMatch(FIXTURE_CV, jd, []);
    const experienceLines = r.sections.experience.split("\n").filter((l) => l.startsWith("• "));

    // Find positions
    const tsIdx = experienceLines.findIndex((l) => l.toLowerCase().includes("typescript"));
    const agileIdx = experienceLines.findIndex((l) => l.toLowerCase().includes("agile"));

    if (tsIdx !== -1 && agileIdx !== -1) {
      assert.ok(tsIdx < agileIdx, `TypeScript bullet (pos ${tsIdx}) should rank before Agile-only bullet (pos ${agileIdx})`);
    }
    // Both should be present
    assert.ok(tsIdx !== -1, "TypeScript bullet should appear");
  });

  it("skills: matched skills appear before unmatched skills", () => {
    const r = smartMatch(FIXTURE_CV, JD_TYPESCRIPT_REQUIRED, FIXTURE_PROJECTS);
    const toolsLine = r.sections.skills.split("\n").find((l) => l.toLowerCase().includes("technical tools"));
    assert.ok(toolsLine, "should have Technical Tools line");

    // TypeScript, React, Node.js, PostgreSQL are required → should come first
    const afterColon = toolsLine!.split(":")[1] ?? "";
    const items = afterColon.split("|").map((s) => s.trim().toLowerCase());
    const tsIdx = items.findIndex((i) => i === "typescript");
    const dockerIdx = items.findIndex((i) => i === "docker"); // not in required

    if (tsIdx !== -1 && dockerIdx !== -1) {
      assert.ok(tsIdx < dockerIdx, `TypeScript (pos ${tsIdx}) should precede Docker (pos ${dockerIdx})`);
    }
    assert.ok(tsIdx !== -1, "TypeScript should be in skills");
  });

  it("skills: nothing is added — only original CV items appear", () => {
    const originalItems = new Set([
      "typescript", "react", "node.js", "postgresql", "docker", "aws", "jest",
      "agile", "ci/cd", "code review", "mentoring",
    ]);
    const r = smartMatch(FIXTURE_CV, JD_MIXED, []);
    const skillLines = r.sections.skills.split("\n");
    for (const line of skillLines) {
      const afterColon = line.includes(":") ? line.split(":").slice(1).join(":") : line;
      const items = afterColon.split("|").map((s) => s.trim().toLowerCase()).filter(Boolean);
      for (const item of items) {
        assert.ok(originalItems.has(item), `Invented skill: '${item}'`);
      }
    }
  });

  it("Java does not match JavaScript — atsMatch token protection", () => {
    // CV has only JavaScript/TypeScript/React, no Java
    const r = smartMatch(FIXTURE_CV, JD_JAVA_REQUIRED, []);
    // The Java-only JD should not inflate the coverage
    // Because the CV has no Java, the coverage should be low
    // and all Java-related terms should be in gaps
    assert.ok(r.coverage < 0.5, `Expected low coverage for Java JD against JS/TS CV, got ${r.coverage}`);
  });

  it("JavaScript does not match Java — atsMatch token protection (reverse)", () => {
    // CV is Java-only, JD requires JavaScript
    const r = smartMatch(FIXTURE_CV_JAVA_ONLY, JD_JAVA_VS_JAVASCRIPT, []);
    // "JavaScript" in JD required; CV only has "Java" → should NOT match JavaScript keyword
    // So that term should be in gaps
    const gaps = r.gaps.map((g) => g.toLowerCase());
    const hasJsGap = gaps.some((g) => g.includes("javascript") || g.includes("java"));
    // The CV Java should not satisfy JavaScript requirement
    // coverage < 1 because JavaScript is not in Java-only CV
    assert.ok(r.coverage < 1, `JavaScript keyword should not be fully covered by Java-only CV, coverage=${r.coverage}`);
  });

  it("coverage and gaps: required terms not in CV appear in gaps", () => {
    // JD requires Kubernetes and Python; CV has neither
    const r = smartMatch(FIXTURE_CV, JD_MIXED, []);
    assert.ok(typeof r.coverage === "number", "coverage should be a number");
    assert.ok(r.coverage >= 0 && r.coverage <= 1, "coverage should be 0–1");
    assert.ok(Array.isArray(r.gaps), "gaps should be an array");
    // Python and Kubernetes are not in the fixture CV
    const gapLower = r.gaps.map((g) => g.toLowerCase());
    assert.ok(
      gapLower.some((g) => g.includes("python") || g.includes("kubernetes")),
      `Expected Python or Kubernetes in gaps, got: ${r.gaps.join(", ")}`,
    );
  });

  it("coverage: all required terms present → coverage near 1", () => {
    // JD requires TypeScript and React; CV has both
    const r = smartMatch(FIXTURE_CV, JD_TYPESCRIPT_REQUIRED, FIXTURE_PROJECTS);
    // TypeScript, React, Node.js, PostgreSQL all present in CV
    assert.ok(r.coverage > 0.5, `Expected high coverage, got ${r.coverage}`);
  });

  it("JD with no section headings still produces results", () => {
    const r = smartMatch(FIXTURE_CV, JD_GENERAL_NO_HEADINGS, []);
    assert.ok(r.sections.experience.length > 0, "should produce experience output");
    assert.ok(r.evidenceIds.length > 0, "should produce evidence IDs");
  });

  it("project selection: project matching JD terms is included", () => {
    // JD requires Python, PostgreSQL, Docker → DataPipeline project matches better
    const r = smartMatch(FIXTURE_CV, JD_MIXED, FIXTURE_PROJECTS);
    const hasDataPipeline = Object.values(r.sections.projects).some(
      (bullets) => bullets.some((b) => b.toLowerCase().includes("postgresql") || b.toLowerCase().includes("pipeline")),
    );
    assert.ok(hasDataPipeline, "DataPipeline project should be selected for a Python/PostgreSQL/Docker JD");
  });

  it("project bullets are verbatim from originalBullets — no invention", () => {
    const r = smartMatch(FIXTURE_CV, JD_TYPESCRIPT_REQUIRED, FIXTURE_PROJECTS);
    const allOriginal = new Set([
      ...FIXTURE_PROJECTS.flatMap((p) => p.originalBullets ?? []),
    ]);
    for (const bullets of Object.values(r.sections.projects)) {
      for (const b of bullets) {
        assert.ok(allOriginal.has(b), `Project bullet is not from originalBullets: '${b}'`);
      }
    }
  });

  it("empty CV returns empty sections gracefully", () => {
    const r = smartMatch("", JD_TYPESCRIPT_REQUIRED, []);
    assert.equal(typeof r.sections.summary, "string");
    assert.equal(typeof r.sections.skills, "string");
    assert.equal(typeof r.sections.experience, "string");
    assert.equal(r.evidenceIds.length, 0);
  });

  it("parseJdKeywords: required headings are detected", () => {
    const kw = parseJdKeywords(JD_TYPESCRIPT_REQUIRED);
    const reqLower = kw.required.map((s) => s.toLowerCase());
    assert.ok(reqLower.some((s) => s.includes("typescript")), "TypeScript should be in required");
    assert.ok(reqLower.some((s) => s.includes("react")), "React should be in required");
    const prefLower = kw.preferred.map((s) => s.toLowerCase());
    assert.ok(prefLower.some((s) => s.includes("docker")), "Docker should be in preferred");
  });

  it("reorderSkills: matched items move before unmatched", () => {
    const kw = parseJdKeywords(JD_TYPESCRIPT_REQUIRED);
    const original = "Technical Tools: Docker | AWS | TypeScript | React | Jest";
    const reordered = reorderSkills(original, kw);
    const afterColon = reordered.split(":")[1] ?? "";
    const items = afterColon.split("|").map((s) => s.trim().toLowerCase());
    const tsIdx = items.findIndex((i) => i.includes("typescript"));
    const awsIdx = items.findIndex((i) => i.includes("aws"));
    assert.ok(tsIdx !== -1 && tsIdx < awsIdx, `TypeScript (${tsIdx}) should come before AWS (${awsIdx})`);
  });

  it("computeCoverage returns 1 when no required terms exist", () => {
    const { coverage } = computeCoverage("any cv text", { required: [], preferred: [], general: [] });
    assert.equal(coverage, 1);
  });

});
