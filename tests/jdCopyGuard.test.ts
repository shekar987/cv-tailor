// Unit tests for the JD-copy guard (lib/jdCopyGuard): a letter or summary
// sentence that states a posting requirement as the candidate's own work when
// the master CV never shows it. Modelled on the Maven Securities letter of
// 30 Sep 2026 with a synthetic CV. node:test, zero dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jdCopyTerms, jdCopyHits, jdCopyProblems } from "../src/lib/jdCopyGuard.ts";
import { buildEvidenceMap } from "../src/lib/evidenceMap.ts";
import { supportSentences, decideSupport, normalizeSupportVerdicts, isJdCopyProblem, JD_COPY_PROBLEM } from "../src/lib/supportCheck.ts";

const CV = `Alex Example
Software Engineer — Northwind Labs · Jul 2023 – Present
- Built REST services in Python and FastAPI, cutting response times by 25%
- Optimised PostgreSQL queries with indexing and caching, improving read times by 30%

Projects
RideX (personal project) — Python, FastAPI, PostgreSQL
- Built a ride-pricing service that priced 1,200 test journeys against a distance model
- Wrote the pricing rules as a Python module with unit tests

Skills
Technical Tools: Python | FastAPI | PostgreSQL | Git`;

const ANALYSIS = {
  role_title: "Low-Latency Developer",
  required_skills: ["Python", "low-latency trading systems", "C++", "Docker/Kubernetes"],
  nice_to_have_skills: ["pricing algorithms", "strong communication skills"],
  top_15_ats_keywords: ["Python", "containerisation", "exchange market data", "PostgreSQL"],
  key_responsibilities: ["Handle terabytes of exchange traffic daily", "Build REST services in Python", "Investigate latency at nanosecond level"],
};

const evidence = buildEvidenceMap(ANALYSIS, CV, null, null);
const TERMS = jdCopyTerms(ANALYSIS, evidence, [CV]);

const MAVEN = [
  "I also performed nanosecond-level investigations on low-latency trading systems and research on pricing algorithms and strategies in the RideX project.",
  "My experience directly matches the core requirement of handling terabytes of exchange traffic and I have handled it at scale.",
  "I also bring familiarity with cloud platforms and containerisation (Docker/Kubernetes).",
];

test("terms: the posting's absent requirements and responsibilities, never what the CV shows or the title", () => {
  const names = TERMS.map((t) => t.term);
  assert.ok(names.includes("low-latency trading systems"), names.join(" | "));
  assert.ok(names.includes("Docker/Kubernetes"));
  assert.ok(names.includes("C++"));
  assert.ok(names.includes("containerisation"));
  assert.ok(names.includes("Handle terabytes of exchange traffic daily"));
  assert.ok(names.includes("Investigate latency at nanosecond level"));
  assert.ok(!names.includes("Python"), "Python is in the CV");
  assert.ok(!names.includes("PostgreSQL"));
  // The whole-term read is deliberate: "ride-pricing service" is not
  // "pricing algorithms", so the letter may not claim the latter.
  assert.ok(names.includes("pricing algorithms"));
  assert.ok(!names.includes("Low-Latency Developer"), "the title is never a term");
  assert.ok(!names.some((n) => /communication/i.test(n)), "a soft skill is never a term");
  assert.ok(!names.includes("Build REST services in Python"), "a responsibility the CV's own bullet carries");
});

test("the three Maven sentences are caught, each with the term it claims", () => {
  const hits = MAVEN.map((s) => jdCopyHits(s, "coverLetter", TERMS));
  assert.ok(hits[0].includes("low-latency trading systems"), hits[0].join(" | "));
  assert.ok(hits[1].includes("Handle terabytes of exchange traffic daily"), hits[1].join(" | "));
  assert.ok(hits[2].includes("Docker/Kubernetes"), hits[2].join(" | "));
  assert.ok(hits[2].includes("containerisation"));
  for (const s of MAVEN) {
    const p = jdCopyProblems(s, "coverLetter", TERMS);
    assert.equal(p.length, 1);
    assert.ok(p[0].startsWith(JD_COPY_PROBLEM));
  }
});

test("not a claim: applying for the role, the company's own work, wanting to learn, true CV facts", () => {
  const clean = [
    "I am applying for the Low-Latency Developer role at Maven Securities.",
    "Your systems handle terabytes of exchange traffic every day, which is what draws me to the team.",
    "I would welcome the chance to learn Kubernetes on the job.",
    "At RideX I built the pricing service in Python with unit tests.",
    "Your team built low-latency trading systems that I would love to join.",
    "I am available to start immediately.",
  ];
  for (const s of clean) assert.deepEqual(jdCopyHits(s, "coverLetter", TERMS), [], s);
});

test("the summary needs no pronoun: naming an absent requirement there is the claim", () => {
  assert.deepEqual(jdCopyHits("Software Engineer with familiarity with Docker/Kubernetes and Python.", "summary", TERMS), ["Docker/Kubernetes"]);
  assert.deepEqual(jdCopyHits("Software Engineer with two years' Python and PostgreSQL experience.", "summary", TERMS), []);
});

test("supportSentences carries the guard's problems, and they are must-go", () => {
  const letter = `Dear Maven team,\n${MAVEN[0]}\nAt Northwind Labs I cut response times by 25% by rebuilding REST services in FastAPI.\nKind regards,\nAlex Example`;
  const facts = { projects: [], paidWork: "", extraLint: (s: string, section: "summary" | "coverLetter") => jdCopyProblems(s, section, TERMS) };
  const sentences = supportSentences("", letter, facts);
  assert.equal(sentences.length, 2);
  assert.ok(isJdCopyProblem(sentences[0]));
  assert.equal(sentences[1].problems.length, 0);
  const accept = (s: { section: "summary" | "coverLetter" }, fix: string) => jdCopyHits(fix, s.section, TERMS).length === 0;

  // The Claude path: the model answers. A fix still naming the term is
  // refused and the sentence goes; a fix that keeps only the RideX fact is
  // taken; a sentence the model never listed goes too.
  const stillClaims = normalizeSupportVerdicts(
    { checks: [{ id: "l1", supported: false, support: [], fix: "I performed investigations on low-latency trading systems in the RideX project." }, { id: "l2", supported: true, support: ["cutting response times by 25%"] }] },
    sentences
  );
  let d = decideSupport(sentences, stillClaims, [CV], accept);
  assert.equal(d[0].action, "remove");
  assert.equal(d[1].action, "keep");
  const honest = normalizeSupportVerdicts(
    { checks: [{ id: "l1", supported: false, support: [], fix: "In the RideX project I built a ride-pricing service in Python with unit tests." }, { id: "l2", supported: true, support: ["cutting response times by 25%"] }] },
    sentences
  );
  d = decideSupport(sentences, honest, [CV], accept);
  assert.equal(d[0].action, "rewrite");
  assert.ok(d[0].replacement?.startsWith("In the RideX project"));
  const unlisted = normalizeSupportVerdicts({ checks: [{ id: "l2", supported: true, support: ["cutting response times by 25%"] }] }, sentences);
  assert.equal(decideSupport(sentences, unlisted, [CV], accept)[0].action, "remove");

  // The OpenRouter / failed-call path: no verdicts at all. The guard still
  // removes the claim and leaves the true sentence alone.
  d = decideSupport(sentences, new Map(), [CV], accept);
  assert.equal(d[0].action, "remove");
  assert.equal(d[1].action, "keep");
  assert.equal(normalizeSupportVerdicts({}, sentences).size, 0, "a reply with no checks array is no check");
});

test("all three Maven sentences go on the failed-call path; a narrating one is trimmed, not deleted", () => {
  const letter = `Dear Maven team,\n${MAVEN.join(" ")}\nAt Northwind Labs I cut response times by 25%, which shows a proven track record.\nKind regards,\nAlex Example`;
  const facts = { projects: [], paidWork: "", extraLint: (s: string, section: "summary" | "coverLetter") => jdCopyProblems(s, section, TERMS) };
  const sentences = supportSentences("", letter, facts);
  const d = decideSupport(sentences, new Map(), [CV]);
  assert.deepEqual(d.slice(0, 3).map((x) => x.action), ["remove", "remove", "remove"]);
  assert.equal(d[3].action, "rewrite");
  assert.equal(d[3].replacement, "At Northwind Labs I cut response times by 25%.");
});

test("a responsibility carried across two adjacent CV lines is not a copy term (review, 1 Oct)", () => {
  const cv = "EXPERIENCE\nEngineer | Acme | 2022 – Present\n- Shipped features with the product team for 10k users\n- Paired with designers on the checkout redesign";
  const analysis = { required_skills: [], nice_to_have_skills: [], top_15_ats_keywords: [], key_responsibilities: ["Work closely with product and design teams to ship features"] };
  const terms = jdCopyTerms(analysis, { items: [] } as never, [cv]);
  assert.deepEqual(terms.filter((t) => t.from === "responsibility"), []);
});
