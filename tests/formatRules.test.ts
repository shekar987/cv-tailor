// Unit tests for the hard post-generation formatting rules. node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capTechnicalTools,
  capSummary,
  splitSentences,
  applyFormatRules,
  dropUnsupportedTools,
  dropUnsupportedCompetencies,
  MAX_TECHNICAL_TOOLS,
  MAX_SUMMARY_SENTENCES,
  MAX_SUMMARY_WORDS,
  restoreAskedTools,
} from "../src/lib/formatRules.ts";

const tools25 = [
  "Python", "Java", "Spring Boot", "TypeScript", "React", "Node.js", "PostgreSQL", "MongoDB", "Redis", "Docker",
  "Kubernetes", "Terraform", "AWS", "GCP", "GitHub Actions", "Jenkins", "Kafka", "RabbitMQ", "GraphQL", "REST APIs",
  "Jest", "Playwright", "Grafana", "Prometheus", "Linux",
];
const skillsBlock = (tools: string[]) =>
  `Functional Competencies: Backend development | API design | CI/CD | Observability\nTechnical Tools: ${tools.join(" | ")}`;

test("capTechnicalTools: 25 tools → the 15 most JD-relevant, required skills first, keywords next, model order within tiers", () => {
  const required = ["Go", "Kubernetes", "PostgreSQL", "Terraform"]; // Go is not on the CV line — never added
  const keywords = ["Python", "Docker", "AWS", "Kafka", "Grafana", "Prometheus", "Linux", "GraphQL"];
  const { skills, fix } = capTechnicalTools(skillsBlock(tools25), keywords, required);
  assert.ok(fix);
  assert.equal(fix.kept.length, MAX_TECHNICAL_TOOLS);
  assert.equal(fix.dropped.length, 10);
  // Every required-skill tool and every keyword tool survives; the cut falls on the unmentioned ones.
  for (const t of ["Kubernetes", "PostgreSQL", "Terraform", "Python", "Docker", "AWS", "Kafka", "Grafana", "Prometheus", "Linux", "GraphQL"]) {
    assert.ok(fix.kept.includes(t), `${t} kept`);
  }
  assert.ok(!fix.kept.includes("Go"), "a required skill absent from the CV line is never added");
  // Ties (tier 2) keep the model's order: Java, Spring Boot, TypeScript, React came first among the unmentioned.
  assert.deepEqual(fix.kept.filter((t) => !required.includes(t) && !keywords.includes(t)), ["Java", "Spring Boot", "TypeScript", "React"]);
  assert.deepEqual(fix.dropped, ["Node.js", "MongoDB", "Redis", "GCP", "GitHub Actions", "Jenkins", "RabbitMQ", "REST APIs", "Jest", "Playwright"]);
  // The kept line is in the model's original order, and the other line is untouched.
  const lines = (skills as string).split("\n");
  assert.equal(lines[0], "Functional Competencies: Backend development | API design | CI/CD | Observability");
  assert.equal(lines[1], `Technical Tools: ${tools25.filter((t) => fix.kept.includes(t)).join(" | ")}`);
  // The bold label the skills prompt produces is capped the same way, markers kept.
  const bold = capTechnicalTools(`**Functional Competencies:** APIs\n**Technical Tools:** ${tools25.join(" | ")}`, keywords, required);
  assert.ok(bold.fix && bold.fix.kept.length === 15, "bold label is recognised");
  assert.match(String(bold.skills).split("\n")[1], /^\*\*Technical Tools:\*\* /);
  assert.equal(lines[1].split(" | ").length, 15);
});

test("capTechnicalTools: a compliant line, a non-technical flat line and a non-string are returned untouched", () => {
  const ok = skillsBlock(tools25.slice(0, 15));
  assert.deepEqual(capTechnicalTools(ok, [], []), { skills: ok, fix: null });
  const flat = tools25.join(" | ");
  assert.deepEqual(capTechnicalTools(flat, [], []), { skills: flat, fix: null });
  assert.deepEqual(capTechnicalTools(null, [], []), { skills: null, fix: null });
  assert.deepEqual(capTechnicalTools("", [], []), { skills: "", fix: null });
});

test("capTechnicalTools: canonical spellings count as JD relevance (k8s ↔ Kubernetes, Postgres ↔ PostgreSQL) and duplicates collapse", () => {
  const tools = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13", "A14", "k8s", "Postgres", "Postgres"];
  const { fix } = capTechnicalTools(skillsBlock(tools), ["Kubernetes"], ["PostgreSQL"]);
  assert.ok(fix);
  assert.ok(fix.kept.includes("k8s"));
  assert.ok(fix.kept.includes("Postgres"));
  assert.equal(fix.kept.filter((t) => t === "Postgres").length, 1);
  assert.deepEqual(fix.dropped, ["A14"]);
});

test("splitSentences: decimals, e.g., Node.js and £ figures do not split; a line break does", () => {
  assert.deepEqual(splitSentences("Cut costs £2.3m in 2023. Built Node.js services (e.g. billing) for 150k users.\nThird line here."), [
    "Cut costs £2.3m in 2023.",
    "Built Node.js services (e.g. billing) for 150k users.",
    "Third line here.",
  ]);
});

test("capSummary: three paragraphs of nine sentences → the first three, one per line", () => {
  const para = (n: number) => Array.from({ length: 3 }, (_, i) => `Sentence ${n * 3 + i + 1} says something with 40% here.`).join(" ");
  const summary = `${para(0)}\n\n${para(1)}\n\n${para(2)}`;
  const { summary: out, fix } = capSummary(summary);
  assert.deepEqual(fix, { sentences: 9, kept: MAX_SUMMARY_SENTENCES });
  assert.equal(out, "Sentence 1 says something with 40% here.\nSentence 2 says something with 40% here.\nSentence 3 says something with 40% here.");
  assert.equal((out as string).split("\n").length, 3);
});

test("capSummary: a compliant three-line summary is unchanged apart from collapsed blank lines", () => {
  const three = "Backend Engineer with 2 years on Go services.\nCut p99 latency 40% at Acme.\nTargeting a Platform Engineer role.";
  assert.deepEqual(capSummary(three), { summary: three, fix: null });
  assert.deepEqual(capSummary(three.replace(/\n/g, "\n\n")), { summary: three, fix: null });
  assert.deepEqual(capSummary(undefined), { summary: undefined, fix: null });
  assert.deepEqual(capSummary(""), { summary: "", fix: null });
});

test("applyFormatRules: both rules run from the analysis, and a clean result reports no fixes", () => {
  const analysis = { top_15_ats_keywords: ["Docker"], required_skills: ["Kubernetes"] };
  const r = applyFormatRules({ summary: "A. B. C. D.", skills: skillsBlock(tools25) }, analysis);
  assert.equal(r.summary, "A.\nB.\nC.");
  assert.equal(r.fixes.summary?.sentences, 4);
  assert.equal(r.fixes.tools?.kept.length, 15);
  assert.ok(r.fixes.tools?.kept.includes("Docker") && r.fixes.tools?.kept.includes("Kubernetes"));
  const clean = applyFormatRules({ summary: "A.\nB.\nC.", skills: skillsBlock(tools25.slice(0, 10)) }, null);
  assert.deepEqual(clean.fixes, { tools: null, summary: null, unsupportedTools: null, competencies: null, restoredTools: null });
  assert.equal(clean.skills, skillsBlock(tools25.slice(0, 10)));
});

test("Technical Tools the master CV never names are dropped; the label survives", () => {
  const cv = "Skills: Python, FastAPI, PostgreSQL, Docker, Git / GitHub";
  const r = dropUnsupportedTools("**Functional Competencies:** API design\n**Technical Tools:** Python | Brossa | FastAPI | Go | Git", [cv]);
  assert.deepEqual(r.dropped, ["Brossa", "Go"]);
  assert.equal(r.skills, "**Functional Competencies:** API design\n**Technical Tools:** Python | FastAPI | Git");
  // Nothing to hold the line to → untouched.
  assert.deepEqual(dropUnsupportedTools("Technical Tools: Go", []), { skills: "Technical Tools: Go", dropped: [] });
});

test("Functional Competencies naming a work context the CV never shows are dropped", () => {
  const cv = "Built REST APIs for enterprise workflows. Wrote 90 unit tests.";
  const r = dropUnsupportedCompetencies(
    "Functional Competencies: REST API design | Client-facing technical problem-solving | Stakeholder collaboration across teams | Automated testing\nTechnical Tools: Python",
    [cv]
  );
  assert.deepEqual(r.dropped, ["Client-facing technical problem-solving", "Stakeholder collaboration across teams"]);
  assert.equal(r.skills, "Functional Competencies: REST API design | Automated testing\nTechnical Tools: Python");
});

test("a summary past the word cap loses its last sentence, never the one with the role title", () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? "Filler" : `word${i}`)).join(" ");
  const summary = `Engineer with Python work. ${long(40)}. ${long(40)} applying for the Platform Engineer role.`;
  assert.ok(summary.split(/\s+/).length > MAX_SUMMARY_WORDS);
  const kept = capSummary(summary, MAX_SUMMARY_SENTENCES, "Platform Engineer");
  assert.equal(kept.fix, null, "the last sentence carries the title, so it stays");
  const cut = capSummary(`Engineer applying for the Platform Engineer role. ${long(40)}. ${long(40)}.`, MAX_SUMMARY_SENTENCES, "Platform Engineer");
  assert.equal(cut.fix?.kept, 2);
  assert.ok((cut.fix?.words ?? 0) > MAX_SUMMARY_WORDS);
});

test("a personal quality is not a Functional Competency; one with a concrete skill in it stays", () => {
  const r = dropUnsupportedCompetencies("Functional Competencies: Problem-solving and debugging | Self-directed learning and rapid skill acquisition | Communication", ["Built APIs."]);
  assert.deepEqual(r.dropped, ["Self-directed learning and rapid skill acquisition", "Communication"]);
  assert.equal(r.skills, "Functional Competencies: Problem-solving and debugging");
});

test("restoreAskedTools: a tool the posting asks for and the master CV lists goes back on a full line; never a phrase, a learning skill or a project skill in the lead slots", () => {
  const master = "EXPERIENCE\nEngineer — Acme | 2023 – Present\n- Built FastAPI services on PostgreSQL\n\nADDITIONAL INFORMATION\nTechnical Skills: Python, FastAPI, React, TypeScript, JavaScript, PostgreSQL, MySQL, Docker, Kafka";
  const fifteen = ["Python", "FastAPI", "PostgreSQL", "MySQL", "MongoDB", "Redis", "React", "TypeScript", "REST APIs", "JWT", "RBAC", "SQLAlchemy", "Docker", "CI/CD", "Git"];
  const skills = `Functional Competencies: API design\nTechnical Tools: ${fifteen.join(" | ")}`;
  // The Somak run (26 Sep): JavaScript asked for, listed on the master CV, left out.
  const analysis = { required_skills: ["Relational databases", "Accessibility", "API development"], top_15_ats_keywords: ["Python", "JavaScript", "Docker", "Kafka"] };
  const r = restoreAskedTools(skills, analysis, master, { version: 1, confirmedAt: null, seededFrom: null, skills: [{ name: "Kafka", level: "learning", confirmed: true }] });
  assert.deepEqual(r.restored, ["JavaScript"], "Accessibility is not on the list; Kafka is still being learnt; Relational databases and API development are concepts, not tools");
  // A single distinctive name the list implies does come back (SQL by PostgreSQL/MySQL).
  assert.deepEqual(restoreAskedTools(`Technical Tools: Python | FastAPI`, { required_skills: ["SQL"] }, master).restored, ["SQL"]);
  const line = String(r.skills).split("\n")[1];
  assert.match(line, /\| JavaScript$/, "it takes the place of the last tool the posting never mentions (Git)");
  assert.equal(line.split(" | ").length, 15);
  // A project-level tool on a short line would land in the first eight slots: it waits.
  const short = `Technical Tools: Python | FastAPI | Docker`;
  const proj = restoreAskedTools(short, analysis, master, {
    version: 1,
    confirmedAt: null,
    seededFrom: null,
    skills: [
      { name: "JavaScript", level: "project", confirmed: true },
      { name: "Kafka", level: "learning", confirmed: true },
    ],
  });
  assert.deepEqual(proj.restored, []);
  // Already on the line → nothing to do.
  assert.deepEqual(restoreAskedTools(`Technical Tools: JavaScript | Python`, { top_15_ats_keywords: ["JavaScript", "Python"] }, master).restored, []);
});

test("restoreAskedTools never restores a skill the CV says is still being learnt, registry or not", () => {
  const master = "SKILLS\nCore: Java 17, Spring Boot, PostgreSQL, Docker\nWorking knowledge: Python, Redis, Terraform\nCurrently learning: Kubernetes, Kafka";
  const r = restoreAskedTools("Technical Tools: Java 17 | Spring Boot", { top_15_ats_keywords: ["Kubernetes", "Kafka", "Terraform"] }, master, null);
  assert.deepEqual(r.restored, ["Terraform"]);
});
