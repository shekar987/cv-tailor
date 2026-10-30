// A CareerSet CV always has a summary (lib/summaryFallback, 31 Oct 2026), and
// its header's stack leads with one of the master CV's top three languages
// (lib/headline leadLanguages). Fixtures are a made-up CV.
import test from "node:test";
import assert from "node:assert/strict";
import { ensureSummary, masterSummary, summaryHasContent, topLanguages } from "../src/lib/summaryFallback.ts";
import { buildHeadline, leadLanguage } from "../src/lib/headline.ts";
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

const AVAILABILITY = "Available immediately for full-time employment.";
const CAPS = { maxSentences: STYLE_RULES.careerset.limits.summary.maxSentences, maxWords: STYLE_RULES.careerset.limits.summary.maxWords };

test("only CareerSet asks for the rebuild and the language lead; UKJI is unchanged", () => {
  assert.equal(STYLE_RULES.careerset.summary.ensureFromMaster, true);
  assert.equal(STYLE_RULES.careerset.headline.leadLanguage, true);
  assert.equal(STYLE_RULES.ukji.summary.ensureFromMaster, false);
  assert.equal(STYLE_RULES.ukji.headline.leadLanguage, false);
});

test("an empty summary is rebuilt from the master CV's own summary, availability last", () => {
  const r = ensureSummary("", { cv: MASTER, availabilityLine: AVAILABILITY, recentRoleHeader: "Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024", ...CAPS });
  assert.equal(r.report.rebuilt, true);
  assert.equal(r.report.source, "master_summary");
  assert.equal(
    r.summary,
    "Full stack engineer with two years building Python and TypeScript services at Northgate Systems. Shipped 20+ production API modules with FastAPI and React.\n" + AVAILABILITY
  );
  assert.doesNotMatch(r.summary, /visa/i, "the master's own right-to-work sentence is skipped");
});

test("a summary left with only the availability sentence counts as empty", () => {
  assert.equal(summaryHasContent(AVAILABILITY, AVAILABILITY), false);
  const r = ensureSummary(AVAILABILITY, { cv: MASTER, availabilityLine: AVAILABILITY, ...CAPS });
  assert.equal(r.report.rebuilt, true);
  assert.ok(r.summary.endsWith(AVAILABILITY));
  assert.equal(r.summary.split(AVAILABILITY).length, 2, "the availability sentence once");
});

test("no summary section in the master: one line from the latest role and top languages", () => {
  assert.equal(masterSummary(NO_SUMMARY), "");
  const r = ensureSummary(null, { cv: NO_SUMMARY, availabilityLine: null, recentRoleHeader: "Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024", ...CAPS });
  assert.equal(r.report.source, "master_role");
  assert.equal(r.summary, "Full Stack Engineer at Northgate Systems, working with Python, TypeScript and SQL.");
});

test("a summary with content is never touched", () => {
  const s = "Full stack engineer shipping Python services.\n" + AVAILABILITY;
  const r = ensureSummary(s, { cv: MASTER, availabilityLine: AVAILABILITY, ...CAPS });
  assert.equal(r.summary, s);
  assert.equal(r.report.rebuilt, false);
});

test("nothing to rebuild from: the summary stays as it was", () => {
  const r = ensureSummary("", { cv: "SKILLS\nFastAPI", availabilityLine: null, recentRoleHeader: null, ...CAPS });
  assert.equal(r.summary, "");
  assert.equal(r.report.rebuilt, false);
});

test("topLanguages: the skills list's first three languages, markup skipped", () => {
  assert.deepEqual(topLanguages(MASTER), ["Python", "TypeScript", "SQL"]);
  assert.deepEqual(topLanguages("SKILLS\nGo-to-market strategy, React"), []);
});

const CLAIMS = {
  skills: [
    { name: "Python", level: "production" },
    { name: "TypeScript", level: "production" },
    { name: "FastAPI", level: "production" },
    { name: "React", level: "production" },
    { name: "SQL", level: "project" },
  ],
};

test("the CareerSet header's stack leads with a production-level top language", () => {
  const base = {
    claims: CLAIMS,
    requiredSkills: ["React", "FastAPI", "AWS"],
    keywords: [],
    yearsExperience: 2,
    heldTitles: ["Full Stack Engineer"],
  };
  const plain = buildHeadline(base, { headlineSeparator: " | " });
  assert.equal(plain.parts.stack, "React, FastAPI", "without the option: posting order alone");
  const led = buildHeadline({ ...base, leadLanguages: topLanguages(MASTER) }, { headlineSeparator: " | " });
  assert.equal(led.parts.stack, "Python, React, FastAPI");
  assert.equal(led.headline, "Full Stack Engineer | 2 years' experience | Python, React, FastAPI");
  // Already in the posting's list: moved to the front, said once.
  const moved = buildHeadline({ ...base, requiredSkills: ["React", "Python", "FastAPI"], leadLanguages: ["Python"] }, { headlineSeparator: " | " });
  assert.equal(moved.parts.stack, "Python, React, FastAPI");
});

test("a project-level or unregistered language never leads", () => {
  assert.equal(leadLanguage(CLAIMS, ["SQL"]), null);
  assert.equal(leadLanguage(CLAIMS, ["Rust", "TypeScript"]), "TypeScript");
  assert.equal(leadLanguage(null, ["Python"]), null);
});
