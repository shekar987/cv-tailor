// The fresh review of Chunk 17 (5 Nov 2026): every input it proved wrong, pinned.
// Made-up CVs and postings throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAppliedFor } from "../src/lib/roleTitle.ts";
import { guardRoleStatus } from "../src/lib/factGuard.ts";
import { classifyByRules, gapFor, type GapCheck } from "../src/lib/gapCheck.ts";
import { buildEvidenceMap } from "../src/lib/evidenceMap.ts";
import { checkSuggestions } from "../src/lib/suggestionCheck.ts";
import { programmeEnd, triageJd } from "../src/lib/triage/jdTriage.ts";
import { classifySeniority, seniorityFit } from "../src/lib/seniority.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const CURRENT = "EXPERIENCE\nSoftware Engineer (Industrial Placement) | Example Lab | Jul 2025 – Present";
const RENAMED = "EXPERIENCE\nFull-Stack & AI Engineer | Example Lab | Jul 2025 – Present";
const guard = (text: string, master: string, keep = false) => guardRoleStatus(text, master, { now: NOW, keep: keep ? () => true : undefined });

// Detection, not surgery (6 Nov): a sentence with true facts beside the false claim is
// never cut; it is kept as written and flagged. Only a pure claim is removed.
const flagged = (s: string, master: string) => {
  const r = guard(s, master);
  assert.equal(r.text, s, s);
  assert.deepEqual(r.flagged, [s], s);
  assert.deepEqual(r.removed, []);
};

test("the placement guard never leaves half a sentence: a mixed sentence is flagged whole", () => {
  for (const s of [
    "Software engineer with a completed industrial placement at Example Lab and two years' production experience in Python.",
    "Software engineer who has completed an industrial placement at Example Lab, with two years' production experience in Python.",
    "Last year I completed a 12-month placement at Example Lab, where I built ETL pipelines in Python.",
    "Software engineer who completed an industrial placement at Example Lab, seeking a graduate role in fintech.",
  ]) flagged(s, CURRENT);
  const letter = "1. I built the billing API.\n2. I completed a placement at Example Lab, where I built ETL pipelines.";
  assert.equal(guard(letter, CURRENT).text, letter);
  const pure = guard("1. I built the billing API.\n2. I completed a placement at Example Lab.", CURRENT);
  assert.equal(pure.text, "1. I built the billing API.", "nothing but the claim: removed");
});

test("the candidate's other facts are never lost with the claim", () => {
  flagged("During my placement at Example Lab I built ETL pipelines in Python.", RENAMED);
  flagged("Data engineer currently on an industrial placement at Example Lab building ETL pipelines in Python with Airflow.", RENAMED);
});

test("intent is read in the claim's own clause", () => {
  flagged("Having completed my industrial placement at Example Lab, I am keen to bring that experience to Acme.", CURRENT);
  flagged("During my placement I ran sprint planning for four engineers.", RENAMED);
  assert.equal(guard("I am keen to spend my placement year with your team.", RENAMED).flagged.length, 0, "intent before the claim: no claim at all");
});

test("a role whose end date is still ahead is current, and an end this year with no month decides nothing", () => {
  const future = "EXPERIENCE\nIndustrial Placement | Example Lab | Sep 2026 – Aug 2027";
  const s = "I am currently on an industrial placement at Example Lab, building ETL pipelines in Python.";
  assert.equal(guard(s, future).text, s);
  assert.equal(guard("I completed an industrial placement at Example Lab.", future).removed.length, 1, "completed, while it runs to Aug 2027");
  const thisYear = "EXPERIENCE\nIndustrial Placement | Example Lab | 2025 – 2026";
  assert.equal(guard("I completed an industrial placement at Example Lab.", thisYear).removed.length, 0);
  assert.equal(guard(s, thisYear).removed.length, 0);
  assert.equal(guard("I completed an industrial placement at Example Lab.", "EXPERIENCE\nIndustrial Placement | Example Lab | Sep 2026 – Aug 2027 (expected)").removed.length, 1, "expected counts as running");
  assert.equal(guard("I completed an industrial placement at Example Lab.", "EDUCATION\nBSc Computing with a placement year (expected 2027)").removed.length, 0, "a degree's dates are not the placement's");
});

test("the applied-for strip keeps the candidate's own facts", () => {
  // Mid-sentence is left as it is (6 Nov): only the clause that ends the sentence goes.
  const mid = "Software developer applying for the Product Engineer role with two years' production experience in Python and FastAPI.";
  assert.equal(stripAppliedFor(mid).text, mid);
  const tool = "Built Jobhuntz, a CV tool that helps engineers apply for graduate roles at 120 UK companies.";
  assert.deepEqual(stripAppliedFor(tool), { text: tool, removed: [] });
  assert.equal(stripAppliedFor("Python developer with FastAPI APIs, applying for the 2027 Technology Graduate Programme.").text, "Python developer with FastAPI APIs.");
  assert.equal(stripAppliedFor("Data engineer with Airflow pipelines, applying for the Software Engineering Industrial Placement.").text, "Data engineer with Airflow pipelines.");
});

test("a named technology is never sent to the model, whatever it is spelt with", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Built REST APIs in FastAPI\n\nSKILLS\nPython, FastAPI";
  const terms = ["C#", "C++", ".NET", "Go", "Excel", "Pandas", "Selenium", "Cypress", "Helm", "Nginx", "Bash", "Hadoop", "Splunk", "Redis", "Django", "Elasticsearch", "Grafana", "Jira"];
  const { askModel, items } = classifyByRules(buildEvidenceMap({ role_title: "x", required_skills: terms, top_15_ats_keywords: [] }, cv, "", null), cv, "");
  assert.deepEqual(askModel, []);
  for (const i of items) assert.equal(i.checked, true, i.term);
});

test("a shorter miss is never matched to a longer gap", () => {
  const check: GapCheck = { items: [{ term: "AWS Lambda", importance: "required", kind: "technical", class: "core", line: null, where: null, via: null, learning: false, checked: true }], model: "ok" };
  assert.equal(gapFor(check, "AWS — not present in the tailored text"), null);
  assert.equal(gapFor(check, "AWS Lambda functions — not present")?.term, "AWS Lambda");
});

test("suggestions: unquoted lines, added claims, project moves and learning skills are all held", () => {
  const cv = `EXPERIENCE
Software Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users
• Built a Kafka pipeline for payment events

PROJECTS
Ride App | 2024
• Built a ride booking app in React and TypeScript

SKILLS
Python, FastAPI, HTTP, Kafka

Currently learning: Kubernetes`;
  const ctx = { sources: [cv], absentTerms: ["HTTP", "Kubernetes", "high-throughput distributed systems", "FastAPI"] };
  const held = [
    "Change the booking bullet to: Optimised HTTP request handling and response serialisation for the booking platform.",
    `Add: "Led the migration of REST API endpoints in FastAPI for the booking platform"`,
    `Add: "Built REST API endpoints in FastAPI for the booking platform with zero downtime and full ownership"`,
    `Move "Built a ride booking app in React and TypeScript" into your Northgate Systems role.`,
    "Add Kubernetes to your Technical Tools line.",
  ];
  for (const s of held) assert.deepEqual(checkSuggestions([s], ctx).kept, [], s);
  assert.match(checkSuggestions([held[3]], ctx).needsEvidence[0].note, /project work into a paid role/);
  const kept = [
    `The posting asks for "experience with high-throughput distributed systems"; move your Northgate Kafka pipeline bullet to the top.`,
    `Name the API work in your summary: "Built REST API endpoints in FastAPI for the booking platform serving 2,000 daily users"`,
    "Move FastAPI to the front of your skills line.",
  ];
  for (const s of kept) assert.deepEqual(checkSuggestions([s], ctx).kept, [s], s);
});

test("a programme rule reads only the length of the thing its sentence names", () => {
  const job = `Software Engineering Intern 2027
Our 10-week internship starts in June 2027.
Strong interns may be offered a place on our two-year graduate programme.
You must have the right to work in the UK for the full duration of the internship, without requiring visa sponsorship.`;
  const t = triageJd(job, { rightToWork: "time_limited", permissionEnds: "2028-01" });
  assert.equal(t.hits.some((h) => h.rule === "rtw_programme"), false);
  // Ten weeks from June: certainly two months (the Skip), at most into September (the Review).
  assert.deepEqual(programmeEnd(job, "internship"), { month: "2027-07", latest: "2027-09", start: "2027-06", months: 2 });
  assert.equal(programmeEnd(job, "programme")?.months, 24);
});

test("seniority: a Senior or Lead title beats the pay, Well-Architected is no duty, a years minimum beats an entry-level label", () => {
  assert.equal(classifySeniority("Senior Backend Engineer\n£55,000 – £70,000\nArchitecting our platform.", "Senior Backend Engineer").level, "senior");
  assert.equal(classifySeniority("Lead Engineer\n£60k–£70k\nArchitecting our data platform.", "Lead Engineer").level, "senior");
  const wa = classifySeniority("Software Engineer\n2+ years of experience\n£55k–£62k\nYou'll work on our AWS Well-Architected platform.", "Software Engineer");
  assert.equal(wa.signals.some((s) => /duties/.test(s.text)), false);
  assert.equal(seniorityFit(wa, 2).fits, true);
  const label = classifySeniority("Backend Engineer\nSeniority level: Entry level\nYou have 5+ years of experience in Python.", "Backend Engineer");
  assert.notEqual(label.level, "junior");
});
