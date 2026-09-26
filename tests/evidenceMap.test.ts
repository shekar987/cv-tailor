// Unit tests for the requirement → evidence map (lib/evidenceMap).
// node:test, zero dependencies: `npm test`. Every CV here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceMap,
  renderEvidenceBlock,
  graftRules,
  isNamedTechnology,
  kindOf,
  projectLines,
  poolCoverageBlock,
  roleLabel,
  evidenceCounts,
  normalizeEvidenceMap,
  requirementParts,
} from "../src/lib/evidenceMap.ts";
import type { ClaimsRegistry } from "../src/lib/claims.ts";

const CV = `ALEX EXAMPLE
Backend Engineer

EDUCATION
BSc Computer Science — Example University · Sep 2019 – Jul 2023

EXPERIENCE
Backend Engineer — Northwind Labs
Jul 2023 – Present
- Built REST services in Python and FastAPI, cutting response times by 25%
- Optimised PostgreSQL and MySQL queries with indexing and caching, improving read times by 30%

PROJECTS
Ledgerly — Event-Driven Billing · 2025
AWS Lambda, SQS, Terraform
- Built an event-driven billing pipeline on AWS Lambda and SQS with 120 unit tests
- Provisioned the infrastructure with Terraform

ADDITIONAL INFORMATION
Technical Skills: Python, FastAPI, PostgreSQL, MySQL, Docker
Certifications: AWS Certified Cloud Practitioner`;

const POOL = `Tracksy — Real-Time Tracking (GitHub)
React 19, TypeScript, Firebase
2024
• Built live location tracking with Firebase listeners, sub-second updates
across 3 client apps, covered by 60 Jest tests.

Notewise
2023
Natural-language search over lecture notes — without made-up answers
Python, pandas
Parses PDFs into structured notes for search.`;

const REGISTRY: ClaimsRegistry = {
  version: 1,
  confirmedAt: "2026-09-19T00:00:00Z",
  seededFrom: null,
  skills: [
    { name: "Python", level: "production", confirmed: true },
    { name: "AWS Lambda", level: "project", confirmed: true },
    { name: "Kafka", level: "learning", confirmed: true },
  ],
};

const ANALYSIS = {
  role_title: "Software Engineer, New Grad",
  required_skills: ["Python", "Relational databases", "AWS Lambda", "Go", "Ruby/Rails", "Kafka", "Communication skills", "Computer Science degree"],
  nice_to_have_skills: ["Terraform", "Docker"],
  top_15_ats_keywords: ["Software Engineer", "Ruby", "Microservices", "Testing", "Insurance pricing", "Proof of value"],
};

test("every requirement is placed: paid work, project only, listed, learning, or absent", () => {
  const map = buildEvidenceMap(ANALYSIS, CV, POOL, REGISTRY);
  const by = Object.fromEntries(map.items.map((i) => [i.term, i]));
  assert.equal(by["Python"].status, "experience");
  assert.equal(by["Python"].where, "Backend Engineer, Northwind Labs");
  assert.match(by["Python"].evidence ?? "", /REST services in Python and FastAPI/);
  // "SQL work" implied exactly by PostgreSQL/MySQL.
  assert.equal(by["Relational databases"].status, "experience");
  // A project-level registry entry caps the level, and the evidence is the project.
  assert.equal(by["AWS Lambda"].status, "project");
  assert.equal(by["AWS Lambda"].where, "Ledgerly");
  assert.equal(by["Go"].status, "gap");
  assert.equal(by["Kafka"].status, "learning");
  assert.equal(by["Computer Science degree"].status, "listed");
  assert.equal(by["Computer Science degree"].kind, "qualification");
  assert.equal(by["Communication skills"].status, "gap");
  assert.equal(by["Communication skills"].kind, "soft");
  assert.equal(by["Terraform"].status, "project");
  assert.equal(by["Docker"].status, "listed");
  assert.equal(by["Insurance pricing"].kind, "domain");
  assert.equal(by["Testing"].status, "project"); // 120 unit tests / 60 Jest tests
});

test("the posting's own title is not a requirement, and a covered term is not repeated", () => {
  const map = buildEvidenceMap(ANALYSIS, CV, POOL, REGISTRY);
  const terms = map.items.map((i) => i.term);
  assert.ok(!terms.includes("Software Engineer"), "the role title is skipped");
  assert.ok(!terms.includes("Ruby"), "Ruby is covered by Ruby/Rails");
  assert.equal(evidenceCounts(map).gap, 3); // Go, Ruby/Rails, Communication skills
});

test("a compound requirement is placed part by part; an 'or' list and a qualified phrase stay whole", () => {
  // The owner's Somak and Base360 postings (26 Sep): read whole, each of these was a gap.
  const map = buildEvidenceMap(
    {
      role_title: "Software Developer",
      required_skills: [
        "Relational databases and SQL",
        "API development and system integrations",
        "PostgreSQL and database design",
        "Full-stack development across frontend and backend systems",
        "PHP or Python",
        "Experience identifying and implementing automation opportunities",
        "Business process understanding and commercial thinking",
      ],
    },
    CV.replace("Backend Engineer — Northwind Labs", "Full Stack Engineer — Northwind Labs"),
    "",
    REGISTRY
  );
  const by = Object.fromEntries(map.items.map((i) => [i.term, i.status]));
  assert.equal(by["Relational databases"], "experience");
  assert.equal(by["SQL"], "experience");
  assert.equal(by["API development"], "experience", "REST services in FastAPI are API development");
  assert.equal(by["system integrations"], "gap");
  assert.equal(by["PostgreSQL"], "experience");
  assert.equal(by["database design"], "gap");
  assert.equal(by["Full-stack development"], "experience", "the job title shows it");
  assert.equal(by["PHP or Python"], "experience");
  assert.equal(by["identifying and implementing automation opportunities"], "gap", "coordinated verbs stay one phrase");
  assert.equal(by["commercial thinking"], "gap", "a meaningful adjective is kept");
  assert.deepEqual(requirementParts("AWS, GCP or Azure"), ["AWS, GCP or Azure"]);
  assert.deepEqual(requirementParts("Strong commercial experience with React and TypeScript"), ["React", "TypeScript"]);
});

test("a registered skill is never read through a longer registered name that contains it", () => {
  const registry: ClaimsRegistry = {
    ...REGISTRY,
    skills: [
      { name: "React", level: "production", confirmed: true },
      { name: "React Testing Library", level: "project", confirmed: true },
      { name: "AWS", level: "production", confirmed: true },
      { name: "AWS Lambda", level: "project", confirmed: true },
      { name: "OpenAI API", level: "project", confirmed: true },
    ],
  };
  const cv = CV.replace("Built REST services in Python and FastAPI", "Built React interfaces and REST services in Python and FastAPI");
  const map = buildEvidenceMap({ required_skills: ["React and TypeScript", "AWS", "APIs", "Lambda"] }, cv, POOL, registry);
  const by = Object.fromEntries(map.items.map((i) => [i.term, i.status]));
  assert.equal(by["React"], "experience", "not the project-level React Testing Library");
  assert.equal(by["AWS"], "listed", "production in the registry, named on the skills line — never a project rule");
  assert.equal(by["APIs"], "experience", "not the project-level OpenAI API");
  assert.equal(by["Lambda"], "project", "the one registered name containing it");
  // No rule for React, AWS or APIs; TypeScript is only in the Tracksy project.
  assert.deepEqual(graftRules(map).map((r) => `${r.term}:${r.status}`).sort(), ["Lambda:project", "TypeScript:project"]);
});

test("a certificate naming AWS is not evidence of AWS Lambda work", () => {
  const cvNoProject = CV.replace(/PROJECTS[\s\S]*?ADDITIONAL/, "ADDITIONAL");
  const map = buildEvidenceMap({ required_skills: ["AWS Lambda"] }, cvNoProject, "", null);
  assert.equal(map.items[0].status, "gap");
});

test("graft rules block named technologies and methods only", () => {
  const map = buildEvidenceMap(ANALYSIS, CV, POOL, REGISTRY);
  const rules = graftRules(map);
  assert.deepEqual(
    rules.map((r) => `${r.term}:${r.status}`).sort(),
    ["AWS Lambda:project", "Go:gap", "Microservices:gap", "Ruby/Rails:gap", "Terraform:project"].sort()
  );
  assert.equal(isNamedTechnology("Proof of value"), false);
  assert.equal(isNamedTechnology("Code quality"), false);
  assert.equal(isNamedTechnology("Predictive modelling"), true);
  assert.equal(isNamedTechnology("Brossa (domain-specific functional programming language)"), true);
  assert.equal(isNamedTechnology("Infrastructure"), false);
  assert.equal(kindOf("Interpersonal and communication skills"), "soft");
  assert.equal(kindOf("Actuarial"), "domain");
});

test("pool projects: wrapped bullets join, subtitles and years are skipped", () => {
  const lines = projectLines(POOL);
  const tracksy = lines.filter((l) => l.where === "Tracksy");
  assert.equal(tracksy.length, 2); // tech line + one joined bullet
  assert.match(tracksy[1].text, /sub-second updates across 3 client apps, covered by 60 Jest tests\.$/);
  assert.ok(lines.every((l) => l.where === "Tracksy" || l.where === "Notewise"));
  assert.ok(!lines.some((l) => /^2024$|^2023$/.test(l.text)));
});

test("role labels drop dates and locations", () => {
  assert.equal(roleLabel("Backend Engineer — Northwind Labs | Jul 2023 – Present"), "Backend Engineer, Northwind Labs");
  assert.equal(roleLabel("Research Assistant — AI | Example University — Lab · London, UK · Jun 2026 – Present"), "Research Assistant, Example University");
  assert.equal(roleLabel("Platform Engineer | Acme | 2022 – Present"), "Platform Engineer, Acme");
});

test("the prompt block states what may and may not be claimed", () => {
  const block = renderEvidenceBlock(buildEvidenceMap(ANALYSIS, CV, POOL, REGISTRY));
  assert.match(block, /PAID WORK SHOWS IT[^\n]*Python \(required\) — Backend Engineer, Northwind Labs/);
  assert.match(block, /ONLY A PERSONAL PROJECT SHOWS IT[^\n]*AWS Lambda/);
  assert.match(block, /NO EVIDENCE IN THE MASTER CV[^\n]*Go/);
  assert.match(block, /STILL BEING LEARNT[^\n]*Kafka/);
  assert.match(block, /NOT SHOWN IN WORDS[^\n]*Communication skills/);
  assert.equal(renderEvidenceBlock(null), "");
});

test("pool coverage names what each project's own text shows", () => {
  const map = buildEvidenceMap(ANALYSIS, CV, POOL, REGISTRY);
  const block = poolCoverageBlock(POOL, map);
  assert.match(block, /Tracksy: [^\n]*Testing/);
  assert.match(block, /Notewise: [^\n]*Python/);
});

test("a map from the client is coerced before it may enter a prompt", () => {
  const m = normalizeEvidenceMap({ items: [{ term: "Go", status: "nonsense", importance: "required", kind: "technical", evidence: 5 }, { nope: 1 }] });
  assert.deepEqual(m?.items, [{ term: "Go", importance: "required", kind: "technical", status: "gap", evidence: null, where: null }]);
  assert.equal(normalizeEvidenceMap("x"), null);
});

test("a job noun from the posting's title is never a technology the CV must not name", () => {
  // Softwire (26 Sep): "Consultant" alone in the keywords blocked the summary that names the title.
  assert.equal(isNamedTechnology("Consultant"), false);
  assert.equal(isNamedTechnology("Graduate"), false);
  assert.equal(isNamedTechnology("Solutions Architect"), false);
  assert.equal(isNamedTechnology("AWS Solutions Architect"), true, "a named certification still is");
  const map = buildEvidenceMap({ role_title: "Graduate Consultant Software Engineer 2027", top_15_ats_keywords: ["Consultant", "Kubernetes"] }, CV, "", REGISTRY);
  assert.deepEqual(graftRules(map).map((r) => r.term), ["Kubernetes"]);
});

test("a skill named only on the CV's 'Currently learning' line is learning, with or without a registry", () => {
  const cv = CV.replace("Technical Skills: Python, FastAPI, PostgreSQL, MySQL, Docker", "Technical Skills: Python, FastAPI, PostgreSQL, MySQL, Docker\nCurrently learning: Kubernetes, Flink");
  const map = buildEvidenceMap({ required_skills: ["Kubernetes", "Docker"], nice_to_have_skills: ["Flink"] }, cv, "", null);
  const by = Object.fromEntries(map.items.map((i) => [i.term, i.status]));
  assert.equal(by["Kubernetes"], "learning");
  assert.equal(by["Flink"], "learning");
  assert.equal(by["Docker"], "listed");
  assert.match(renderEvidenceBlock(map), /STILL BEING LEARNT[^\n]*Kubernetes/);
});
