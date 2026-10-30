import test from "node:test";
import assert from "node:assert/strict";
import {
  fixDegreeLabels, dropUnbackedTools, liftedSummaryPhrases, guardFacts, masterUndergrad,
  factGuardNotices, factGuardItemKey, normalizeFactGuard, FACT_GUARD_LABELS,
  keepOutOfLead, listNames, LEAD_SLOTS,
} from "../src/lib/factGuard.ts";
import { SKILLS_SHAPE } from "../src/lib/formatStyles/ids.ts";

const master = `ALEX MORGAN
EDUCATION
MSc Computer Science (with Industrial Placement) — University of Hartwell Jan 2025 – Jan 2027
BTech Computer Science — Riverside Institute of Technology Jul 2019 – Jul 2023
SKILLS
AI & LLM: Anthropic Claude API, LangChain, LlamaIndex, RAG
Cloud & DevOps: AWS (Lambda, SQS), Terraform, Docker
EXPERIENCE
Full Stack Engineer | Northgate Systems | Jul 2022 – Oct 2024
• Delivered 20+ production API modules using Python, FastAPI, React and TypeScript`;

// 29 Oct 2026: the extracted profile and a CareerSet summary said "BSc".
test("fixDegreeLabels: a degree label the master never uses goes back to the master's own", () => {
  assert.equal(masterUndergrad(master), "BTech");
  const r = fixDegreeLabels("BSc Computer Science", master);
  assert.equal(r.text, "BTech Computer Science");
  assert.deepEqual(r.fixed, ["BSc → BTech"]);
  assert.equal(fixDegreeLabels("MSc Computer Science", master).text, "MSc Computer Science");
  assert.equal(fixDegreeLabels("BTech Computer Science", master).fixed.length, 0);
  assert.equal(fixDegreeLabels("BSc Physics", "no degree here").text, "BSc Physics", "no master label: untouched");
});

test("dropUnbackedTools: an over-claimed tool the master never names leaves the skills; named ones stay", () => {
  const skills = "AI & LLM: Anthropic Claude API, OpenAI API, LangChain, RAG\nCloud & DevOps: AWS, Kubernetes, Terraform";
  const r = dropUnbackedTools(skills, master);
  assert.doesNotMatch(r.text, /OpenAI API/);
  assert.doesNotMatch(r.text, /Kubernetes/);
  assert.match(r.text, /Anthropic Claude API, LangChain, RAG/);
  assert.match(r.text, /AWS, Terraform/);
  assert.deepEqual(r.dropped.sort(), ["Kubernetes", "OpenAI API"]);
  const kept = dropUnbackedTools("Tools: OpenAI API, Docker", master + "\nOpenAI API");
  assert.match(kept.text, /OpenAI API/);
  assert.equal(dropUnbackedTools("OpenAI API, Docker", master).text, "Docker");
});

test("liftedSummaryPhrases: a JD phrase in the summary that the master never states is reported", () => {
  const jd = "Hike is representing a client building live translation technology. You'll do live translation AI development across the stack.";
  const summary = "Full Stack Engineer with live translation AI development and full-stack production experience at Northgate Systems.";
  const hits = liftedSummaryPhrases(summary, master, jd);
  assert.ok(hits.some((h) => h.includes("live translation")), JSON.stringify(hits));
  assert.deepEqual(liftedSummaryPhrases("Full Stack Engineer at Northgate Systems building Python services.", master, jd), []);
});

test("guardFacts: runs all three on the finished sections", () => {
  const g = guardFacts({ summary: "Engineer with a BSc and production FastAPI.", skills: "Python, OpenAI API, FastAPI" }, master, "FastAPI role");
  assert.equal(g.summary, "Engineer with a BTech and production FastAPI.");
  assert.equal(g.skills, "Python, FastAPI");
  assert.deepEqual(g.report.droppedTools, ["OpenAI API"]);
});

// ── The notice on /app (30 Oct) ────────────────────────────────────────────

test("factGuardNotices: one line per non-empty list, lifted phrases first; a clean run shows nothing", () => {
  const report = { degrees: ["BSc → BTech"], droppedTools: ["Kafka", "Azure"], liftedPhrases: ["live translation ai"] };
  const notices = factGuardNotices(report);
  assert.deepEqual(notices.map((n) => n.kind), ["liftedPhrases", "droppedTools", "degrees"]);
  assert.equal(notices[0].label, "Summary lines copied from the job ad, check they are true:");
  assert.equal(notices[1].label, FACT_GUARD_LABELS.droppedTools);
  assert.deepEqual(notices[1].items, ["Kafka", "Azure"]);
  assert.deepEqual(factGuardNotices({ degrees: [], droppedTools: [], liftedPhrases: [] }), [], "a clean tailor: no notice");
  assert.deepEqual(factGuardNotices(null), [], "an older result with no report");
});

test("factGuardNotices: an OK'd item leaves; a list with every item OK'd leaves", () => {
  const report = { degrees: ["BSc → BTech"], droppedTools: ["Kafka", "Azure"], liftedPhrases: [] };
  const ok = new Set([factGuardItemKey("droppedTools", "Kafka")]);
  assert.deepEqual(factGuardNotices(report, ok).find((n) => n.kind === "droppedTools")?.items, ["Azure"]);
  ok.add(factGuardItemKey("droppedTools", "Azure"));
  ok.add(factGuardItemKey("degrees", "BSc → BTech"));
  assert.deepEqual(factGuardNotices(report, ok), []);
});

test("normalizeFactGuard re-bounds what the response or a stored workspace holds", () => {
  assert.equal(normalizeFactGuard(null), null);
  assert.equal(normalizeFactGuard("nope"), null);
  assert.deepEqual(normalizeFactGuard({ degrees: ["BSc → BTech", 3, " "], droppedTools: "Kafka", liftedPhrases: ["x".repeat(400)] }), {
    degrees: ["BSc → BTech"],
    droppedTools: [],
    liftedPhrases: ["x".repeat(160)],
  });
});

// ── Tool guards (31 Oct, Chunk 6) ─────────────────────────────────────────

test("OpenAI API stays only when the user's skills list names it, not the master's prose", () => {
  const prose = master + "\n• Called the OpenAI API to summarise support tickets";
  const skills = "Technical Tools: Python | OpenAI API | FastAPI";
  // Prose alone: without a skills list the old rule keeps it; with the list it goes.
  assert.match(dropUnbackedTools(skills, prose).text, /OpenAI API/);
  const listed = dropUnbackedTools(skills, prose, ["Python", "FastAPI", "LangChain"]);
  assert.equal(listed.text, "Technical Tools: Python | FastAPI");
  assert.deepEqual(listed.dropped, ["OpenAI API"]);
  // Named in the list, as the item or as the vendor: kept.
  assert.match(dropUnbackedTools(skills, master, ["Python", "OpenAI API"]).text, /OpenAI API/);
  assert.match(dropUnbackedTools(skills, master, ["OpenAI"]).text, /OpenAI API/);
  assert.equal(listNames(["OpenAI GPT-4o"], "OpenAI API"), false, "another OpenAI product is not the API");
});

test("the list rule touches only OpenAI API; other tools still go by the master CV", () => {
  const r = dropUnbackedTools("Technical Tools: Kubernetes | Terraform | OpenAI API", master, ["Terraform", "Kubernetes"]);
  assert.deepEqual(r.dropped.sort(), ["Kubernetes", "OpenAI API"]);
  assert.equal(r.text, "Technical Tools: Terraform");
});

const TEN = ["Python", "TypeScript", "FastAPI", "React", "PostgreSQL", "AWS", "Docker", "Terraform", "Jest", "Redis"];

test("GitHub Actions never holds one of the first 8 Technical Tools: it moves to the end", () => {
  const flat = `Functional Competencies: API Design | Testing\nTechnical Tools: Python | GitHub Actions | ${TEN.slice(1).join(" | ")}`;
  const r = keepOutOfLead(flat);
  assert.deepEqual(r.fix, { moved: ["GitHub Actions"], dropped: [] });
  const tools = r.text.split("\n")[1].replace("Technical Tools: ", "").split(" | ");
  assert.equal(tools.indexOf("GitHub Actions"), tools.length - 1);
  assert.ok(tools.indexOf("GitHub Actions") >= LEAD_SLOTS);
  assert.equal(r.text.split("\n")[0], "Functional Competencies: API Design | Testing", "the competencies line untouched");
  // Already behind the lead slots: nothing moves.
  const late = `Technical Tools: ${TEN.join(" | ")} | GitHub Actions`;
  assert.equal(keepOutOfLead(late).text, late);
});

test("GitHub Actions in a list of 8 or fewer has no place behind the lead: it leaves", () => {
  const r = keepOutOfLead("Technical Tools: Python | GitHub Actions | FastAPI");
  assert.equal(r.text, "Technical Tools: Python | FastAPI");
  assert.deepEqual(r.fix.dropped, ["GitHub Actions"]);
});

test("the grouped CareerSet block: GitHub Actions moves to the Other line", () => {
  const grouped = [
    "Functional Competencies: API Design | Testing",
    "Technical Tools:",
    "Languages & Frameworks: Python, TypeScript, FastAPI, React",
    "Databases: PostgreSQL, Redis",
    "Cloud & DevOps: GitHub Actions, AWS, Docker, Terraform",
    "Testing: Jest, Pytest",
  ].join("\n");
  const r = keepOutOfLead(grouped, SKILLS_SHAPE.careerset);
  assert.deepEqual(r.fix.moved, ["GitHub Actions"]);
  assert.match(r.text, /^Cloud & DevOps: AWS, Docker, Terraform$/m);
  assert.match(r.text, /^Other: GitHub Actions$/m);
});

test("guardFacts runs the tool guards with the skills list and shape it is given", () => {
  const g = guardFacts(
    { summary: "Engineer.", skills: `Technical Tools: OpenAI API | GitHub Actions | ${TEN.join(" | ")}` },
    master + "\nUsed the OpenAI API once.",
    "",
    { skillNames: TEN }
  );
  assert.doesNotMatch(String(g.skills), /OpenAI API/);
  assert.deepEqual(g.report.droppedTools, ["OpenAI API"]);
  assert.deepEqual(g.leadTools.moved, ["GitHub Actions"]);
  assert.match(String(g.skills), /Redis \| GitHub Actions$/);
});
