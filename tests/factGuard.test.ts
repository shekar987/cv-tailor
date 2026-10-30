import test from "node:test";
import assert from "node:assert/strict";
import {
  fixDegreeLabels, dropUnbackedTools, liftedSummaryPhrases, guardFacts, masterUndergrad,
  factGuardNotices, factGuardItemKey, normalizeFactGuard, FACT_GUARD_LABELS,
} from "../src/lib/factGuard.ts";

const master = `SOMA SHEKAR KEESARI
EDUCATION
MSc Computer Science (with Industrial Placement) — University of East London Jan 2025 – Jan 2027
BTech Computer Science — Keshav Memorial Institute of Technology Jul 2019 – Jul 2023
SKILLS
AI & LLM: Anthropic Claude API, LangChain, LlamaIndex, RAG
Cloud & DevOps: AWS (Lambda, SQS), Terraform, Docker
EXPERIENCE
Full Stack Engineer | Brane Group | Jul 2022 – Oct 2024
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
  const summary = "Full Stack Engineer with live translation AI development and full-stack production experience at Brane Group.";
  const hits = liftedSummaryPhrases(summary, master, jd);
  assert.ok(hits.some((h) => h.includes("live translation")), JSON.stringify(hits));
  assert.deepEqual(liftedSummaryPhrases("Full Stack Engineer at Brane Group building Python services.", master, jd), []);
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
