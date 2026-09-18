// Unit tests for the tailored-output quality checks (Brief 3). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatePages,
  onePageExpected,
  findDuplicateContent,
  hasEvidence,
  weakBullets,
  inflationHits,
  orderingSignature,
  orderingDiffers,
  qualityReport,
  isRelevanceBoltOn,
  relevanceBoltOns,
  lintBullets,
  countFlags,
} from "../src/lib/quality.ts";

const profile = {
  tagline: "Backend Engineer",
  location: "London",
  email: "x@example.com",
  education: [{ degree: "MSc Computer Science", institution: "UEL", note: "Dissertation: Widget Tracker service" }],
  certifications: ["AWS Solutions Architect"],
  rightToWork: ["UK: full right to work"],
  projects: [{ name: "Widget Tracker | 2024", tech: "Go, Postgres" }, { name: "RideX | 2025", tech: "React" }],
  extraSections: [],
};
const bullet = (s: string) => `• ${s}`;
const role = (name: string, bullets: string[]) => [`${name} | Acme | 2022 – Present`, ...bullets.map(bullet)].join("\n");

test("estimatePages: a short CV renders under two pages, a huge one is over budget", () => {
  const short = estimatePages({ summary: "One line.", skills: "Python", experience: role("Engineer", ["Cut latency 40%."]), projects: {} }, profile);
  assert.ok(short.pages > 0 && short.pages <= 2.05, String(short.pages));
  assert.equal(short.overBudget, false);
  const bullets = Array.from({ length: 60 }, (_, i) => `Did a substantial piece of work number ${i} with a long explanation that wraps onto a second line easily.`);
  const huge = estimatePages({ summary: "x", skills: "y", experience: role("Engineer", bullets) + "\n" + role("Lead", bullets), projects: {} }, profile);
  assert.equal(huge.overBudget, true);
  assert.ok(huge.pages > 2.5, String(huge.pages));
  // fitsOnePage is measured at the tightest spacing, independent of the
  // stretch `pages` reports: the short CV fits one page even though the
  // builders would pad it towards two; the huge one cannot.
  assert.equal(short.fitsOnePage, true);
  assert.equal(huge.fitsOnePage, false);
  const medium = estimatePages(
    { summary: "x", skills: "y", experience: role("Engineer", bullets.slice(0, 14)) + "\n" + role("Lead", bullets.slice(0, 14)), projects: {} },
    profile
  );
  assert.equal(medium.overBudget, false);
  assert.equal(medium.fitsOnePage, false, String(medium.bodyLines));
});

test("onePageExpected: only a stated figure under three years, never a guess", () => {
  assert.equal(onePageExpected(2), true);
  assert.equal(onePageExpected(0), true);
  assert.equal(onePageExpected(3), false);
  assert.equal(onePageExpected(7), false);
  assert.equal(onePageExpected(null), false);
  assert.equal(onePageExpected(undefined), false);
  assert.equal(onePageExpected(NaN), false);
});

test("findDuplicateContent: a project written up under experience or education, and a repeated bullet", () => {
  const exp = role("Engineer", ["Built the Widget Tracker service in Go for 2k daily users.", "Cut deploy time 40% with GitHub Actions."]);
  const d = findDuplicateContent({ experience: exp, projects: { "0": ["Cut deploy time 40% with GitHub Actions."] } }, profile);
  assert.deepEqual(
    d.map((x) => [x.kind, x.text]),
    [["project_in_experience", "Widget Tracker"], ["project_in_education", "Widget Tracker"], ["repeated_bullet", "Cut deploy time 40% with GitHub Actions."]]
  );
  assert.deepEqual(findDuplicateContent({ experience: role("Engineer", ["Shipped things."]), projects: {} }, { ...profile, education: [] }), []);
});

test("hasEvidence: a number, a scale or a named system; weak bullets are the rest", () => {
  assert.equal(hasEvidence("Cut p95 latency by 40% by restructuring the service layer."), true);
  assert.equal(hasEvidence("Migrated services to Kubernetes with zero downtime."), true);
  assert.equal(hasEvidence("Served 2 million users across three regions."), true);
  assert.equal(hasEvidence("Built RESTful APIs in Django."), true);
  assert.equal(hasEvidence("Worked closely with stakeholders to deliver value."), false);
  assert.equal(hasEvidence("Improved code quality through reviews."), false);
  const weak = weakBullets(role("Engineer", ["Worked closely with stakeholders to deliver value.", "Cut latency 40%."]), { "0": ["Collaborated across the team."] });
  assert.deepEqual(weak, ["Worked closely with stakeholders to deliver value.", "Collaborated across the team."]);
});

test("inflationHits counts the words a recruiter reads past", () => {
  const hits = inflationHits("A results-driven, passionate expert leveraging cutting-edge tooling at scale. Passionate about seamless delivery.");
  assert.deepEqual(hits.map((h) => `${h.word}:${h.count}`), ["passionate:2", "at-scale:1", "cutting-edge:1", "expert:1", "leveraging:1", "results-driven:1", "seamless:1"]);
  assert.deepEqual(inflationHits("Cut latency 40% with PostgreSQL indexing."), []);
});

test("orderingSignature / orderingDiffers compare the first bullets per role", () => {
  const a = role("Engineer", ["Alpha bullet one.", "Beta bullet two.", "Gamma three.", "Delta four."]);
  const b = role("Engineer", ["Gamma three.", "Alpha bullet one.", "Beta bullet two.", "Delta four."]);
  assert.deepEqual(orderingSignature(a), [["alpha bullet one.", "beta bullet two.", "gamma three."]]);
  assert.equal(orderingDiffers(a, b), true);
  assert.equal(orderingDiffers(a, a), false);
  assert.equal(orderingDiffers("", a), false);
});

test("relevance bolt-ons: a bullet that ends by narrating its relevance to the employer is rejected", () => {
  // The three real tails from one generated CV — the clearest tool signal in the document.
  const boltOns = [
    "Built a document parser handling 250k pages with idempotent retries - directly applicable to Seamflow's technical file review and evidence mapping workflows",
    "Secured multi-tenant data with row-level security and AES-256-GCM encryption - the production-grade compliance and data isolation Seamflow's regulated customers demand",
    "Engineered an 8-step LLM pipeline with structured JSON contracts between steps - core patterns for Seamflow's certification workflow automation and scheduling agents",
  ];
  for (const b of boltOns) {
    assert.equal(isRelevanceBoltOn(b), true, b);
    assert.equal(isRelevanceBoltOn(b, "Seamflow"), true, b);
  }
  assert.deepEqual(relevanceBoltOns(role("Engineer", boltOns), {}), boltOns);
  assert.deepEqual(relevanceBoltOns("", { "0": [boltOns[0]] }, "Seamflow Ltd"), [boltOns[0]]);
  // Other shapes of the same move.
  assert.equal(isRelevanceBoltOn("Shipped the checkout flow in 6 weeks, exactly what this role needs."), true);
  assert.equal(isRelevanceBoltOn("Ran 40 Kubernetes services — mirroring your platform team's stack."), true);
  assert.equal(isRelevanceBoltOn("Cut latency 40%; the reliability your customers expect."), true);
  assert.equal(isRelevanceBoltOn("Built the dispatch service, which Acme's fleet product requires", "Acme"), true);
  // Bullets that state what, how and the result, then stop, pass — including a
  // possessive that is a real system, an em-dash result and a comma clause.
  const clean = [
    "Cut p95 latency by 40% by restructuring the service layer.",
    "Integrated Stripe's Payment Intents API with idempotency keys; no double charges in 12 months.",
    "Built real-time dispatch on Firestore listeners, sub-second sync for 2k drivers — validated by 90+ tests.",
    "Migrated 14 services to Kubernetes with zero downtime, cutting deploy time from 40 minutes to 8.",
    "Delivered the FRMS platform covering 4 resource categories (counters, gates, belts and stands).",
  ];
  for (const b of clean) assert.equal(isRelevanceBoltOn(b, "Seamflow"), false, b);
  assert.deepEqual(relevanceBoltOns(role("Engineer", clean), { "0": clean }, "Seamflow"), []);
});

test("lintBullets flags bolt-ons and filler per bullet, for the one regeneration", () => {
  const exp = role("Engineer", [
    "Built a document parser handling 250k pages - directly applicable to Seamflow's technical file review workflows",
    "Delivered end-to-end ownership of the checkout flow, cutting drop-off 12%.",
    "Cut p95 latency by 40% by restructuring the service layer.",
  ]);
  const l = lintBullets({ experience: exp, projects: { "0": ["A robust, production-grade queue on SQS.", "Processed 3m events a day on SQS."] } }, "Seamflow");
  assert.equal(l.experience.length, 2);
  assert.match(l.experience[0].reasons[0], /narrating its relevance/);
  assert.deepEqual(l.experience[1].reasons, ["filler: end-to-end"]);
  assert.deepEqual(l.projects.map((f) => f.reasons), [["filler: production-grade", "filler: robust"]]);
  assert.equal(countFlags(l), 3);
  assert.equal(countFlags(lintBullets({ experience: role("Engineer", ["Cut p95 latency by 40%."]) })), 0);
});

test("qualityReport bundles everything", () => {
  const r = qualityReport({ summary: "An expert engineer.", skills: "Go", experience: role("Engineer", ["Worked on things."]), projects: {} }, profile, "Dear team, I am passionate.");
  assert.equal(r.weakBullets.length, 1);
  assert.deepEqual(r.inflation.map((h) => h.word), ["expert", "passionate"]);
  assert.equal(typeof r.pages.pages, "number");
  assert.deepEqual(r.boltOns, []);
  const r2 = qualityReport({ experience: role("Engineer", ["Shipped the flow in 6 weeks - core patterns for Acme's scheduling agents."]) }, profile, "", "Acme");
  assert.equal(r2.boltOns.length, 1);
});
