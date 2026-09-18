// Unit tests for the claims registry and the deterministic claim check.
// node:test, zero dependencies: `npm test`. Every CV here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFigures,
  checkClaims,
  seedClaims,
  seedClaimsFromCv,
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
  for (const expect of ["40%", "200 ms", "120 ms", "£2.3 m", "150 k", "1200 order", "3 x", "99.9%", "5 yr", "$1 bn", "2.5 x"]) {
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

test("extractFigures: 'from 40 minutes to 8' registers 8 min; a describing word between number and noun still counts", () => {
  assert.ok(keys("Deploy time cut from 40 minutes to 8.").includes("8 min"));
  assert.ok(keys("MTTR from 95 minutes to 22 after the rota change").includes("22 min"));
  assert.ok(keys("Caught 3 drift incidents before customers did").includes("3 incident"));
  assert.ok(keys("Covering the 12 core journeys").includes("12 journey"));
  assert.ok(!keys("Cut p95 from 900ms to 380ms").includes("380"), "unit already present is left alone");
  assert.ok(keys("Cut p95 from 900ms to 380ms").includes("380 ms"));
  // a unit word is never the describing word; years never start a count
  assert.deepEqual(keys("3 million rows a month"), ["3 m"]);
  assert.deepEqual(keys("a 6-million-shopper marketplace"), ["6 m"]);
  // the second number's own unit is kept intact
  assert.deepEqual(keys("on-time delivery went from 82% to 99.5%"), ["82%", "99.5%"]);
  assert.ok(keys("Trained 8 analysts on dbt.").includes("8 analyst"));
  assert.deepEqual(keys("Sep 2021 – Present\nShipped the card-fraud model"), []);
  // a bare number in the output matches the source's counted figure
  const cv = "• Refreshing 320 features hourly.";
  assert.deepEqual(checkClaims([{ where: "cv", text: "Built a pipeline refreshing 320 hourly." }], null, [cv]).numberViolations, []);
  assert.equal(checkClaims([{ where: "cv", text: "Built a pipeline refreshing 340 hourly." }], null, [cv]).numberViolations.length, 1);
  // a swapped count noun is the same figure; a swapped real unit is not
  const cv2 = "• Deployed 14 model versions with MLflow at 40ms p99.";
  assert.deepEqual(checkClaims([{ where: "cv", text: "Shipped 14 versions with MLflow." }], null, [cv2]).numberViolations, []);
  assert.equal(checkClaims([{ where: "cv", text: "Shipped 14 services." }], null, [cv2]).numberViolations.length, 0, "count-noun swap is tolerated by design");
  assert.equal(checkClaims([{ where: "cv", text: "Served at 40 requests p99." }], null, [cv2]).numberViolations.length, 1, "ms → requests is a different claim");
  // several describing words (a tool name, an adjective chain) before the
  // count noun still make it that count — the owner's real CV lines
  const cv3 = "• Covered by 90+ Jest and React Testing Library automated tests; evaluated 11 industry asset-management platforms.";
  assert.deepEqual(keys(cv3), ["90 test", "11 platform"]);
  assert.deepEqual(checkClaims([{ where: "cv", text: "Validated by 90+ tests across 11 platforms." }], null, [cv3]).numberViolations, []);
  assert.equal(checkClaims([{ where: "cv", text: "Validated by 95+ tests." }], null, [cv3]).numberViolations.length, 1);
});

test("checkClaims: a part's extra sources (the JD for the cover letter) register the posting's own facts", () => {
  const cv = "• Cut p95 API latency by 40%.";
  const jd = "Our storefront serves 4 million shoppers a month across 14 product teams.";
  const letter = "You serve 4 million shoppers across 14 product teams; I cut latency 40%.";
  const without = checkClaims([{ where: "coverLetter", text: letter }], null, [cv]);
  assert.deepEqual(without.numberViolations.filter((n) => n.kind === "absent").map((n) => n.figure), ["4 million", "14 product"]);
  const withJd = checkClaims([{ where: "coverLetter", text: letter, extraSources: [jd] }], null, [cv]);
  assert.deepEqual(withJd.numberViolations.filter((n) => n.kind === "absent"), []);
  // the CV part never gets the JD: the same figure inside the CV is still absent
  const inCv = checkClaims([{ where: "cv", text: "• Served 4 million shoppers." }, { where: "coverLetter", text: "", extraSources: [jd] }], null, [cv]);
  assert.equal(inCv.numberViolations.length, 1);
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
  // Levels exist, so the check is blocking - confirmation is a review, not the switch.
  const enforce = checkClaims(out, unconfirmed, [cv]);
  assert.equal(enforce.mode, "enforce");
  assert.equal(enforce.skillViolations.length, 1);
  assert.equal(enforce.skillViolations[0].skill, "Kubernetes");
  assert.equal(enforce.skillViolations[0].level, "learning");
  assert.match(enforce.skillViolations[0].claim, /K8s clusters/);
  assert.equal(enforce.blocking, true);

  const confirmed: ClaimsRegistry = { ...unconfirmed, confirmedAt: "2026-09-17T00:00:00Z", skills: unconfirmed.skills.map((s) => ({ ...s, confirmed: true })) };
  assert.equal(checkClaims(out, confirmed, [cv]).blocking, true);
  assert.equal(checkClaims([{ where: "cv", text: "Built Python tooling." }], confirmed, [cv]).blocking, false);
  // an absent figure blocks whenever levels exist; with no registry it only warns
  assert.equal(checkClaims([{ where: "cv", text: "Cut costs 35% with Python tooling" }], confirmed, [cv]).blocking, true);
  assert.equal(checkClaims([{ where: "cv", text: "Cut costs 35% with Python tooling" }], null, [cv]).blocking, false);
  // no registry: figures are still checked, skills are not, nothing blocks
  const none = checkClaims(out, null, [cv]);
  assert.equal(none.skillViolations.length, 0);
  assert.equal(none.mode, "warn");
  const empty: ClaimsRegistry = { version: 1, skills: [], confirmedAt: null, seededFrom: null };
  assert.equal(claimMode(empty), "warn");
});

test("checkClaims: a project-only skill claimed above its level blocks and names the claim", () => {
  const cv = `SKILLS
Core: Python, FastAPI
PROJECTS
RideX
React 19, Firebase
- Built a three-portal marketplace in React.`;
  const registry: ClaimsRegistry = {
    version: 1,
    skills: [
      { name: "Python", level: "production", confirmed: false },
      { name: "React", level: "project", confirmed: false },
    ],
    confirmedAt: null,
    seededFrom: null,
  };
  // Written into the work-experience section: a production claim.
  const asWork = checkClaims(
    [{ where: "cv", text: "Backend Engineer | Acme | 2022 – Present\n• Built React dashboards for 3 enterprise workflow areas.", experience: "Backend Engineer | Acme | 2022 – Present\n• Built React dashboards for 3 enterprise workflow areas." }],
    registry,
    [cv]
  );
  assert.equal(asWork.skillViolations.length, 1);
  assert.equal(asWork.skillViolations[0].level, "project");
  assert.match(asWork.skillViolations[0].claim, /^written as work experience: "Built React dashboards/);
  assert.equal(asWork.blocking, true);
  // Proficiency wording anywhere: a competency claim.
  for (const line of ["Proficient in React and Python.", "Two years' industry experience building React frontends.", "Strong React skills."]) {
    const c = checkClaims([{ where: "coverLetter", text: line }], registry, [cv]);
    assert.equal(c.skillViolations.length, 1, line);
    assert.match(c.skillViolations[0].claim, /^described as a competency/);
  }
  // The honest framing passes: built <project> with X, or listed in skills.
  for (const line of ["Built RideX, a three-portal marketplace, in React.", "Skills: Python, FastAPI, React"]) {
    assert.equal(checkClaims([{ where: "cv", text: line, experience: "" }], registry, [cv]).skillViolations.length, 0, line);
  }
  // A production skill is never a violation.
  assert.equal(checkClaims([{ where: "cv", text: "Proficient in Python.", experience: "• Proficient in Python." }], registry, [cv]).skillViolations.length, 0);
});

test("figures: a count noun in an achievement sentence is not a skill claim, and a swapped noun is the same count", () => {
  // The owner's real false positive: "11 tools" flagged against this CV line.
  const cv = "• Analysed 11 industry asset-management platforms (Axonius, Qualys, Tenable, runZero) from verified user reviews and industry reports.";
  const c = checkClaims([{ where: "cv", text: "Evaluated 11 tools across the cyber asset-management market." }], null, [cv]);
  assert.deepEqual(c.numberViolations, []);
  // And the skills seed never reads that sentence: no skill named "platforms" or "tools".
  const seeded = seedClaimsFromCv(`SKILLS\nPython, FastAPI\nEXPERIENCE\nResearch Assistant | UEL | 2026 – Present\n${cv}`);
  assert.deepEqual(seeded.skills.map((s) => s.name), ["Python", "FastAPI"]);
});

test("seedClaimsFromCv: every skill in the skills section and tech lines, levels from where the CV shows them used", () => {
  const cv = `SOMA SHEKAR
Full-Stack Engineer

SKILLS
Core: Python · FastAPI · REST API design · React · TypeScript · SQL (PostgreSQL, MySQL) · Redis
AI & LLM: Anthropic Claude API · LangChain
Currently studying: Kubernetes

EXPERIENCE
Full Stack Engineer — Brane Group
Jul 2023 – Sep 2024 (full-time)
- Engineered backend services in Python, FastAPI, React and TypeScript, delivering 20+ production API modules.
- Optimised data access across PostgreSQL, MySQL and Redis using indexing and caching.

PROJECTS
Jobhuntz — Full-Stack AI Application · 2026
Next.js 16, TypeScript, Supabase (Postgres, Auth, RLS), Anthropic Claude API, Vercel
Live: https://www.jobhuntz.app/
- Architected an 8-step LLM pipeline with the Anthropic Claude API.
RideX — Ride-Hailing Platform · 2025
React 19, Firebase, Stripe
- Built a three-portal marketplace.

EDUCATION
MSc Computer Science — University of East London`;
  const seed = seedClaimsFromCv(cv);
  const level = Object.fromEntries(seed.skills.map((s) => [s.name, s.level]));
  assert.equal(level["Python"], "production");
  assert.equal(level["FastAPI"], "production");
  assert.equal(level["TypeScript"], "production");
  assert.equal(level["PostgreSQL"], "production");
  assert.equal(level["Redis"], "production");
  assert.equal(level["SQL"], "project", "listed only");
  assert.equal(level["Anthropic Claude API"], "project", "only under Projects");
  assert.equal(level["LangChain"], "project", "listed, never shown used");
  assert.equal(level["Next.js"], "project", "from a project's tech line");
  assert.equal(level["Supabase"], "project");
  assert.equal(level["Firebase"], "project");
  assert.equal(level["Kubernetes"], "learning", "the CV's own 'currently studying' line wins");
  assert.ok(!("Jobhuntz — Full-Stack AI Application" in level), "a project title line is not a tech line");
  assert.ok(!("2026" in level));
  assert.ok(seed.skills.every((s) => !s.confirmed));
  assert.equal(claimMode(seed), "enforce", "levels exist, so the check blocks");
  // The extraction model's extra guesses are held at what the CV evidences.
  const withModel = seedClaimsFromCv(cv, [
    { name: "Docker", level: "production" }, // never shown in experience -> project
    { name: "Python", level: "learning" }, // already seeded from the CV -> ignored
    { name: "Terraform", level: "learning" },
  ]);
  const lv = Object.fromEntries(withModel.skills.map((s) => [s.name, s.level]));
  assert.equal(lv["Docker"], "project");
  assert.equal(lv["Python"], "production");
  assert.equal(lv["Terraform"], "learning");
  assert.deepEqual(seedClaimsFromCv("").skills, []);
  // A CV with no headings: an inline "Skills:" line is the skills section and
  // the rest is its work history.
  const flat = "SMOKE TESTER\nBackend Engineer — London\n\nSkills: Python 3, Django, PostgreSQL, Docker, AWS\nCurrently studying: Kubernetes, Kafka\n\nBackend Engineer | Acme | 2022 – Present\n• Built RESTful APIs in Django with unit tests (92% coverage).";
  const fl = Object.fromEntries(seedClaimsFromCv(flat).skills.map((s) => [s.name, s.level]));
  assert.equal(fl["Django"], "production");
  assert.equal(fl["Python"], "project", "version suffix dropped; only listed");
  assert.equal(fl["Kubernetes"], "learning");
  assert.equal(fl["Kafka"], "learning");
  // "Machine Learning (NPTEL)" is a subject, not a learning line.
  const certs = "SKILLS\nAWS, Python\nCERTIFICATIONS\nAWS Certified AI Practitioner · Machine Learning (NPTEL) · Deep Learning (NPTEL)";
  assert.equal(learningText(certs), "");
  assert.equal(Object.fromEntries(seedClaimsFromCv(certs).skills.map((s) => [s.name, s.level]))["AWS"], "project");
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
  assert.equal(claimMode(seed), "enforce", "levels exist, so the check blocks");
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
