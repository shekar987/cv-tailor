// The pre-check's gap read (lib/gapCheck, 5 Nov 2026): a rename (the CV shows
// the work under another word) or a core gap (no evidence), before a credit is
// spent. The CV is made up; the postings' terms are the 5 Nov sweep's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceMap } from "../src/lib/evidenceMap.ts";
import { applyModelRenames, classifyByRules, coreGapBanner, gapFor, gapRenameInput, normalizeGapCheck, RENAME_RULES, type GapCheck, type GapItem } from "../src/lib/gapCheck.ts";

const CV = `ALEX TESTER
Software Engineer

EXPERIENCE
Software Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Diagnosed and resolved production incidents across three Python services, cutting repeat tickets by 30%
• Built REST APIs in FastAPI serving 2,000 daily users
• Added structured logging and Grafana alerting for the payments service
• Built an analytics dashboard in React for 10k users, reducing timeout issues by 40%

Research Assistant | Example University | Oct 2024 – Present
• Built an evaluation harness for retrieval models in Python

SKILLS
Python, FastAPI, PostgreSQL, Docker, Grafana, Git

PROJECTS
Chat App | 2024
• Built a WebSocket chat service with React and Node.js`;

// A support-engineer posting in the shape of the 5 Nov sweep's Tailscale Tier 1 and Airwallex TSE.
const ANALYSIS = {
  role_title: "Customer Support Engineer",
  required_skills: ["Troubleshooting", "DNS", "Routing", "Firewalls", "Kubernetes", "Root cause analysis", "Communication"],
  nice_to_have_skills: ["Observability", "Source Control"],
  top_15_ats_keywords: ["HTTP", "Python"],
};

const read = (analysis: object = ANALYSIS, cv = CV) => classifyByRules(buildEvidenceMap(analysis, cv, "", null), cv, "");
const item = (items: GapItem[], term: string) => items.find((i) => i.term === term);
const gap = (term: string, over: Partial<GapItem> = {}): GapItem => ({ term, importance: "required", kind: "technical", class: "core", line: null, where: null, via: null, learning: false, checked: true, ...over });

test("a rename by the free rules points at the master CV's own line", () => {
  const { items } = read();
  const troubleshooting = item(items, "Troubleshooting");
  assert.equal(troubleshooting?.class, "rename", "troubleshooting is the incident bullet");
  assert.match(troubleshooting!.line!, /^Diagnosed and resolved production incidents/);
  assert.equal(troubleshooting!.where?.includes("Northgate"), true);
  assert.equal(troubleshooting!.via, "rule");
  assert.match(item(items, "HTTP")?.line ?? "", /REST APIs/, "HTTP is the REST API work");
  assert.match(item(items, "Observability")?.line ?? "", /structured logging and Grafana alerting/, "observability is the logging line");
  assert.equal(item(items, "Source Control")?.class, "rename", "source control is the Git the CV lists (version control the evidence map already places)");
  assert.equal(item(items, "Python"), undefined, "what the CV shows by name is no gap at all");
});

test("a rule is for the whole term, never a word inside it, and its evidence is specific", () => {
  const analysis = { role_title: "Analyst", required_skills: ["Network troubleshooting", "Transaction monitoring", "Incident management certification", "Customer support"], top_15_ats_keywords: [] };
  const { items, askModel } = read(analysis);
  assert.equal(item(items, "Network troubleshooting")?.class, "core", "not the React bug fix");
  assert.equal(item(items, "Transaction monitoring")?.class, "core", "an AML term, not logging");
  assert.equal(item(items, "Incident management certification")?.class, "core", "a qualification is never renamed");
  assert.equal(askModel.includes("Incident management certification"), false);
  assert.equal(item(items, "Customer support")?.class, "core", "a CV line about users and issues is no support work");
  const dashboard = read({ role_title: "x", required_skills: ["Monitoring"], top_15_ats_keywords: [] }, "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Built an analytics dashboard in React with charts and metrics");
  assert.equal(item(dashboard.items, "Monitoring")?.class, "core", "a dashboard is not monitoring");
});

test("a core gap is no evidence, and a named technology is never sent to the model, whatever its case", () => {
  const { items, askModel } = read();
  for (const t of ["DNS", "Routing", "Firewalls", "Kubernetes"]) assert.equal(item(items, t)?.class, "core", t);
  assert.equal(askModel.includes("Kubernetes"), false, "Docker is not Kubernetes");
  assert.equal(askModel.includes("DNS"), false);
  assert.equal(askModel.includes("Firewalls"), false);
  assert.equal(askModel.includes("Troubleshooting"), false, "a rule settled it");
  assert.equal(askModel.includes("Communication"), false, "a soft skill is only a missing word");
  assert.equal(askModel.includes("Root cause analysis"), true, "a practice the rules don't cover goes to the model");
  assert.equal(askModel.includes("Routing"), true);
  const lower = read({ role_title: "x", required_skills: ["kubernetes", "terraform", "code review"], top_15_ats_keywords: [] });
  assert.deepEqual(lower.askModel, [], "lowercase products stay named; a code review rule found nothing to ask about");
  assert.equal(item(lower.items, "kubernetes")?.checked, true);
});

test("a skill placed as being learnt is a core gap, whatever line might match it", () => {
  const cv = `${CV}\n\nCurrently learning: Kubernetes, observability tooling`;
  const { items, askModel } = classifyByRules(buildEvidenceMap(ANALYSIS, cv, "", { skills: [{ name: "Observability", level: "learning", evidence: "" }], confirmedAt: null } as never), cv, "");
  const o = item(items, "Observability");
  assert.equal(o?.class, "core");
  assert.equal(o?.learning, true);
  assert.equal(askModel.includes("Observability"), false);
});

test("the model's answer counts only for a term that was asked, with a line word for word inside one CV line", () => {
  const { items, askModel } = read();
  const raw = {
    renames: [
      { term: "Root cause analysis", line: "Diagnosed and resolved production incidents across three Python services" },
      { term: "Routing", line: "Built REST APIs in FastAPI serving 2,000 daily users behind a load balancer" },
      { term: "Kubernetes", line: "Built REST APIs in FastAPI serving 2,000 daily users" },
    ],
  };
  const out = applyModelRenames(items, raw, askModel, CV, "");
  const rca = item(out, "Root cause analysis");
  assert.equal(rca?.class, "rename");
  assert.equal(rca?.via, "model");
  assert.match(rca!.line!, /cutting repeat tickets by 30%$/, "the CV's own whole line, not the model's quote");
  assert.equal(item(out, "Routing")?.class, "core", "an invented tail on a real line is refused");
  assert.equal(item(out, "Routing")?.checked, true, "the model answered for it");
  assert.equal(item(out, "Kubernetes")?.class, "core", "a term that was never asked is refused");
  assert.deepEqual(applyModelRenames(items, "nonsense", askModel, CV, ""), items, "an unreadable answer changes nothing, checked or not");
});

test("the banner names the required core gaps before a credit is spent, and says when the read didn't finish", () => {
  const { items, askModel } = read();
  const done: GapCheck = { items: applyModelRenames(items, { renames: [] }, askModel, CV, ""), model: "ok" };
  const banner = coreGapBanner(done);
  assert.deepEqual(banner!.terms, ["DNS", "Routing", "Firewalls", "Kubernetes", "Root cause analysis"]);
  assert.equal(banner!.text, "5 core gaps: DNS, Routing, Firewalls, Kubernetes, Root cause analysis. This role may not suit you.");
  assert.equal(banner!.blocks, true);

  const failed = coreGapBanner({ items, model: "failed" });
  assert.match(failed!.text, /The check for other wording didn't finish for 2 of them, so your CV may show them under another name\.$/);
  assert.equal(failed!.blocks, true, "three checked core gaps still hold it");
  const unfinished = coreGapBanner({ items: [gap("Routing", { checked: false }), gap("Firewalls", { checked: false })], model: "failed" });
  assert.equal(unfinished!.blocks, false, "nothing is held on a read that didn't finish");
  assert.doesNotMatch(unfinished!.text, /may not suit you/);

  assert.equal(coreGapBanner({ items: [gap("dbt")], model: "none" })!.text, "1 core gap: dbt.");
  assert.equal(coreGapBanner({ items: [gap("dbt")], model: "none" })!.blocks, false, "one gap is said, not held");
  assert.equal(coreGapBanner({ items: [gap("Communication", { kind: "soft" })], model: "none" }), null);
  assert.equal(coreGapBanner(null), null);
  const many: GapCheck = { items: ["a", "b", "c", "d", "e", "f", "g"].map((t) => gap(t)), model: "none" };
  assert.match(coreGapBanner(many)!.text, /^7 core gaps: a, b, c, d, e and 2 more\./);
});

test("the Missing list finds a term's class by its own words, and a stored check is re-bounded", () => {
  const check: GapCheck = { items: read().items, model: "ok" };
  assert.equal(gapFor(check, "Troubleshooting — not present in the tailored text")?.class, "rename");
  assert.equal(gapFor(check, "dns")?.class, "core");
  assert.equal(gapFor(check, "Kubernetes clusters — not present")?.term, "Kubernetes", "the evidence map's part of a longer keyword");
  assert.equal(gapFor(check, "Rust"), null);
  assert.equal(gapFor(null, "DNS"), null);
  assert.deepEqual(normalizeGapCheck(JSON.parse(JSON.stringify(check))), check);
  const odd = normalizeGapCheck({ items: [{ term: "x", class: "weird", line: 7 }] })!.items[0];
  assert.equal(odd.class, "core");
  assert.equal(odd.checked, true, "a stored item from before the flag reads as checked");
  assert.equal(normalizeGapCheck("nope"), null);
  assert.equal(normalizeGapCheck({ items: "x" }), null);
});

test("the model sees the terms and the CV, nothing else; no line shown keeps bold markers", () => {
  assert.deepEqual(JSON.parse(gapRenameInput(["Root cause analysis"], "CV", "POOL")), { terms: ["Root cause analysis"], cv: "CV\n\nPOOL" });
  assert.deepEqual(JSON.parse(gapRenameInput(["x"], "CV")), { terms: ["x"], cv: "CV" });
  assert.ok(RENAME_RULES.every((r) => !r.term.test("Kubernetes")), "no rule renames a named platform");
  const bold = read({ role_title: "x", required_skills: ["Troubleshooting"], top_15_ats_keywords: [] }, "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• **Diagnosed** production incidents across three services");
  assert.equal(item(bold.items, "Troubleshooting")?.line, "Diagnosed production incidents across three services");
});
