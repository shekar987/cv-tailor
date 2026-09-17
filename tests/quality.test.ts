// Unit tests for the tailored-output quality checks (Brief 3). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatePages,
  findDuplicateContent,
  hasEvidence,
  weakBullets,
  inflationHits,
  orderingSignature,
  orderingDiffers,
  qualityReport,
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

test("qualityReport bundles everything", () => {
  const r = qualityReport({ summary: "An expert engineer.", skills: "Go", experience: role("Engineer", ["Worked on things."]), projects: {} }, profile, "Dear team, I am passionate.");
  assert.equal(r.weakBullets.length, 1);
  assert.deepEqual(r.inflation.map((h) => h.word), ["expert", "passionate"]);
  assert.equal(typeof r.pages.pages, "number");
});
