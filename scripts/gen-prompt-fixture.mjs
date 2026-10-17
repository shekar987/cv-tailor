// Captures the prompt strings src/prompts/steps.ts builds for a fixed set of
// inputs into tests/fixtures/ukji-prompts.json. Run ONCE, before the prompts
// took their style-block parameters (16 Oct 2026, commit "test(prompts):
// snapshot the UKJI prompt strings"); tests/promptSnapshot.test.ts then
// proves the UKJI style reproduces every string byte for byte. Never
// regenerate it on a branch that changes the prompts — the point is the
// comparison with what shipped.
//
//   node scripts/gen-prompt-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as steps from "../src/prompts/steps.ts";
import { DEFAULT_CLAIMS_BLOCK } from "../src/lib/claims.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = join(HERE, "..");
const pairs = JSON.parse(readFileSync(join(PROJ, "eval", "pairs.json"), "utf8"));
const cv = pairs.cvs[0].text;

const claims = "CLAIMS REGISTRY — what each skill may be called:\n- Java: production\n- Kafka: project\n- Kubernetes: learning\nFORBIDDEN: Kubernetes anywhere.";
const variant = "POSITIONING VARIANT for this run:\n- Headline: Backend engineer (Java, Spring Boot)\n- Lead skills: Java, Spring Boot, PostgreSQL";
const retry = "\nREJECTED IN YOUR PREVIOUS DRAFT: the summary did not contain the exact role title \"Backend Engineer\". Rewrite it so that title appears verbatim once, as the job being applied for. Keep every fact and figure as it was.\n";
const evidence = "\nREQUIREMENT → EVIDENCE (lib/evidenceMap):\n- Java — paid work shows it (Acme, 2021–2024)\n- Kafka — a personal project only (StreamLab)\n- Kubernetes — the master CV never shows it\n";
const idBlock = "ROLE 1: Backend Engineer | Acme | Jan 2021 – Mar 2024\n[R1.1] Built the order service in Java and Spring Boot, cutting p95 latency by 40%.\n[R1.2] Wrote 300 unit tests with JUnit.\n\nROLE 2: Junior Developer | Beta Ltd | Jun 2019 – Dec 2020\n[R2.1] Maintained a PHP monolith.";
const budget = "LENGTH BUDGET — custom budget text for the fixture:\n- Role 1: at most 4 bullets.\n- Role 2: at most 2 bullets.";
const pool = "PROJECT POOL\nStreamLab — Kafka, Java, Docker | 2024\n- Built a streaming pipeline processing 10k events per minute.\nShopKit — React, Node.js | 2023\n- Built a storefront with Stripe payments.";
const coverage = "\nPOOL COVERAGE (computed):\n- StreamLab names: Kafka, Java\n- ShopKit names: Node.js\n";
const flags = [{ bullet: "Built a service — directly applicable to Acme's workflows", reasons: ["narrates its relevance to the employer"] }];

const cases = [];
const add = (name, fn, args) => cases.push({ name, fn, args, text: steps[fn](...args) });

add("summary.min", "summaryPrompt", [cv]);
add("summary.full.identity", "summaryPrompt", [cv, claims, variant, "Backend Engineer", retry, evidence, true]);
add("summary.full.appliedFor", "summaryPrompt", [cv, DEFAULT_CLAIMS_BLOCK, "", "Backend Engineer", "", evidence, false]);
add("skills.min", "skillsPrompt", [cv]);
add("skills.full", "skillsPrompt", [cv, claims, variant, evidence]);
add("experience.min", "experiencePrompt", [cv]);
add("experience.ids", "experiencePrompt", [cv, budget, claims, "", idBlock, evidence]);
add("experience.retry", "experiencePrompt", [cv, undefined, DEFAULT_CLAIMS_BLOCK, steps.rejectedBulletsBlock(flags), idBlock, ""]);
add("projects.min", "projectsPrompt", [cv]);
add("projects.full", "projectsPrompt", [cv, ["Alpha", "Beta"], budget, claims, steps.rejectedBulletsBlock(flags), evidence]);
add("pool.min", "poolProjectsPrompt", [cv, pool]);
add("pool.full", "poolProjectsPrompt", [cv, pool, claims, steps.rejectedBulletsBlock(flags), evidence, coverage]);
add("letter.min", "coverLetterPrompt", [cv]);
add("letter.omitRtw", "coverLetterPrompt", [cv, claims, true, evidence]);
add("letter.withRtw", "coverLetterPrompt", [cv, claims, false, evidence]);
add("repair", "claimsRepairPrompt", [cv, claims, { title: "Backend Engineer", keywords: ["Java", "Kafka"], required: ["Java"] }]);
add("support.noPool", "supportCheckPrompt", [cv]);
add("support.pool", "supportCheckPrompt", [cv, pool]);
add("letterFix", "coverLetterFixPrompt", [["Shoreditch"], ["I can work from Shoreditch."]]);
add("ats", "atsScoringPrompt", ["BAND BLOCK: weak, 3/15."]);
add("roleTitleRule.identity", "roleTitleRule", ["Backend Engineer", true]);
add("roleTitleRule.appliedFor", "roleTitleRule", ["Backend Engineer", false]);
add("rejectedBullets", "rejectedBulletsBlock", [flags]);

const constants = {};
for (const k of ["JD_ANALYZER_PROMPT", "LENGTH_BUDGET", "HUMAN_VOICE_RULE", "BULLET_SHAPE_RULE", "COMPANY_RESEARCH_PROMPT"]) constants[k] = steps[k];

const out = { generatedAt: "2026-10-16", note: "Built by scripts/gen-prompt-fixture.mjs from the pre-style steps.ts. Do not regenerate.", inputs: { cv, claims, variant, retry, evidence, idBlock, budget, pool, coverage, flags }, cases, constants };
writeFileSync(join(PROJ, "tests", "fixtures", "ukji-prompts.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${cases.length} cases, ${Object.keys(constants).length} constants → tests/fixtures/ukji-prompts.json`);
