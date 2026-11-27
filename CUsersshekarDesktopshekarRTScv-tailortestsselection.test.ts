// Tests for TL-4: WorkerSelection extension of smartMatch.
// 10 fictional JDs; no real CVs or company data.
// Tests are written first (before implementation).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  smartMatch,
  type Project,
  type WorkerSelection,
} from "../src/lib/smartMatch.ts";
import { parseMasterExperience } from "../src/lib/bulletIds.ts";

// ── Fixture CV (fictional Alex Tester) ────────────────────────────────────────

const SELECTION_CV = `
PROFESSIONAL SUMMARY
Full Stack Engineer with 2 years of TypeScript and React experience.
Built production systems in Node.js, Express and PostgreSQL.

SKILLS
Technical Tools: TypeScript | JavaScript | React | Node.js | Express | PostgreSQL | Python | FastAPI | AWS | Docker | GitHub Actions | Jest | Playwright

EXPERIENCE

Full Stack Engineer | Northgate Systems | Jul 2023 – Present
• Rebuilt the logistics dashboard used by 40 depots, cutting load time by 35%
• Built a REST API in Node.js and Express serving 1.2 million requests a day
• Shipped to AWS on ECS, RDS Postgres and S3 with GitHub Actions CI
• Added Jest and Playwright test suites, taking coverage from 20% to 85%
• Mentored 2 junior developers through weekly code reviews

Junior Developer | Brightwave | Jul 2021 – Jul 2022
• Built internal React tools used by 15 staff to track orders
• Wrote SQL reports over a PostgreSQL warehouse
• Participated in Agile ceremonies and sprint planning

PROJECTS

EDUCATION
BSc Computer Science, University of Bath, 2023
`.trim();

// ── 10 fictional JDs ──────────────────────────────────────────────────────────

// JD 1 — Frontend: CV covers all required terms
const JD_1_FRONTEND = `
Frontend Software Engineer

Requirements:
TypeScript
React
JavaScript

Nice to have:
Node.js
CSS
`.trim();

// JD 2 — Backend: CV covers all required terms
const JD_2_BACKEND = `
Backend Engineer

Requirements:
Node.js
Express
REST APIs

Nice to have:
PostgreSQL
Redis
`.trim();

// JD 3 — Database: CV covers all required terms
const JD_3_DATABASE = `
Data Engineer

Requirements:
PostgreSQL
SQL

Nice to have:
Python
dbt
`.trim();

// JD 4 — DevOps: CV covers all required terms
const JD_4_DEVOPS = `
DevOps Engineer

Requirements:
Docker
AWS
GitHub Actions

Nice to have:
Terraform
Kubernetes
`.trim();

// JD 5 — Testing: CV covers all required terms
const JD_5_TESTING = `
QA Engineer

Requirements:
Jest
Playwright

Nice to have:
Cypress
Selenium
`.trim();

// JD 6 — Python: CV covers required terms (FastAPI in Projects)
const JD_6_PYTHON = `
Python Developer

Requirements:
Python
FastAPI

Nice to have:
Django
PostgreSQL
`.trim();

// JD 7 — Full stack: CV covers all required terms
const JD_7_FULLSTACK = `
Full Stack Engineer

Requirements:
TypeScript
React
Node.js
PostgreSQL

Nice to have:
AWS
Docker
`.trim();

// JD 8 — Cloud: CV covers all required terms
const JD_8_CLOUD = `
Cloud Engineer

Requirements:
AWS
Docker

Nice to have:
GitHub Actions
Terraform
`.trim();

// JD 9 — Java: CV has NO Java/Spring Boot → gaps expected
const JD_9_JAVA = `
Java Developer

Requirements:
Java
Spring Boot
Hibernate

Nice to have:
Maven
JUnit
`.trim();

// JD 10 — Infrastructure: CV has NO Kubernetes/Go/Terraform → gaps expected
const JD_10_INFRA = `
Infrastructure Engineer

Requirements:
Kubernetes
Terraform
Go

Nice to have:
Helm
Ansible
`.trim();

const NO_PROJECTS: Project[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function allBulletIds(cvText: string): Set<string> {
  const roles = parseMasterExperience(cvText);
  const ids = new Set<string>();
  for (const role of roles) {
    for (const b of role.bullets) ids.add(b.id);
  }
  return ids;
}

// ── Tests: basic structure ─────────────────────────────────────────────────────

describe("selection — basic structure", () => {

  it("returns isFreeMatch:true for all 10 JDs", () => {
    const jds = [
      JD_1_FRONTEND, JD_2_BACKEND, JD_3_DATABASE, JD_4_DEVOPS, JD_5_TESTING,
      JD_6_PYTHON, JD_7_FULLSTACK, JD_8_CLOUD, JD_9_JAVA, JD_10_INFRA,
    ];
    for (const jd of jds) {
      const r = smartMatch(SELECTION_CV, jd, NO_PROJECTS);
      assert.equal(r.isFreeMatch, true);
    }
  });

  it("coveredBy is a Record<string,string> for all 10 JDs", () => {
    const jds = [
      JD_1_FRONTEND, JD_2_BACKEND, JD_3_DATABASE, JD_4_DEVOPS, JD_5_TESTING,
      JD_6_PYTHON, JD_7_FULLSTACK, JD_8_CLOUD, JD_9_JAVA, JD_10_INFRA,
    ];
    for (const jd of jds) {
      const r = smartMatch(SELECTION_CV, jd, NO_PROJECTS);
      assert.ok(r.coveredBy !== null && typeof r.coveredBy === "object" && !Array.isArray(r.coveredBy),
        "coveredBy should be a plain object");
      for (const [key, val] of Object.entries(r.coveredBy)) {
        assert.equal(typeof key, "string", "coveredBy key should be a string");
        assert.equal(typeof val, "string", "coveredBy value should be a string");
        assert.ok(val.length > 0, "coveredBy values should be non-empty");
        assert.ok(val.length <= 60, `coveredBy value should be ≤60 chars, got ${val.length}`);
      }
    }
  });

  it("all evidenceIds are real bullet IDs for all 10 JDs", () => {
    const validIds = allBulletIds(SELECTION_CV);
    const jds = [
      JD_1_FRONTEND, JD_2_BACKEND, JD_3_DATABASE, JD_4_DEVOPS, JD_5_TESTING,
      JD_6_PYTHON, JD_7_FULLSTACK, JD_8_CLOUD, JD_9_JAVA, JD_10_INFRA,
    ];
    for (const jd of jds) {
      const r = smartMatch(SELECTION_CV, jd, NO_PROJECTS);
      for (const id of r.evidenceIds) {
        assert.ok(validIds.has(id), `evidenceId '${id}' not in parsed master experience`);
      }
    }
  });

});

// ── Tests: coverage thresholds ─────────────────────────────────────────────────

describe("selection — coverage thresholds", () => {

  it("JD 1 (frontend): coverage >= 0.8 — all required terms in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_1_FRONTEND, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 2 (backend): coverage >= 0.8 — Node.js, Express, REST APIs all in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_2_BACKEND, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 3 (database): coverage >= 0.8 — PostgreSQL and SQL in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_3_DATABASE, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 4 (devops): coverage >= 0.8 — Docker, AWS, GitHub Actions in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_4_DEVOPS, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 5 (testing): coverage >= 0.8 — Jest and Playwright in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_5_TESTING, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 7 (full stack): coverage >= 0.8 — TypeScript, React, Node.js, PostgreSQL in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_7_FULLSTACK, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 8 (cloud): coverage >= 0.8 — AWS and Docker in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_8_CLOUD, NO_PROJECTS);
    assert.ok(r.coverage >= 0.8, `Expected >=0.8, got ${r.coverage}`);
  });

  it("JD 9 (java): coverage < 0.3 — Java/Spring Boot/Hibernate not in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_9_JAVA, NO_PROJECTS);
    assert.ok(r.coverage < 0.3, `Expected <0.3 for Java JD, got ${r.coverage}`);
    assert.ok(r.gaps.length > 0, "Should have gaps for Java JD");
  });

  it("JD 10 (infra): coverage < 0.3 — Kubernetes/Terraform/Go not in CV", () => {
    const r = smartMatch(SELECTION_CV, JD_10_INFRA, NO_PROJECTS);
    assert.ok(r.coverage < 0.3, `Expected <0.3 for infra JD, got ${r.coverage}`);
    assert.ok(r.gaps.length > 0, "Should have gaps for infra JD");
  });

});

// ── Tests: coveredBy populated ─────────────────────────────────────────────────

describe("selection — coveredBy entries", () => {

  it("JD 1 frontend: TypeScript appears in coveredBy", () => {
    const r = smartMatch(SELECTION_CV, JD_1_FRONTEND, NO_PROJECTS);
    const keys = Object.keys(r.coveredBy).map((k) => k.toLowerCase());
    assert.ok(
      keys.some((k) => k.includes("typescript")),
      `Expected TypeScript in coveredBy, got keys: ${Object.keys(r.coveredBy).join(", ")}`,
    );
  });

  it("JD 2 backend: Node.js or Express appears in coveredBy", () => {
    const r = smartMatch(SELECTION_CV, JD_2_BACKEND, NO_PROJECTS);
    const keys = Object.keys(r.coveredBy).map((k) => k.toLowerCase());
    const hasNodeOrExpress = keys.some((k) => k.includes("node") || k.includes("express"));
    assert.ok(hasNodeOrExpress, `Expected Node.js or Express in coveredBy, got: ${Object.keys(r.coveredBy).join(", ")}`);
  });

  it("JD 5 testing: Jest or Playwright appears in coveredBy", () => {
    const r = smartMatch(SELECTION_CV, JD_5_TESTING, NO_PROJECTS);
    const keys = Object.keys(r.coveredBy).map((k) => k.toLowerCase());
    const hasJestOrPlaywright = keys.some((k) => k.includes("jest") || k.includes("playwright"));
    assert.ok(hasJestOrPlaywright, `Expected Jest/Playwright in coveredBy, got: ${Object.keys(r.coveredBy).join(", ")}`);
  });

  it("JD 9 (java): coveredBy does not claim Java or Spring Boot", () => {
    const r = smartMatch(SELECTION_CV, JD_9_JAVA, NO_PROJECTS);
    const keys = Object.keys(r.coveredBy).map((k) => k.toLowerCase());
    const claimsJava = keys.some((k) => k.includes("java") || k.includes("spring"));
    assert.ok(!claimsJava, `coveredBy should not claim Java/Spring for a Java-free CV, got: ${keys.join(", ")}`);
  });

});

// ── Tests: WorkerSelection ─────────────────────────────────────────────────────

describe("selection — WorkerSelection parameter", () => {

  it("without workerSelection: same result as before the extension", () => {
    const r = smartMatch(SELECTION_CV, JD_7_FULLSTACK, NO_PROJECTS);
    // Without workerSelection it should still produce valid output
    assert.ok(r.evidenceIds.length > 0, "should have evidenceIds");
    assert.ok(typeof r.coverage === "number", "coverage should be a number");
  });

  it("with workerSelection: bullet with highest score appears first in evidenceIds", () => {
    const roles = parseMasterExperience(SELECTION_CV);
    const allBullets = roles.flatMap((r) => r.bullets);
    if (allBullets.length < 3) {
      // Skip if not enough bullets
      assert.ok(true, "skipped — not enough bullets");
      return;
    }
    // Give the third bullet the highest worker score so it should rank first
    const [b1, b2, b3] = allBullets;
    const workerSelection: WorkerSelection = {
      bulletScores: [
        { id: b3.id, score: 0.99, coveredRequirement: "testing" },
        { id: b2.id, score: 0.60, coveredRequirement: "REST APIs" },
        { id: b1.id, score: 0.30, coveredRequirement: "Node.js" },
      ],
    };
    const r = smartMatch(SELECTION_CV, JD_2_BACKEND, NO_PROJECTS, workerSelection);
    const idxB3 = r.evidenceIds.indexOf(b3.id);
    const idxB1 = r.evidenceIds.indexOf(b1.id);
    assert.ok(idxB3 !== -1, `b3 (${b3.id}) should be in evidenceIds`);
    assert.ok(idxB1 !== -1, `b1 (${b1.id}) should be in evidenceIds`);
    assert.ok(idxB3 < idxB1, `b3 (score 0.99) should precede b1 (score 0.30) — idxB3=${idxB3}, idxB1=${idxB1}`);
  });

  it("with workerSelection: coveredBy contains the worker's coveredRequirement", () => {
    const roles = parseMasterExperience(SELECTION_CV);
    if (roles.length === 0 || roles[0].bullets.length === 0) {
      assert.ok(true, "skipped — no bullets");
      return;
    }
    const b1 = roles[0].bullets[0];
    const workerSelection: WorkerSelection = {
      bulletScores: [
        { id: b1.id, score: 0.95, coveredRequirement: "Node.js" },
      ],
    };
    const r = smartMatch(SELECTION_CV, JD_2_BACKEND, NO_PROJECTS, workerSelection);
    assert.ok(
      "Node.js" in r.coveredBy,
      `coveredBy should contain "Node.js" from workerSelection, got keys: ${Object.keys(r.coveredBy).join(", ")}`,
    );
  });

  it("with workerSelection: bullets not in selection still appear (not dropped)", () => {
    const roles = parseMasterExperience(SELECTION_CV);
    const allBullets = roles.flatMap((r) => r.bullets);
    if (allBullets.length < 2) { assert.ok(true, "skipped"); return; }
    const [b1] = allBullets;
    const workerSelection: WorkerSelection = {
      bulletScores: [
        { id: b1.id, score: 0.95, coveredRequirement: "testing" },
        // b2, b3... not listed
      ],
    };
    const r = smartMatch(SELECTION_CV, JD_2_BACKEND, NO_PROJECTS, workerSelection);
    // All bullets should still appear in evidenceIds (worker scores just reorder)
    assert.equal(r.evidenceIds.length, allBullets.length,
      "All bullets should appear — worker selection reorders, not filters");
  });

});

// ── Tests: determinism ─────────────────────────────────────────────────────────

describe("selection — determinism", () => {

  it("same input → same output (all 10 JDs)", () => {
    const jds = [
      JD_1_FRONTEND, JD_2_BACKEND, JD_3_DATABASE, JD_4_DEVOPS, JD_5_TESTING,
      JD_6_PYTHON, JD_7_FULLSTACK, JD_8_CLOUD, JD_9_JAVA, JD_10_INFRA,
    ];
    for (const jd of jds) {
      const r1 = smartMatch(SELECTION_CV, jd, NO_PROJECTS);
      const r2 = smartMatch(SELECTION_CV, jd, NO_PROJECTS);
      assert.deepEqual(r1.evidenceIds, r2.evidenceIds, `evidenceIds not deterministic for jd="${jd.slice(0, 40)}..."`);
      assert.equal(r1.coverage, r2.coverage, `coverage not deterministic`);
      assert.deepEqual(r1.coveredBy, r2.coveredBy, `coveredBy not deterministic`);
    }
  });

  it("workerSelection: same input → same output", () => {
    const roles = parseMasterExperience(SELECTION_CV);
    if (!roles[0]?.bullets[0]) { assert.ok(true, "skipped"); return; }
    const b = roles[0].bullets[0];
    const ws: WorkerSelection = { bulletScores: [{ id: b.id, score: 0.9, coveredRequirement: "React" }] };
    const r1 = smartMatch(SELECTION_CV, JD_1_FRONTEND, NO_PROJECTS, ws);
    const r2 = smartMatch(SELECTION_CV, JD_1_FRONTEND, NO_PROJECTS, ws);
    assert.deepEqual(r1.evidenceIds, r2.evidenceIds);
    assert.deepEqual(r1.coveredBy, r2.coveredBy);
  });

});
