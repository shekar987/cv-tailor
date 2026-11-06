// The second fresh review of Chunk 17 (6 Nov 2026), on the first round of review
// fixes: every input it proved wrong, pinned. Made-up CVs and postings throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAppliedFor } from "../src/lib/roleTitle.ts";
import { guardRoleStatus } from "../src/lib/factGuard.ts";
import { classifyByRules, gapFor, type GapCheck, type GapItem } from "../src/lib/gapCheck.ts";
import { buildEvidenceMap } from "../src/lib/evidenceMap.ts";
import { checkSuggestions } from "../src/lib/suggestionCheck.ts";
import { programmeEnd, triageJd } from "../src/lib/triage/jdTriage.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const RENAMED = "EXPERIENCE\nFull-Stack & AI Engineer | Example Lab | Jul 2025 – Present";
const NONE = "EXPERIENCE\nSoftware Engineer | Acme | 2022 – Present";
const guard = (text: string, master: string) => guardRoleStatus(text, master, { now: NOW }).text;
const same = (s: string) => stripAppliedFor(s).text === s;

test("applied-for: the employer goes with the clause, in any form, and never the candidate's facts", () => {
  for (const tail of ["at the BBC", "at the Bank of England", "at monday.com", "with Acme Bank", "in the payments team", "in fintech"]) {
    assert.equal(stripAppliedFor(`Python developer with two years of FastAPI work, applying for the Software Engineer role ${tail}.`).text, "Python developer with two years of FastAPI work.", tail);
  }
  assert.ok(same("Python developer with FastAPI APIs, applying to Monzo, with a 12-month industrial placement at Example Lab."));
  assert.ok(same("Computer Science student, applying to Acme's graduate intake, with a summer internship at Example Lab."));
  assert.ok(same("Full-stack developer, applying for the Software Engineer opening at Acme, with a 12-month industrial placement at Example Lab."));
  assert.ok(same("Software developer applying for the Product Engineer role in London with two years' Python."), "a run-on place is left, never handed to the candidate");
  assert.equal(stripAppliedFor("Python developer with FastAPI APIs, applying for the Technology Graduate Programme 2027.").text, "Python developer with FastAPI APIs.");
});

test("placement guard: intent phrases, degree dates, relative clauses, openers, the NHS, other people", () => {
  for (const s of [
    "I am interested in spending my placement year at Acme because of its payments work.",
    "I am particularly interested in this role because it offers my placement year in regulated fintech.",
    "This is the opportunity to do my placement year in a data team.",
    "I plan to do my placement year in a data team.",
  ]) assert.equal(guard(s, NONE), s, s);
  const sandwich = "EDUCATION\nBSc Computer Science with Industrial Placement | University of Leeds | Sep 2022 – Jun 2027\n\nEXPERIENCE\nSoftware Engineer (Placement) | Example Lab | Jul 2024 – Jun 2025";
  const done = "I completed a 12-month industrial placement at Example Lab in 2025, where I built ETL pipelines in Python.";
  assert.equal(guard(done, sandwich), done, "the degree's end date is not the placement's");
  assert.equal(guard("Software engineer currently on an industrial placement at Example Lab, where I build ETL pipelines in Python.", RENAMED), "");
  assert.equal(guard("Software engineer currently on an industrial placement at Example Lab, during which I shipped 14 releases.", RENAMED), "");
  assert.equal(guard("During my placement year at Example Lab, I built ETL pipelines in Python.", RENAMED), "I built ETL pipelines in Python.");
  assert.equal(guard("During my internship at Example Lab and later at Acme, I built ETL pipelines in Python.", RENAMED), "");
  assert.equal(guard("During my placement at Example Lab Python was my main language.", RENAMED), "");
  assert.equal(guard("I built ETL pipelines in Python for 40 hospitals, and I am currently on a placement at the NHS.", RENAMED), "I built ETL pipelines in Python for 40 hospitals.");
  assert.equal(guard("Software engineer currently on a placement at the NHS, building ETL pipelines in Python.", RENAMED), "Software engineer, building ETL pipelines in Python.");
  assert.equal(guard("I mentored two students on placement at Example Lab.", RENAMED), "I mentored two students on placement at Example Lab.");
});

test("suggestions: posting quotes only when the posting is the subject; moves only into a role; every word traced", () => {
  const cv = `EXPERIENCE
Software Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users
• Built a Kafka pipeline for payment events
• Optimized API latency by 40% with Redis caching

PROJECTS
Ride App | 2024
• Built a ride booking app in React and TypeScript

SKILLS
Python, FastAPI, HTTP, Kafka

Currently learning: Kubernetes`;
  const registry = { version: 1, skills: [{ name: "Kubernetes", level: "learning", evidence: "" }], confirmedAt: null } as never;
  const ctx = { sources: [cv], absentTerms: ["HTTP", "Kubernetes", "FastAPI"], registry };
  for (const s of [
    `The JD asks for Kafka; add: "Scaled the Kafka pipeline to 1M events a day with zero downtime"`,
    `Update your skills list to read "Python, FastAPI, HTTP, Kafka, Kubernetes"`,
    `Change the first bullet to: "Led REST API endpoints in FastAPI for the booking platform serving 2,000 daily users"`,
    "Add: Led the migration of REST API endpoints in FastAPI for the booking platform.",
    "Rewrite the booking bullet as Led the HTTP migration of REST API endpoints in FastAPI.",
  ]) assert.deepEqual(checkSuggestions([s], ctx).kept, [], s);
  for (const s of [
    `Put "Built a ride booking app in React and TypeScript" at the top of your Projects section to show React experience.`,
    `Add "Built a ride booking app in React and TypeScript" in your summary to show React experience.`,
    `Move "Optimised API latency by 40% with Redis caching" to the top of your Northgate Systems role.`,
    "Move Python to the front: it is the posting's first term.",
    "Add Python to Technical Tools line first.",
  ]) assert.deepEqual(checkSuggestions([s], ctx).kept, [s], s);
});

test("programme rule: weeks reach further for the Review, and the head noun or a modifier names the programme", () => {
  const intern = "Our 10-week summer internship starts in June 2027.\nYou must have the right to work in the UK for the full duration of the internship, without requiring visa sponsorship.";
  assert.equal(triageJd(intern, { rightToWork: "time_limited", permissionEnds: "2027-07" }).verdict, "review", "it runs into August");
  const place = "Our 12-month placement programme starts in July 2027.\nYou must have the right to work in the UK for the full duration of the placement programme, without requiring visa sponsorship.";
  assert.ok(triageJd(place, { rightToWork: "time_limited", permissionEnds: "2028-01" }).hits.some((h) => h.rule === "rtw_programme" && h.level === "skip"));
  const appr = "This 24-month apprenticeship programme starts in September 2027.\nYou must have the right to work in the UK for the full duration of the apprenticeship, without requiring visa sponsorship.";
  assert.ok(triageJd(appr, { rightToWork: "time_limited", permissionEnds: "2028-01" }).hits.some((h) => h.rule === "rtw_programme" && h.level === "skip"));
  assert.equal(programmeEnd(appr, "apprenticeship")?.months, 24);
});

test("gap read: a practice around a product the CV shows is asked; a shorter miss maps back only when the CV lacks it", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Wrote Python scripts that automated release checks for three services\n• Deployed services on AWS S3\n\nSKILLS\nPython, PostgreSQL, AWS";
  const { askModel } = classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: ["Python test automation", "Kubernetes clusters", "DNS"], top_15_ats_keywords: [] }, cv, "", null), cv, "");
  assert.deepEqual(askModel, ["Python test automation"]);
  const item = (term: string): GapItem => ({ term, importance: "required", kind: "technical", class: "core", line: null, where: null, via: null, learning: false, checked: true });
  const check: GapCheck = { items: [item("Kubernetes clusters"), item("AWS Lambda")], model: "ok" };
  assert.equal(gapFor(check, "Kubernetes — not present in the tailored text", cv)?.term, "Kubernetes clusters");
  assert.equal(gapFor(check, "AWS — not present in the tailored text", cv), null);
});
