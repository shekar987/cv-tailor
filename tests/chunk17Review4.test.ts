// The fourth fresh review of Chunk 17 (6 Nov 2026): every input it proved wrong,
// pinned, under the contract that ended the regressions — a guard acts only where
// the shape is unambiguous and otherwise leaves the text as written (and flags it).
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
const CURRENT = "EXPERIENCE\nSoftware Engineer (Industrial Placement) | Example Lab | Jul 2025 – Present";
const g = (s: string, master: string) => guardRoleStatus(s, master, { now: NOW });

test("gap read: a product the CV shows plus plain words is asked about, never filed as a checked core gap", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Deployed to AWS EC2 and S3\n• Wrote JavaScript front ends with React\n• Built web applications in Python with Django\n\nSKILLS\nPython, AWS, React, Django, Git";
  const terms = ["AWS cloud", "React front-end", "Django web framework", "AWS Lambda", "React Native", "Kubernetes clusters"];
  const { askModel } = classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: terms, top_15_ats_keywords: [] }, cv, "", null), cv, "");
  assert.deepEqual(askModel, ["AWS cloud", "React front-end", "Django web framework"]);
});

test("placement guard: Education ends at the next heading of any kind", () => {
  const master = "EDUCATION\nBSc Computer Science | University of Leeds | 2022 – 2026\n\nRELEVANT EXPERIENCE\nSoftware Engineer (Industrial Placement) | Example Lab | Jul 2025 – Present";
  const s = "I recently completed my industrial placement at Example Lab, where I built ETL pipelines in Python.";
  assert.deepEqual(g(s, master).flagged, [s]);
  const ended = "EDUCATION\nBSc Computer Science | University of Leeds | 2021 – 2025\n\nWORK HISTORY\nSoftware Engineer (Placement) | Example Lab | Jul 2023 – Jun 2024";
  const now = "I am currently on a placement at Example Lab, building data tools.";
  assert.deepEqual(g(now, ended).flagged, [now]);
});

test("placement guard: planning and wanting are intent; a past verb after the claim is a tense", () => {
  for (const s of ["I am planning to spend my placement year at a fintech such as yours.", "I am planning on doing my placement year in 2027.", "During my placement year I want to build data pipelines at scale.", "During my placement year I plan to deepen my Python skills."]) {
    const r = g(s, NONE);
    assert.equal(r.text, s, s);
    assert.deepEqual(r.flagged, [], s);
  }
  for (const s of ["My industrial placement at Example Lab taught me skills I would bring to your team.", "My placement at Example Lab gave me production experience that I will bring to Monzo."]) {
    assert.deepEqual(g(s, NONE).flagged, [s], s);
  }
});

test("placement guard: a single capital ends a sentence; only the false one is touched", () => {
  const r = g("I have built statistical models in R. I recently completed my industrial placement at Example Lab.", CURRENT);
  assert.equal(r.text, "I have built statistical models in R.");
  assert.deepEqual(r.removed, ["I recently completed my industrial placement at Example Lab."]);
});

test("applied-for strip: never across a linking word, never an opening clause, never the role's facts", () => {
  for (const s of [
    "Software developer with two years' experience, applying for the Graduate Software Engineer role after completing a 12-month industrial placement at Northgate Systems.",
    "Python developer applying for the Software Engineer role after a 12-month placement at Acme.",
    "Python developer, applying for the Software Engineer role having completed a 12-month industrial placement at Acme.",
    "Python developer, applying for the Software Engineer role following a summer internship at Acme.",
    "Python developer, applying for the Software Engineer role after two years in a client-facing role at Acme.",
    "Applying for the Graduate Software Engineer role at Monzo, where I would bring two years of Python.",
    "Applying for the Backend Engineer role with two years of Python and AWS experience.",
    "Software developer applying for the Backend Engineer role with one of the UK's leading fintechs.",
    "Software engineer, applying for the role of Backend Engineer after two years building payments APIs at Monzo.",
    "Python developer, applying for the Junior role at Wise — two years of Python.",
  ]) assert.deepEqual(stripAppliedFor(s), { text: s, removed: [] }, s);
  assert.equal(stripAppliedFor("Developer with 2 years at Acme Ltd. Applying for the Backend Engineer role.").text, "Developer with 2 years at Acme Ltd.");
});

test("suggestions: a purpose first keeps its destination; an added posting term counts; a lower-case line after a colon is traced", () => {
  const cv = `EXPERIENCE
Software Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users
• Built a Kafka pipeline for payment events

Python Developer | Acme | Oct 2024 – Present
• Built Python services for the claims team

PROJECTS
Ride App | 2024
• Built a ride booking app in React and TypeScript

SKILLS
Python, FastAPI, HTTP, Kafka, PostgreSQL, React`;
  const ctx = { sources: [cv], absentTerms: ["Kubernetes", "Terraform", "Kafka"] };
  const L = "Built a ride booking app in React and TypeScript";
  for (const s of [
    `To show React experience, add "${L}" under your Northgate Systems role.`,
    `To surface TypeScript, move "${L}" into your Northgate Systems role.`,
    `The posting asks for experience with "Kubernetes"; add it to your Technical Tools line.`,
    `The posting asks for experience with "Terraform and Kubernetes"; add both to your Technical Tools line.`,
    "Change the second Northgate bullet to: built and owned the Kafka pipeline for payment events end to end with zero downtime.",
    "Rewrite the Kafka bullet to: led the Kafka pipeline for payment events across three squads.",
    "Edit the Kafka bullet → led the Kafka pipeline for payment events across three squads.",
  ]) assert.deepEqual(checkSuggestions([s], ctx).kept, [], s);
  for (const s of [
    `Put "${L}" first in your Ride App project to lead with the role's top term.`,
    `Add "${L}" to your Ride App project in your CV so your React experience is visible.`,
  ]) assert.deepEqual(checkSuggestions([s], ctx).kept, [s], s);
});
