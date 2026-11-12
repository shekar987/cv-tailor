// The fifth fresh review of Chunk 17 (6 Nov 2026): every input it proved wrong,
// pinned, under the detect-and-flag contract (a guard acts only where the shape is
// unambiguous; otherwise the text stays exactly as written and is flagged).
// Made-up CVs and postings throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAppliedFor } from "../src/lib/roleTitle.ts";
import { guardRoleStatus } from "../src/lib/factGuard.ts";
import { classifyByRules } from "../src/lib/gapCheck.ts";
import { buildEvidenceMap } from "../src/lib/evidenceMap.ts";
import { checkSuggestions } from "../src/lib/suggestionCheck.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const NONE = "EXPERIENCE\nSoftware Engineer | Acme | 2022 – Present";
const g = (s: string, master: string) => guardRoleStatus(s, master, { now: NOW });
const askOf = (terms: string[], cv: string) =>
  classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: terms, top_15_ats_keywords: [] }, cv, "", null), cv, "").askModel;

test("gap read: 'query' is a use of SQL, not the second word of a product", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Optimised slow PostgreSQL queries, cutting p95 latency by 40%\n\nSKILLS\nSQL, PostgreSQL, Python";
  const ask = askOf(["SQL query optimisation", "SQL query tuning", "PostgreSQL query performance"], cv);
  assert.deepEqual(ask, ["SQL query optimisation", "SQL query tuning", "PostgreSQL query performance"]);
});

test("gap read: a product's own second word is part of its name, in any case", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Containerised services with Docker and deployed them on Linux servers\n• Built React front ends and Python services on Azure with Spark jobs\n\nSKILLS\nDocker, Linux, Databricks, Azure, Spark, Salesforce, GitHub, React, Python";
  const terms = ["Docker Swarm", "Linux kernel", "Databricks Unity Catalog", "Azure Data Factory", "Spark Streaming", "Salesforce Apex", "GitHub Copilot", "React Server Components", "Python asyncio", "Docker Swarm orchestration"];
  assert.deepEqual(askOf(terms, cv), []);
  // …while a product with plain words around it is still asked, whatever the capitals.
  assert.deepEqual(askOf(["AWS cloud", "Python Test Automation", "React Front-End", "Django Web Framework"], cv + "\nAWS, Django"), ["AWS cloud", "Python Test Automation", "React Front-End", "Django Web Framework"]);
});

test("placement guard: Education runs to the next SECTION heading, past a university name or a modules line", () => {
  const split = "EXPERIENCE\nSoftware Engineer – Industrial Placement\nExample Lab, London\nJul 2024 – Jun 2025\n\nEDUCATION\nUNIVERSITY OF BATH\nComputer Science with Industrial Placement Year, Sep 2022 – Jun 2027";
  const modules = "EXPERIENCE\nSoftware Engineer – Industrial Placement\nExample Lab, London\nJul 2024 – Jun 2025\n\nEDUCATION\nRelevant modules:\nComputer Science with a Placement Year (BSc Hons), 2022 – 2027";
  for (const master of [split, modules]) {
    for (const s of ["I completed my industrial placement at Example Lab.", "I completed my industrial placement at Example Lab in 2025."]) {
      assert.deepEqual(g(s, master), { text: s, removed: [], flagged: [] }, `${s} / ${master.slice(-40)}`);
    }
  }
});

test("placement guard: a role named in a dated note is dated by the note", () => {
  const master = "EXPERIENCE\nSoftware Engineer | Acme | Sep 2025 – Present (joined after my summer internship, Jun – Aug 2024)";
  const s = "I completed a summer internship at Acme.";
  assert.deepEqual(g(s, master), { text: s, removed: [], flagged: [] });
  // A bracket with no date leaves the line's own dates in charge.
  const current = "EXPERIENCE\nSoftware Engineer (Industrial Placement) | Example Lab | Jul 2025 – Present";
  assert.deepEqual(g("I recently completed my industrial placement at Example Lab.", current).removed, ["I recently completed my industrial placement at Example Lab."]);
});

test("placement guard: an initial before a name never ends a sentence, so no fragment is left", () => {
  const master = "EXPERIENCE\nData Analyst Intern | J. Sainsbury | Sep 2025 – Present";
  const s = "I completed my internship at J. Sainsbury in the pricing team.";
  assert.deepEqual(g(s, master), { text: s, removed: [], flagged: [s] });
  const pure = g("I recently completed my internship at J. Sainsbury.", master);
  assert.ok(pure.text === "" || pure.text === "I recently completed my internship at J. Sainsbury.", pure.text);
  assert.equal(pure.removed.length + pure.flagged.length, 1);
  // "in R. I recently …" still ends a sentence.
  assert.equal(g("I built models in R. I enjoy statistics.", master).text, "I built models in R. I enjoy statistics.");
});

test("placement guard: only an intent that governs the claim exempts it", () => {
  for (const s of [
    "I wrote test plans on my placement at Example Lab.",
    "I ran sprint planning on my internship at Acme.",
    "During my internship at Acme my aim was to ship one feature a week.",
    "I am keen to bring the Python skills I built during my industrial placement at Example Lab.",
    "I became interested in distributed systems during my placement at Example Lab.",
    "I will bring the same rigour I showed during my industrial placement at Example Lab.",
    "Since joining Example Lab on my placement year, I have built three dashboards.",
    "During my placement at Example Lab I would pair with senior engineers on code reviews.",
  ]) {
    const r = g(s, NONE);
    assert.equal(r.text, s, s);
    assert.deepEqual(r.flagged, [s], s);
  }
  for (const s of ["I am keen to spend my placement year at a fintech such as yours.", "I am planning on doing my placement year in 2027.", "I hope to complete my internship at a company like yours."]) {
    assert.deepEqual(g(s, NONE), { text: s, removed: [], flagged: [] }, s);
  }
});

test("applied-for strip: abbreviations and initials stay inside their sentence; a stop is never doubled", () => {
  const cases: [string, string][] = [
    ["Frontend developer skilled in modern frameworks, e.g. React, applying for the Frontend Engineer role.", "Frontend developer skilled in modern frameworks, e.g. React."],
    ["Research assistant to Dr. Patel, applying for the Data Engineer role.", "Research assistant to Dr. Patel."],
    ["Data analyst at J. Sainsbury, applying for the Data Engineer role.", "Data analyst at J. Sainsbury."],
    ["Software engineer at Example Lab Ltd., applying for the Backend Engineer role.", "Software engineer at Example Lab Ltd."],
    ["Python developer at Acme Inc., applying for the Backend Engineer role.", "Python developer at Acme Inc."],
    ["Python developer with Docker, AWS etc., applying for the Backend Engineer role.", "Python developer with Docker, AWS etc."],
  ];
  for (const [s, want] of cases) assert.equal(stripAppliedFor(s).text, want, s);
});

test("applied-for strip: someone else applying is never the candidate", () => {
  for (const s of ["Built Jobhuntz, a CV tool for any software engineer applying for graduate roles.", "Mentored a first-year student applying for summer internships."]) {
    assert.deepEqual(stripAppliedFor(s), { text: s, removed: [] }, s);
  }
});

const PROJECT_LINE = "Built a ride booking app in React and TypeScript";
const cvWith = (header: string) => `EXPERIENCE
${header}
• Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users
• Built a Kafka pipeline for payment events

PROJECTS
Ride App | 2024
• ${PROJECT_LINE}

SKILLS
Python, FastAPI, Kafka, Docker, React`;
const CV = cvWith("Software Engineer | Northgate Systems | Jul 2022 – Sep 2024");
const ctxOf = (cv: string) => ({ sources: [cv], absentTerms: ["Kubernetes", "Terraform"] });

test("suggestions: a project line moved under an employer is held, whatever shape the employer's header has", () => {
  for (const header of ["Northgate Systems | Software Engineer | Jul 2022 – Sep 2024", "Northgate Systems — Software Engineer — Jul 2022 – Sep 2024", "Software Engineer at Northgate Systems, Jul 2022 – Sep 2024"]) {
    const s = `Move "${PROJECT_LINE}" under Northgate Systems to show React in paid work.`;
    assert.deepEqual(checkSuggestions([s], ctxOf(cvWith(header))).kept, [], header);
  }
});

test("suggestions: a section is a paid-work destination with or without an article", () => {
  for (const s of [`Move "${PROJECT_LINE}" under Experience to show React in paid work.`, `Copy "${PROJECT_LINE}" into work experience so React shows as paid work.`]) {
    assert.deepEqual(checkSuggestions([s], ctxOf(CV)).kept, [], s);
  }
});

test("suggestions: a reason is never a destination", () => {
  for (const s of [
    `Put "${PROJECT_LINE}" first in your Ride App project to show React, which is central to the role.`,
    `Move "${PROJECT_LINE}" to the top of your Ride App project to highlight React, the main skill in the job.`,
    `Put "${PROJECT_LINE}" first in your Ride App project because React is named in the job description.`,
    `Move "${PROJECT_LINE}" higher in your Ride App project, since React is in the job ad.`,
  ]) assert.deepEqual(checkSuggestions([s], ctxOf(CV)).kept, [s], s);
});

test("suggestions: a posting term is the suggestion's own only when the add verb's object is the term", () => {
  for (const s of [
    `The posting asks for "Kubernetes", which your CV doesn't show; put your Docker work first instead, since it is the nearest real evidence.`,
    `The role asks for "Kubernetes"; mention that your Docker services ran in containers in production.`,
  ]) assert.deepEqual(checkSuggestions([s], ctxOf(CV)).kept, [s], s);
});

test("suggestions: after a label only a capital starts a proposed line, and advice is never a line", () => {
  for (const s of [
    "Summary: the first sentence should name Kafka, which the posting lists as required.",
    "Kafka bullet: the posting asks for event-driven design twice, so move it to the top of the role.",
    "Summary line: tighten the opening so the Kafka pipeline comes first.",
    "Summary: Tighten the opening so the Kafka pipeline comes first.",
  ]) assert.deepEqual(checkSuggestions([s], ctxOf(CV)).kept, [s], s);
});
