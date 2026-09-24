// Unit tests for the hard post-generation formatting rules. node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capTechnicalTools,
  capSummary,
  splitSentences,
  applyFormatRules,
  MAX_TECHNICAL_TOOLS,
  MAX_SUMMARY_SENTENCES,
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
  assert.deepEqual(clean.fixes, { tools: null, summary: null });
  assert.equal(clean.skills, skillsBlock(tools25.slice(0, 10)));
});
