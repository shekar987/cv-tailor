// A CareerSet CV always has a summary (lib/summaryFallback, 31 Oct 2026). The 30
// Oct Burendo run had none. Fixtures are a made-up CV.
import test from "node:test";
import assert from "node:assert/strict";
import { ensureSummary, masterSummary, summaryHasContent, topLanguages } from "../src/lib/summaryFallback.ts";
import { availabilityCvSentence } from "../src/lib/rightToWorkText.ts";
import { normalizeEligibility } from "../src/lib/knockouts.ts";
import { STYLE_RULES } from "../src/lib/formatStyles/ids.ts";

const MASTER = `ALEX MORGAN
alex.morgan@example.com

PROFESSIONAL SUMMARY
Full stack engineer with two years building Python and TypeScript services at Northgate Systems. Shipped 20+ production API modules with FastAPI and React. Holds a Student visa with the right to work full time in the UK.

SKILLS
Languages: Python, TypeScript, SQL, JavaScript, HTML
Frameworks: FastAPI, React, Next.js

EXPERIENCE
Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Delivered 20+ production API modules using Python, FastAPI, React and TypeScript

EDUCATION
BTech Computer Science — Riverside Institute of Technology`;

const NO_SUMMARY = MASTER.replace(/PROFESSIONAL SUMMARY[\s\S]*?\n\nSKILLS/, "SKILLS");

// The availability sentence comes from the Eligibility answer, as in the route.
const AVAILABLE_NOW = availabilityCvSentence(normalizeEligibility({ availability: { status: "now", from: null }, canWorkFullTime: "yes" }));
const CAPS = { maxWords: STYLE_RULES.careerset.limits.summary.maxWords };

test("only CareerSet rebuilds the summary and checks the header's language; UKJI is unchanged", () => {
  assert.equal(STYLE_RULES.careerset.summary.ensureFromMaster, true);
  assert.equal(STYLE_RULES.ukji.summary.ensureFromMaster, false);
});

test("fixture tailor with an empty summary: the master's first summary line, ending with the availability sentence", () => {
  assert.equal(AVAILABLE_NOW, "Available immediately for full-time employment.");
  const r = ensureSummary("", { cv: MASTER, availabilityLine: AVAILABLE_NOW, recentRoleHeader: "Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024", ...CAPS });
  assert.equal(r.report.rebuilt, true, "flagged in the response as summaryRebuild");
  assert.equal(r.report.source, "master_summary");
  assert.equal(r.summary, "Full stack engineer with two years building Python and TypeScript services at Northgate Systems.\nAvailable immediately for full-time employment.");
  assert.ok(r.summary.trim().length > 0);
  assert.ok(r.summary.endsWith("Available immediately for full-time employment."));
  // A missing summary (the model's step failed) is rebuilt the same way.
  assert.equal(ensureSummary(undefined, { cv: MASTER, availabilityLine: AVAILABLE_NOW, ...CAPS }).summary, r.summary);
});

test("a summary left with only the availability sentence counts as empty", () => {
  assert.equal(summaryHasContent(AVAILABLE_NOW, AVAILABLE_NOW), false);
  const r = ensureSummary(AVAILABLE_NOW, { cv: MASTER, availabilityLine: AVAILABLE_NOW, ...CAPS });
  assert.equal(r.report.rebuilt, true);
  assert.equal(r.summary.split(AVAILABLE_NOW!).length, 2, "the availability sentence once");
});

test("the master's own right-to-work line is never the one taken", () => {
  const visaFirst = MASTER.replace("PROFESSIONAL SUMMARY\n", "PROFESSIONAL SUMMARY\nHolds a Student visa with the right to work in the UK. ");
  const r = ensureSummary("", { cv: visaFirst, availabilityLine: AVAILABLE_NOW, ...CAPS });
  assert.doesNotMatch(r.summary, /visa/i);
  assert.match(r.summary, /^Full stack engineer with two years/);
});

test("no summary section in the master: one line from the latest role and top languages", () => {
  assert.equal(masterSummary(NO_SUMMARY), "");
  const r = ensureSummary(null, { cv: NO_SUMMARY, availabilityLine: AVAILABLE_NOW, recentRoleHeader: "Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024", ...CAPS });
  assert.equal(r.report.source, "master_role");
  assert.equal(r.summary, "Full Stack Engineer at Northgate Systems, working with Python and TypeScript.\nAvailable immediately for full-time employment.");
});

test("a summary with content is never touched; nothing to rebuild from leaves it as it was", () => {
  const s = "Full stack engineer shipping Python services.\n" + AVAILABLE_NOW;
  assert.deepEqual(ensureSummary(s, { cv: MASTER, availabilityLine: AVAILABLE_NOW, ...CAPS }), { summary: s, report: { rebuilt: false, source: null } });
  const r = ensureSummary("", { cv: "SKILLS\nFastAPI", availabilityLine: null, recentRoleHeader: null, ...CAPS });
  assert.equal(r.summary, "");
  assert.equal(r.report.rebuilt, false);
});

test("topLanguages: the skills list's first three languages, markup skipped", () => {
  assert.deepEqual(topLanguages(MASTER), ["Python", "TypeScript"], "SQL is listed but no paid role shows it");
  assert.deepEqual(topLanguages("SKILLS\nGo-to-market strategy, React"), []);
});


test("a learning or project-only language is never one of the top languages", () => {
  const cv = `SKILLS
Languages: Python, SQL
Currently learning: Go, Rust

EXPERIENCE
Software Engineer | Acme Ltd | Jan 2023 – Present
• Built Python services backed by SQL reporting

PROJECTS
Side Project
Tech: TypeScript, React`;
  assert.deepEqual(topLanguages(cv), ["Python", "SQL"]);
  const r = ensureSummary("", { cv, availabilityLine: null, recentRoleHeader: "Software Engineer | Acme Ltd | Jan 2023 – Present", ...CAPS });
  assert.equal(r.summary, "Software Engineer at Acme Ltd, working with Python and SQL.");
});

test("the first line keeps 'Node.js' and '3.5 years' whole", () => {
  const cv = MASTER.replace(/PROFESSIONAL SUMMARY\n.*\n/, "PROFESSIONAL SUMMARY\nFull-stack developer building Node.js and React apps for 3.5 years at Acme. Second sentence here.\n");
  const r = ensureSummary("", { cv, availabilityLine: AVAILABLE_NOW, ...CAPS });
  assert.equal(r.summary, "Full-stack developer building Node.js and React apps for 3.5 years at Acme.\nAvailable immediately for full-time employment.");
});

test("a 'Title at Employer (dates)' header gives the title and employer, never the dates", () => {
  const r = ensureSummary(null, { cv: NO_SUMMARY, availabilityLine: null, recentRoleHeader: "Full Stack Engineer at Northgate Systems (Jul 2022 – Sep 2024)", ...CAPS });
  assert.equal(r.summary, "Full Stack Engineer at Northgate Systems, working with Python and TypeScript.");
});
