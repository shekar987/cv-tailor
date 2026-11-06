// The third fresh review of Chunk 17 (6 Nov 2026), on the second round of fixes:
// every input it proved wrong, pinned. Made-up CVs and postings throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAppliedFor } from "../src/lib/roleTitle.ts";
import { guardRoleStatus } from "../src/lib/factGuard.ts";
import { classifyByRules } from "../src/lib/gapCheck.ts";
import { buildEvidenceMap } from "../src/lib/evidenceMap.ts";
import { checkSuggestions } from "../src/lib/suggestionCheck.ts";
import { triageJd } from "../src/lib/triage/jdTriage.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const NONE = "EXPERIENCE\nSoftware Engineer | Acme | 2022 – Present";
const CURRENT = "EXPERIENCE\nSoftware Engineer (Industrial Placement) | Example Lab | Jul 2025 – Present";
const guard = (text: string, master: string) => guardRoleStatus(text, master, { now: NOW }).text;
const strip = (s: string) => stripAppliedFor(s).text;

test("applied-for: the whole title to its last role noun, only where the clause ends; never a skill, a focus or a relative clause", () => {
  const full: [string, string][] = [
    ["Final-year Computer Science student with two years of Python, applying for the Software Engineer Internship 2027 role at Acme.", "Final-year Computer Science student with two years of Python."],
    ["Python developer with two years of FastAPI work, applying for the Technology Graduate Programme role.", "Python developer with two years of FastAPI work."],
    ["Software engineer with two years of Python, applying for the Industrial Placement Year role at Acme.", "Software engineer with two years of Python."],
    ["Software engineer with two years of Python, applying for the Software Engineering Placement Student role at Acme.", "Software engineer with two years of Python."],
    ["Computer Science graduate applying for the Junior Developer role at Acme with hands-on experience in Python and React.", "Computer Science graduate with hands-on experience in Python and React."],
    ["Python developer with two years of FastAPI work, applying for the Software Engineer role at J.P. Morgan.", "Python developer with two years of FastAPI work."],
    ["Python developer applying for the role of Software Engineer at Acme with two years of FastAPI experience.", "Python developer with two years of FastAPI experience."],
  ];
  for (const [input, want] of full) assert.equal(strip(input), want, input);
  for (const s of [
    "Graduate developer applying for the Junior Backend role with Python, FastAPI and PostgreSQL experience.",
    "Data engineer with SQL and dbt, applying for the Analytics Engineer role with Snowflake, Airflow and Looker.",
    "Graduate developer applying for the Junior Backend role with Python.",
    "Computer Science graduate applying for the Junior Developer role at Monzo with a focus on payments.",
    "Python developer with two years of FastAPI work, applying for the Software Engineer role at Acme Inc. in London.",
    "Python developer with two years of FastAPI work, applying for the Associate Software Engineer role at Acme, where REST APIs and AWS are core.",
    "Python developer, applying for the role of Software Engineer, Backend at Monzo.",
  ]) assert.equal(strip(s), s, s);
});

test("placement guard: intent before the claim exempts it; intent after only a future word on an untensed claim", () => {
  assert.equal(guard("My industrial placement at Example Lab gave me the opportunity to build ETL pipelines in Python.", NONE), "");
  assert.equal(guard("During my placement at Example Lab I had the opportunity to build ETL pipelines in Python.", NONE), "I had the opportunity to build ETL pipelines in Python.");
  assert.equal(guard("I recently completed my industrial placement at Example Lab and am interested in continuing in data engineering.", CURRENT), "");
  assert.equal(guard("I completed my placement at Example Lab and plan to build on it in a data team.", CURRENT), "");
  assert.equal(guard("During my internship I worked on sprint planning to cut cycle time by 20%.", NONE), "I worked on sprint planning to cut cycle time by 20%.");
  const hope = "During my internship I hope to learn your deployment tooling.";
  assert.equal(guard(hope, NONE), hope);
});

test("placement guard: only Education lines and lines that open with a degree are a degree's dates", () => {
  assert.equal(guard("I am currently on a placement at Example Lab, where I build ETL pipelines in Python.", "EXPERIENCE\nSoftware Engineer – Placement Year (BSc Computer Science) | Example Lab | Jul 2024 – Jun 2025"), "");
  assert.equal(guard("I am currently on a placement at UCLH, building data tools.", "EXPERIENCE\nSoftware Engineering Placement | University College London Hospitals | Jul 2024 – Jun 2025"), "");
  assert.equal(guard("As a student on placement at Example Lab, I built ETL pipelines in Python.", NONE), "I built ETL pipelines in Python.");
});

test("suggestions: a project line moved into a paid role is held however it is worded; a reason after a colon is no line", () => {
  const cv = `EXPERIENCE
Software Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users
• Built a Kafka pipeline for payment events

PROJECTS
Ride App | 2024
• Built a ride booking app in React and TypeScript

SKILLS
Python, FastAPI, HTTP, Kafka, PostgreSQL, React`;
  const ctx = { sources: [cv], absentTerms: ["HTTP", "FastAPI", "Kafka", "event-driven", "high-throughput event pipelines"] };
  const L = "Built a ride booking app in React and TypeScript";
  for (const s of [
    `Move '${L}' into your Northgate Systems role.`,
    `Move "${L}" from your Ride App project into your Northgate Systems role.`,
    `Copy "${L}" over to your Northgate Systems experience.`,
    `Add the Ride App bullet "${L}" to your Northgate Systems role.`,
  ]) {
    const r = checkSuggestions([s], ctx);
    assert.deepEqual(r.kept, [], s);
    assert.match(r.needsEvidence[0].note, /project work into a paid role/);
  }
  for (const s of [
    `Add "Kafka" to your Technical Tools line: your Northgate pipeline bullet already shows it.`,
    "Summary: lead with your FastAPI work so the posting's first term is near the top.",
    "Skills line: move PostgreSQL and FastAPI to the front.",
    "Update your Technical Tools with Kafka, which your Northgate pipeline bullet already shows.",
    "Replace React with TypeScript in your Technical Tools, since the posting asks for it.",
    `The posting asks for experience with "building and operating high-throughput event pipelines"; your Kafka pipeline bullet is the closest match.`,
  ]) assert.deepEqual(checkSuggestions([s], ctx).kept, [s], s);
});

test("gap read: two-word products, languages and named methods are never sent to the model", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Wrote Python scripts that automated release checks\n• Built serverless functions on AWS\n• Set up CI checks on GitHub\n• Built a Kafka consumer with Docker\n• Built React web apps\n• Tuned PostgreSQL queries\n\nSKILLS\nPython, AWS, GitHub, Kafka, Docker, React, PostgreSQL";
  const terms = ["AWS Lambda", "React Native", "GitHub Actions", "Docker Compose", "Kafka Streams", "AWS Step Functions", "Kafka stream processing", "AWS serverless", "Docker microservices", "Python machine learning", "AWS infrastructure as code", "Spring Boot", "Python test automation", "PostgreSQL performance tuning"];
  const { askModel } = classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: terms, top_15_ats_keywords: [] }, cv, "", null), cv, "");
  assert.deepEqual(askModel, ["Python test automation", "PostgreSQL performance tuning"]);
});

test("programme rule: 'the placement programme' reads the placement's length too", () => {
  const pp = "The 12-month placement starts in July 2027 as part of our placement programme.\nYou must have the right to work in the UK for the full duration of the placement programme, without requiring visa sponsorship.";
  assert.ok(triageJd(pp, { rightToWork: "time_limited", permissionEnds: "2028-01" }).hits.some((h) => h.rule === "rtw_programme" && h.level === "skip"));
});
