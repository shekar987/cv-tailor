// The sixth fresh review of Chunk 17 (6 Nov 2026, of round five's 5a3db65): every input it
// proved wrong, pinned. The rule this round: where a guard can't be sure, it leans the safe
// way — a suggestion is held (it only moves to "Needs your evidence"), a placement sentence
// is flagged (never removed), and the applied-for clause is left as written.
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
const L = "Built a ride booking app in React and TypeScript";
const cvWith = (header: string) => `EXPERIENCE
${header}
• Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users
• Built a Kafka pipeline for payment events

PROJECTS
Ride App | 2024
• ${L}

SKILLS
Python, FastAPI, Kafka, Docker, React`;
const CV = cvWith("Software Engineer | Northgate Systems | Jul 2022 – Sep 2024");
const ctx = (cv = CV) => ({ sources: [cv], absentTerms: ["Kubernetes", "Terraform"] });
const kept = (s: string, cv = CV) => checkSuggestions([s], ctx(cv)).kept.length === 1;

test("suggestions: telling the user to put an absent posting term in is the suggestion's own claim", () => {
  for (const s of [
    `The posting asks for "Kubernetes"; put it in your Technical Tools line.`,
    `The JD asks for "Terraform"; mention it in your summary.`,
    `The posting asks for "Kubernetes"; add this to your skills.`,
    `The posting asks for "Kubernetes"; name it in your summary.`,
    `The posting asks for "Kubernetes"; use it in your first bullet.`,
    `The posting asks for "Kubernetes"; add it to Technical Tools instead of Docker.`,
  ]) assert.equal(kept(s), false, s);
  // Round five's honest ones stay kept.
  for (const s of [
    `The posting asks for "Kubernetes", which your CV doesn't show; put your Docker work first instead, since it is the nearest real evidence.`,
    `The role asks for "Kubernetes"; mention that your Docker services ran in containers in production.`,
  ]) assert.equal(kept(s), true, s);
});

test("suggestions: a purpose stops at the next instruction, so the destination after it still counts", () => {
  for (const s of [
    `Rewrite "${L}" so it leads with React, then move it into your Northgate Systems role.`,
    `Move "${L}" to highlight React, ideally under your Northgate Systems role.`,
    `Move "${L}" up since React leads the posting, and add it to your Northgate Systems role too.`,
  ]) assert.equal(kept(s), false, s);
  assert.equal(kept(`Put "${L}" first in your Ride App project to show React, which is central to the role.`), true);
});

test("suggestions: an invented unquoted line is a line: after use:, beside role-based or a JD parser, opening with Split", () => {
  for (const s of [
    "Use: Built a Kafka pipeline for the booking platform serving 2,000 daily users across Europe",
    "Change the auth bullet to: Built the role-based access control layer in FastAPI for the booking platform",
    "Add: Built a JD parser in FastAPI for the booking platform",
    "Rewrite the first bullet as: Split the FastAPI booking platform into Kafka-driven payment services",
  ]) assert.equal(kept(s), false, s);
});

test("suggestions: a job title or a label is no employer, and a destination turned away is no destination", () => {
  const analyst = cvWith("Technical Analyst | Northgate Systems | Jul 2022 – Sep 2024");
  assert.equal(kept(`Your Ride App project shows React ("${L}"); add React to Technical Tools so it is searchable.`, analyst), true);
  const coordinator = cvWith("Projects Coordinator | Northgate Systems | Jul 2022 – Sep 2024");
  assert.equal(kept(`Move "${L}" to the top under Projects.`, coordinator), true);
  for (const s of [`Do not move "${L}" into Experience; it is a personal project, so keep it under Projects.`, `Keep "${L}" under your Ride App project rather than to employment history.`]) {
    assert.equal(kept(s), true, s);
  }
  // Still held: the employer named in any header shape.
  for (const header of ["Northgate Systems | Software Engineer | Jul 2022 – Sep 2024", "Software Engineer at Northgate Systems, Jul 2022 – Sep 2024"]) {
    assert.equal(kept(`Move "${L}" under Northgate Systems to show React in paid work.`, cvWith(header)), false, header);
  }
});

test("placement guard: a role whose dates are only in brackets is dated", () => {
  const intern = "EXPERIENCE\nSoftware Engineering Intern, Acme Ltd (Jun 2025 – Aug 2025)";
  const s = "I am currently on a software engineering internship at Acme.";
  assert.deepEqual(g(s, intern).removed, [s]);
  const longer = "I am currently on a software engineering internship at Acme, where I build Python tools.";
  assert.deepEqual(g(longer, intern).flagged, [longer]);
  const placement = "EXPERIENCE\nIndustrial Placement – Example Lab (Jul 2025 – Present)";
  assert.deepEqual(g("I recently completed my industrial placement at Example Lab.", placement).removed, ["I recently completed my industrial placement at Example Lab."]);
});

test("placement guard: on an Education-first CV, any heading that names no institution or course part ends Education", () => {
  for (const heading of ["PROFESSIONAL BACKGROUND", "RELEVANT ROLES", "POSITIONS OF RESPONSIBILITY", "TECHNICAL EXPERTISE", "INDUSTRY", "Work Experience"]) {
    const master = `EDUCATION\nBSc Computer Science | University of Leeds | 2022 – 2026\n\n${heading}\nSoftware Engineer (Placement) | Example Lab | Jul 2025 – Present`;
    const s = "I recently completed my software engineering placement at Example Lab.";
    assert.deepEqual(g(s, master).removed, [s], heading);
  }
  // A university name or a modules line is still Education.
  const bath = "EXPERIENCE\nSoftware Engineer – Industrial Placement\nExample Lab, London\nJul 2024 – Jun 2025\n\nEDUCATION\nUNIVERSITY OF BATH\nComputer Science with Industrial Placement Year, Sep 2022 – Jun 2027";
  assert.deepEqual(g("I completed my industrial placement at Example Lab.", bath).flagged, []);
});

test("placement guard: real intent is not flagged; a past fact still is", () => {
  for (const s of [
    "I am seeking a 12-month role for my placement year, starting in July 2027.",
    "I would welcome the chance to spend my placement year at Acme.",
    "During my placement year I would like to work on data platforms.",
    "This role would be an ideal fit for my placement year.",
  ]) assert.deepEqual(g(s, NONE), { text: s, removed: [], flagged: [] }, s);
  for (const s of [
    "I am keen to bring the Python skills I built during my industrial placement at Example Lab.",
    "I became interested in distributed systems during my placement at Example Lab.",
    "I will bring the same rigour I showed during my industrial placement at Example Lab.",
    "Since joining Example Lab on my placement year, I have built three dashboards.",
    "I am applying for this role after my placement at Example Lab.",
  ]) assert.deepEqual(g(s, NONE).flagged, [s], s);
});

test("gap read: title-case posting terms are uses of a product the CV shows, not product names", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Ran services on AWS EC2 with Bash scripts on Linux\n• Built data pipelines in Python and SQL on PostgreSQL with scikit-learn models\n\nSKILLS\nAWS, EC2, Bash, Linux, Python, SQL, PostgreSQL, scikit-learn";
  const terms = ["AWS EC2 Instances", "Bash Shell", "SQL Relational Databases", "AWS Cloud Computing", "Linux Shell Scripting", "Python Coding Standards", "Python data processing for Finance teams"];
  const { askModel } = classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: terms, top_15_ats_keywords: [] }, cv, "", null), cv, "");
  for (const t of terms) assert.ok(askModel.includes(t), t);
  // Real two-word products stay named.
  const named = ["Docker Swarm orchestration", "Spark Streaming", "Salesforce Apex", "Azure Data Factory"];
  const cv2 = cv + "\nDocker, Spark, Salesforce, Azure";
  const r2 = classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: named, top_15_ats_keywords: [] }, cv2, "", null), cv2, "");
  for (const t of named) assert.equal(r2.askModel.includes(t), false, t);
});

test("applied-for strip: never a fragment, never true text dropped", () => {
  assert.equal(stripAppliedFor("Graduate engineer at Rolls-Royce plc. Built test rigs in C. Software engineer applying for the Embedded Engineer role.").text, "Graduate engineer at Rolls-Royce plc. Built test rigs in C.");
  assert.equal(stripAppliedFor("Uses R. Applying for the Data Scientist role.").text, "Uses R. Applying for the Data Scientist role.", "a short remainder that is not an opener: left as written");
  assert.equal(stripAppliedFor("Data analyst at J. Sainsbury, applying for the Data Engineer role.").text, "Data analyst at J. Sainsbury.");
});
