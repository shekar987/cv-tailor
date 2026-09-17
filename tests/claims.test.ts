// Unit tests for the claims registry and the deterministic claim check.
// node:test, zero dependencies: `npm test`. Every CV here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFigures,
  checkClaims,
  seedClaims,
  mergeClaims,
  normalizeClaims,
  normalizeSkillGuesses,
  renderClaimsBlock,
  claimMode,
  cvFingerprint,
  learningText,
  countUnconfirmed,
  looksLikeRefusal,
  DEFAULT_CLAIMS_BLOCK,
  type ClaimsRegistry,
} from "../src/lib/claims.ts";

const keys = (t: string) => extractFigures(t).map((f) => f.key);

test("extractFigures keeps real figures with their units", () => {
  const t = "Cut p95 latency 40% (from 200ms to 120ms); saved £2.3m a year; grew to 150k users and 1,200 daily orders; 3x throughput; 99.9% uptime; 5+ years of Python; $1b GMV; 2.5x faster";
  const k = keys(t);
  for (const expect of ["40%", "200 ms", "120 ms", "£2.3 m", "150 k", "1200", "3 x", "99.9%", "5 yr", "$1 bn", "2.5 x"]) {
    assert.ok(k.includes(expect), `missing ${expect} in ${JSON.stringify(k)}`);
  }
  // "150k users": the k binds first; the noun is context, not a second figure
  assert.ok(!k.includes("150 user"));
});

test("extractFigures drops dates, phones, versions, classes, numbering and small bare integers", () => {
  const t = [
    "Backend Engineer | Acme | 2019 - 2023",
    "Jul 2022 to Present; joined 10 March 2021",
    "Tel +44 7700 900123; ref 20230917",
    "Java 17, Python 3.11, Angular 15, .NET 6, S3, EC2, p95, OAuth2, utf8",
    "BSc Computer Science, 2:1; stand-up at 09:30",
    "1. Led the migration 2) Second item",
    "step 2; 12th release; 21st century",
    "Ranked 4th",
  ].join("\n");
  assert.deepEqual(keys(t), []);
  // A count noun makes a small number a scale claim — kept.
  assert.deepEqual(keys("Led one of 3 teams across 2 regions"), ["3 team", "2 region"]);
});

test("extractFigures: ranges yield two figures, currency keeps small numbers, thousands separators and synonyms fold", () => {
  assert.deepEqual(keys("improved conversion 20-30% and cut cost 5 to 8 percent"), ["20%", "30%", "5%", "8%"]);
  assert.deepEqual(keys("£480 per day; USD 50 an hour"), ["£480", "$50"]);
  assert.deepEqual(keys("2,500 requests per second; 3 million rows; 45 minutes; 12 hrs"), ["2500 request", "3 m", "45 min", "12 h"]);
});

test("checkClaims: a figure absent from the master CV is a violation; the same figure in a different context is a warning", () => {
  const cv = "• Cut p95 API latency by 40% by restructuring the service layer.\n• Migrated 12 services to Kubernetes.";
  const registry: ClaimsRegistry = { version: 1, skills: [], confirmedAt: null, seededFrom: null };
  const ok = checkClaims([{ where: "cv", text: "Cut API latency 40% by restructuring the service layer" }], registry, [cv]);
  assert.deepEqual(ok.numberViolations, []);
  const absent = checkClaims([{ where: "cv", text: "Cut API latency 50% by restructuring the service layer" }], registry, [cv]);
  assert.equal(absent.numberViolations.length, 1);
  assert.equal(absent.numberViolations[0].kind, "absent");
  assert.equal(absent.numberViolations[0].figure, "50%");
  const drift = checkClaims([{ where: "coverLetter", text: "I reduced cloud spend by 40% across the platform estate" }], registry, [cv]);
  assert.equal(drift.numberViolations.length, 1);
  assert.equal(drift.numberViolations[0].kind, "context_mismatch");
  assert.equal(drift.numberViolations[0].where, "coverLetter");
  // the project pool is a source too
  const pool = "Widget tracker | 2024\n- Handled 2,500 requests per second in load tests.";
  const withPool = checkClaims([{ where: "cv", text: "Handled 2,500 requests per second" }], registry, [cv, pool]);
  assert.deepEqual(withPool.numberViolations, []);
});

test("checkClaims: learning skills are caught through the matcher's variants; blocking follows mode and confirmation", () => {
  const cv = "Skills: Python, Django. Currently studying: Kubernetes, Kafka.";
  const unconfirmed: ClaimsRegistry = {
    version: 1,
    skills: [
      { name: "Python", level: "production", confirmed: false },
      { name: "Kubernetes", level: "learning", confirmed: false },
    ],
    confirmedAt: null,
    seededFrom: null,
  };
  const out = [{ where: "cv" as const, text: "Deployed services to K8s clusters with Python tooling." }];
  const warn = checkClaims(out, unconfirmed, [cv]);
  assert.equal(warn.mode, "warn");
  assert.equal(warn.skillViolations.length, 1);
  assert.equal(warn.skillViolations[0].skill, "Kubernetes");
  assert.equal(warn.blocking, false);

  const confirmedButUnconfirmedSkill: ClaimsRegistry = { ...unconfirmed, confirmedAt: "2026-09-17T00:00:00Z" };
  const enforceUnconfirmed = checkClaims(out, confirmedButUnconfirmedSkill, [cv]);
  assert.equal(enforceUnconfirmed.mode, "enforce");
  assert.equal(enforceUnconfirmed.blocking, false, "an unconfirmed learning skill warns even in enforce mode");

  const confirmed: ClaimsRegistry = {
    ...confirmedButUnconfirmedSkill,
    skills: confirmedButUnconfirmedSkill.skills.map((s) => ({ ...s, confirmed: true })),
  };
  const enforce = checkClaims(out, confirmed, [cv]);
  assert.equal(enforce.blocking, true);
  assert.equal(checkClaims([{ where: "cv", text: "Built Python tooling." }], confirmed, [cv]).blocking, false);
  // an absent figure blocks in enforce mode, warns otherwise
  assert.equal(checkClaims([{ where: "cv", text: "Cut costs 35% with Python tooling" }], confirmed, [cv]).blocking, true);
  assert.equal(checkClaims([{ where: "cv", text: "Cut costs 35% with Python tooling" }], unconfirmed, [cv]).blocking, false);
  // no registry: figures are still checked, skills are not
  const none = checkClaims(out, null, [cv]);
  assert.equal(none.skillViolations.length, 0);
  assert.equal(none.mode, "warn");
});

test("seedClaims: the CV's own 'currently studying' framing overrides the model's guess; merge keeps confirmed levels", () => {
  const cv = `SKILLS
Core: Java, Spring Boot, PostgreSQL
Working knowledge: Python, Docker
Currently studying: Kubernetes, Kafka, RAG`;
  assert.ok(/Kubernetes, Kafka, RAG/.test(learningText(cv)));
  const seed = seedClaims(cv, [
    { name: "Java", level: "production" },
    { name: "Python", level: "project" },
    { name: "Kubernetes", level: "production" }, // wrong guess
    { name: "Kafka", level: "learning" },
    { name: "Java", level: "learning" }, // duplicate, dropped
  ]);
  assert.deepEqual(
    seed.skills.map((s) => [s.name, s.level, s.confirmed]),
    [["Java", "production", false], ["Python", "project", false], ["Kubernetes", "learning", false], ["Kafka", "learning", false]]
  );
  assert.equal(seed.seededFrom, cvFingerprint(cv));
  assert.equal(claimMode(seed), "warn");
  assert.equal(countUnconfirmed(seed), 4);

  const confirmed: ClaimsRegistry = {
    ...seed,
    confirmedAt: "2026-09-17T00:00:00Z",
    skills: seed.skills.map((s) => ({ ...s, confirmed: true, level: s.name === "Python" ? "production" : s.level })),
  };
  const reseed = seedClaims(cv + "\nAlso: Terraform", [
    { name: "Java", level: "project" }, // model changed its mind; confirmed level wins
    { name: "Python", level: "project" },
    { name: "Terraform", level: "project" }, // new, unconfirmed
    // Kubernetes/Kafka gone from the guesses -> dropped
  ]);
  const merged = mergeClaims(confirmed, reseed);
  assert.deepEqual(
    merged.skills.map((s) => [s.name, s.level, s.confirmed]),
    [["Java", "production", true], ["Python", "production", true], ["Terraform", "project", false]]
  );
  assert.equal(merged.confirmedAt, confirmed.confirmedAt);
  assert.equal(claimMode(merged), "enforce");
  assert.equal(countUnconfirmed(merged), 1);
  assert.equal(mergeClaims(null, seed), seed);
});

test("normalizeClaims and normalizeSkillGuesses bound and default safely", () => {
  assert.equal(normalizeClaims(null), null);
  assert.equal(normalizeClaims({ skills: "x" }), null);
  const r = normalizeClaims({
    skills: [
      { name: " Node.js ", level: "production", confirmed: true },
      { name: "NodeJS", level: "learning" }, // same skill, dropped
      { name: "Go", level: "wizard" },
      { name: "", level: "production" },
    ],
    confirmedAt: 42,
    seededFrom: "abc",
  });
  assert.deepEqual(r?.skills, [
    { name: "Node.js", level: "production", confirmed: true },
    { name: "Go", level: "project", confirmed: false },
  ]);
  assert.equal(r?.confirmedAt, null);
  assert.deepEqual(normalizeSkillGuesses([{ name: "Rust", level: "production" }, { name: "Rust" }, "junk"]), [{ name: "Rust", level: "production" }]);
});

test("looksLikeRefusal catches a refusing step and leaves real sections alone", () => {
  assert.equal(looksLikeRefusal("I cannot produce a tailored CV for this role."), true);
  assert.equal(looksLikeRefusal("  I'm unable to write this section honestly because..."), true);
  assert.equal(looksLikeRefusal("Sorry, the master CV does not support the required skills."), true);
  assert.equal(looksLikeRefusal("Backend Engineer | Acme | 2022 – Present\n• Cut latency 40%."), false);
  assert.equal(looksLikeRefusal("Languages: Java, SQL | Frameworks: Spring Boot"), false);
  assert.equal(looksLikeRefusal("Dear Hiring Manager,\n\nI am writing about the Platform Engineer role."), false);
  assert.equal(looksLikeRefusal(null), false);
  assert.ok(/NOT a reason to refuse/.test(renderClaimsBlock({ version: 1, confirmedAt: null, seededFrom: null, skills: [{ name: "Go", level: "learning", confirmed: true }] })));
  assert.ok(/NOT a reason to refuse/.test(DEFAULT_CLAIMS_BLOCK));
});

test("renderClaimsBlock lists the three levels and falls back to the generic rule", () => {
  assert.equal(renderClaimsBlock(null), DEFAULT_CLAIMS_BLOCK);
  const block = renderClaimsBlock({
    version: 1,
    confirmedAt: null,
    seededFrom: null,
    skills: [
      { name: "Java", level: "production", confirmed: true },
      { name: "Docker", level: "project", confirmed: true },
      { name: "Kafka", level: "learning", confirmed: true },
    ],
  });
  assert.ok(/PRODUCTION[^\n]*Java/.test(block));
  assert.ok(/PROJECT-ONLY[^\n]*Docker/.test(block));
  assert.ok(/LEARNING - FORBIDDEN[^\n]*Kafka/.test(block));
});
