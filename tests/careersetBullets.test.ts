// The CareerSet bullet rules (lib/formatStyles): the style pass over the
// selected bullets, the lint reasons that drive the one regeneration, the
// budgets the prompts get and the caps the page fit holds. Every test also
// pins the UKJI path: with UKJI's rules each function is the identity it was.
import test from "node:test";
import assert from "node:assert/strict";
import { applyBulletStyle, swapBanned, stripTrailingFullStop, openingVerb, overusedVerbs, bannedWordsIn } from "../src/lib/stylePass.ts";
import { parseMasterExperience, substitutions } from "../src/lib/bulletIds.ts";
import { lintBullets, cvWordCount } from "../src/lib/quality.ts";
import { experienceBudget, projectsBudget, plannedPerProject, styledExperienceCapacity } from "../src/lib/contentBudget.ts";
import { fitTwoPages, fitOnePage, capSummaryWords, bulletCount } from "../src/lib/onePage.ts";
import { CAREERSET } from "../src/lib/formatStyles/careerset.ts";
import { UKJI } from "../src/lib/formatStyles/ukji.ts";

const rules = (s: typeof CAREERSET) => ({ render: s.render, lint: s.lint, limits: s.limits });
const CS = rules(CAREERSET);
const UK = rules(UKJI);

const master = [
  "EXPERIENCE",
  "Full Stack Engineer | Northgate Systems | Jul 2022 – Oct 2024",
  "Highlight: Delivered 20+ production API modules for enterprise platforms using Python and FastAPI.",
  "• Used Python and FastAPI to secure services with JWT authentication, cutting typical API response times by 25%.",
  "• Successfully automated build and release through CI/CD pipelines, cutting deployment time by 40%.",
  "• Supported the data team with PostgreSQL query tuning, making frequently accessed queries 30% faster.",
  "• Responsible for a shared library of React/TypeScript components used across 3+ workflow areas.",
  "• Built a reporting service in Python, built a scheduler, and documented both, etc.",
  "PROJECTS",
].join("\n");
const roles = parseMasterExperience(master);
const experience = [
  "Full Stack Engineer | Northgate Systems | Jul 2022 – Oct 2024",
  "• Highlight: Delivered **20+ production API modules** for enterprise platforms using Python and FastAPI.",
  "• Used Python and FastAPI to secure services with JWT authentication, cutting typical API response times by **25%**.",
  "• Successfully automated build and release through CI/CD pipelines, cutting deployment time by 40%.",
  "• Supported the data team with PostgreSQL query tuning, making frequently accessed queries 30% faster.",
  "• Responsible for a shared library of React/TypeScript components used across 3+ workflow areas.",
  "• Built a reporting service in Python, built a scheduler, and documented both, etc.",
].join("\n");
const projects = { "0": ["Built a RAG pipeline with LangChain that used Supabase for storage.", "Designed an event-driven AWS pipeline with retries…"] };

test("UKJI rules: the style pass is the identity", () => {
  const r = applyBulletStyle({ experience, projects }, UK, roles, ["Jobhuntz"]);
  assert.equal(r.experience, experience);
  assert.equal(r.projects, projects, "the same object comes back");
  assert.deepEqual(r.report, { debolded: 0, highlightsStripped: 0, fullStopsStripped: 0, swapped: [], verbCapped: [], notes: [] });
});

test("CareerSet rules: bold, the Highlight prefix and the trailing full stop go at zero substitutions; banned words swap inside the budget or are reported", () => {
  const r = applyBulletStyle({ experience, projects }, CS, roles, ["Jobhuntz"]);
  const lines = r.experience.split("\n");
  assert.equal(lines[0], "Full Stack Engineer | Northgate Systems | Jul 2022 – Oct 2024", "the header passes through");
  assert.equal(lines[1], "• Delivered 20+ production API modules for enterprise platforms using Python and FastAPI", "no Highlight:, no bold, no full stop");
  assert.equal(lines[2], "• Applied Python and FastAPI to secure services with JWT authentication, cutting typical API response times by 25%", "used → applied, capital kept");
  assert.equal(lines[3], "• Automated build and release through CI/CD pipelines, cutting deployment time by 40%", "successfully dropped, the next word capitalised");
  assert.equal(lines[4], "• Supported the data team with PostgreSQL query tuning, making frequently accessed queries 30% faster", "supported has no honest equivalent: left as written");
  assert.equal(lines[5], "• Owned a shared library of React/TypeScript components used across 3+ workflow areas", "responsible for → owned");
  assert.equal(lines[6], "• Built a reporting service in Python, built a scheduler, and documented both, etc.", "etc. keeps its full stop");
  // Every change stays inside the id protocol's budget: the de-bolded, de-dotted bullets cost nothing.
  const masterBullets = roles[0].bullets.map((b) => b.text);
  assert.equal(substitutions(masterBullets[1], lines[2].replace(/^• /, "")).changed, 1, "one swap");
  assert.equal(substitutions(masterBullets[2], lines[3].replace(/^• /, "")).changed, 1);
  assert.equal(substitutions("Delivered 20+ production API modules for enterprise platforms using Python and FastAPI.", lines[1].replace(/^• /, "")).changed, 0, "bold and the full stop are not tokens");
  assert.equal(r.report.debolded, 2);
  assert.equal(r.report.highlightsStripped, 1);
  assert.equal(r.report.fullStopsStripped, 6, "five experience bullets and one project bullet (etc. and the ellipsis keep theirs)");
  assert.deepEqual(r.report.swapped.map((s) => [s.where, s.from, s.to]), [
    ["experience", "used", "applied"],
    ["experience", "successfully", "(removed)"],
    ["experience", "responsible for", "owned"],
    ["projects", "used", "applied"],
  ]);
  assert.deepEqual(r.projects, { "0": ["Built a RAG pipeline with LangChain that applied Supabase for storage", "Designed an event-driven AWS pipeline with retries…"] });
  const supported = r.report.notes.find((n) => n.bullet.startsWith("Supported"));
  assert.ok(supported && /"supported"/.test(supported.problem) && /customize/.test(supported.problem), JSON.stringify(r.report.notes));
  assert.equal(supported!.owner, "Full Stack Engineer");
  // Idempotent: a second run changes nothing and reports the same notes.
  const again = applyBulletStyle({ experience: r.experience, projects: r.projects }, CS, roles, ["Jobhuntz"]);
  assert.equal(again.experience, r.experience);
  assert.deepEqual(again.projects, r.projects);
  assert.deepEqual(again.report.notes, r.report.notes);
  assert.equal(again.report.debolded + again.report.fullStopsStripped + again.report.swapped.length, 0);
});

test("a swap that would take a master bullet past two changed words is reported, not applied", () => {
  // The bullet already differs from its master by two words ("services" → "endpoints", "typical" → "median").
  const edited = "Full Stack Engineer | Northgate Systems | Jul 2022 – Oct 2024\n• Used Python and FastAPI to secure endpoints with JWT authentication, cutting median API response times by 25%.";
  const r = applyBulletStyle({ experience: edited, projects: {} }, CS, roles);
  assert.match(r.experience, /^• Used Python/m, "kept as written");
  assert.deepEqual(r.report.swapped, []);
  assert.ok(r.report.notes.some((n) => /two-word change/.test(n.problem)), JSON.stringify(r.report.notes));
  // With no master to hold it to, the swap is applied.
  const free = applyBulletStyle({ experience: edited, projects: {} }, CS, []);
  assert.match(free.experience, /^• Applied Python/m);
});

test("the word cap and the opening-verb cap are reported, never rewritten", () => {
  const long = "• " + Array.from({ length: 31 }, (_, i) => `w${i}`).join(" ") + ".";
  const exp = ["Role | Co | 2020 – 2021", long, "• Built a thing", "• Built another thing", "• Built a third thing"].join("\n");
  const r = applyBulletStyle({ experience: exp, projects: { "0": ["Built a fourth, in a project"] } }, CS, []);
  assert.ok(r.report.notes.some((n) => /31 words/.test(n.problem) && /30 or fewer/.test(n.problem) && /customize/.test(n.problem)), JSON.stringify(r.report.notes));
  assert.deepEqual(r.report.verbCapped.map((v) => v.bullet), ["Built a third thing", "Built a fourth, in a project"], "the third and fourth 'Built' bullets, experience then projects");
  assert.ok(r.report.notes.some((n) => n.where === "projects" && /"Built"/.test(n.problem)));
  assert.deepEqual(overusedVerbs(["Built x", "Built y", "built z", "Designed w"], 2), [{ verb: "Built", count: 3 }]);
  assert.equal(openingVerb("• Building a thing"), "build");
  assert.equal(openingVerb("Optimised the thing"), "optimis");
});

test("the helpers: banned words whole-word and case-insensitive, swaps keep case, the full stop rule", () => {
  assert.deepEqual(bannedWordsIn("I used it; it was unused; we worked on it; the workbench", CAREERSET.lint.bannedWords), ["worked on", "used"]);
  assert.equal(swapBanned("Used Docker daily", "used", "applied"), "Applied Docker daily");
  assert.equal(swapBanned("Tests used Docker", "used", "applied"), "Tests applied Docker");
  assert.equal(swapBanned("Successfully shipped it", "successfully", ""), "Shipped it");
  assert.equal(swapBanned("Shipped it successfully, twice", "successfully", ""), "Shipped it, twice");
  assert.equal(swapBanned("Shipped it", "used", "applied"), null);
  assert.equal(stripTrailingFullStop("Done."), "Done");
  assert.equal(stripTrailingFullStop("Done"), "Done");
  assert.equal(stripTrailingFullStop("Done, etc."), "Done, etc.");
  assert.equal(stripTrailingFullStop("Done..."), "Done...");
  assert.equal(stripTrailingFullStop("Shipped v2.1."), "Shipped v2.1");
});

test("lintBullets with the style's rules flags long bullets, banned words and the opening-verb cap across both sections; without them as before", () => {
  const style = { maxWords: CAREERSET.limits.bullets.maxWords, bannedWords: CAREERSET.lint.bannedWords, verbCap: CAREERSET.lint.verbCap };
  const long = Array.from({ length: 31 }, (_, i) => `w${i}`).join(" ");
  const exp = ["Role | Co | 2020 – 2021", `• ${long}`, "• Used Docker daily", "• Built a thing", "• Built another"].join("\n");
  const r = lintBullets({ experience: exp, projects: { "0": ["Built a project thing"] } }, "Co", style);
  const reasons = Object.fromEntries(r.experience.map((f) => [f.bullet.slice(0, 12), f.reasons.join(" / ")]));
  assert.match(reasons["w0 w1 w2 w3 "], /31 words — at most 30/);
  assert.match(reasons["Used Docker "], /"used" is banned/);
  assert.equal(r.projects.length, 1);
  assert.match(r.projects[0].reasons[0], /opens with "Built", already the opening verb of 2 bullets/);
  assert.equal(r.experience.length, 2, "the two Built bullets in experience are within the cap");
  const plain = lintBullets({ experience: exp, projects: { "0": ["Built a project thing"] } }, "Co");
  assert.deepEqual(plain, { experience: [], projects: [] }, "UKJI: none of these is a reason");
});

test("budgets: CareerSet's text carries the total, the word caps and the projects' share; UKJI's text is unchanged", () => {
  const cv = "EXPERIENCE\nA | Co | 2020 – 2021\n• one\n• two\n• three\n• four\n• five\n• six\n• seven\n• eight\n• nine\n• ten\n• eleven\n• twelve\nPROJECTS";
  const csBudget = { maxWords: 30, total: { min: 12, max: 20 }, perProject: { min: 2, max: 4 }, cvMaxWords: 900 };
  const ukBudget = { maxWords: null, total: null, perProject: { min: 1, max: 4 }, cvMaxWords: null };
  assert.equal(experienceBudget(cv, ukBudget, 3), experienceBudget(cv), "UKJI: the same string with or without the style");
  assert.equal(projectsBudget(3, false, ukBudget), projectsBudget(3, false));
  assert.equal(plannedPerProject(3, csBudget), 3);
  assert.equal(plannedPerProject(1, csBudget), 4);
  assert.equal(plannedPerProject(6, csBudget), 2);
  assert.equal(styledExperienceCapacity(csBudget, 3), 11);
  assert.equal(styledExperienceCapacity(csBudget, 0), 20);
  assert.equal(styledExperienceCapacity(csBudget, 5), 10);
  assert.equal(styledExperienceCapacity(csBudget, 7), 8, "never below the floor");
  const text = experienceBudget(cv, csBudget, 3)!;
  assert.match(text, /12-20 bullets ACROSS experience and projects/);
  assert.match(text, /at most 30 words/);
  assert.match(text, /under 900 words/);
  assert.match(text, /keep at most 11 experience bullets/);
  assert.match(text, /Role 1 \(in master-CV order\): at most 11 bullets/);
  assert.match(experienceBudget(cv, csBudget, 0)!, /every bullet from every role fits/);
  const p = projectsBudget(3, false, csBudget);
  assert.match(p, /write 2 to 3 bullets per project/);
  assert.match(p, /at most 30 words/);
  assert.equal(projectsBudget(3, true, csBudget), projectsBudget(3, true), "one page keeps its own text");
});

test("capSummaryWords keeps a protected sentence in place; without protect as before", () => {
  const s = "Full stack engineer with two years at Northgate building Python services and React apps for enterprise platforms.\nShipped twenty API modules and cut response times by a quarter across the FRMS platform.\nBuilt Jobhuntz, a live AI product with an eight-step pipeline across three model providers.\nAvailable immediately for full-time employment.";
  const r = capSummaryWords(s, 30, ["Available immediately for full-time employment."]);
  assert.equal(r.summary, "Full stack engineer with two years at Northgate building Python services and React apps for enterprise platforms.\nAvailable immediately for full-time employment.");
  assert.equal(r.dropped.length, 2);
  const plain = capSummaryWords(s, 30);
  assert.equal(plain.summary, "Full stack engineer with two years at Northgate building Python services and React apps for enterprise platforms.");
  assert.equal(plain.dropped.length, 3);
});

test("fitTwoPages holds the style's caps: too many bullets are trimmed by relevance, a refill never breaks them, projects keep their floor", () => {
  const exp = ["Role | Co | 2020 – 2021", "• Built the Python service with PostgreSQL", "• Wrote docs", "• Ran meetings", "• Fixed the Docker build"].join("\n");
  const sections = { summary: "S.", skills: "", experience: exp, projects: { "0": ["Built a project with Python", "Wrote more docs", "Tidied the repo"] } };
  const profile = { name: "Jane Doe", projects: [{ name: "P" }] };
  const terms = { keywords: ["Python", "Docker"], required: ["PostgreSQL"] };
  assert.equal(bulletCount(sections), 7);
  const r = fitTwoPages(sections, profile, terms, [], { maxBullets: 5, projectMin: 2 });
  assert.equal(bulletCount(r.sections), 5);
  assert.equal(r.report.fits, true);
  assert.match(String(r.sections.experience), /Built the Python service/);
  assert.match(String(r.sections.experience), /Fixed the Docker build/);
  assert.equal((r.sections.projects as Record<string, string[]>)["0"].length, 2, "the project keeps two");
  // A refill candidate that would pass the cap is skipped.
  const refill = fitTwoPages(r.sections, profile, terms, [{ where: "experience", role: 1, masterHeader: "Role | Co | 2020 – 2021", text: "Ran meetings" }], { maxBullets: 5 });
  assert.equal(bulletCount(refill.sections), 5);
  assert.deepEqual(refill.report.restored, []);
  // Without caps the same sections are untouched (UKJI), and the word cap works the same way.
  const plain = fitTwoPages(sections, profile, terms, []);
  assert.equal(plain.sections, sections);
  const words = fitTwoPages(sections, profile, terms, [], { maxWords: cvWordCount(sections, profile) - 1 });
  assert.ok(bulletCount(words.sections) < 7);
  assert.ok(cvWordCount(words.sections, profile) <= cvWordCount(sections, profile) - 1);
});

test("fitOnePage protects the summary sentence and reads the skills shape; cvWordCount counts the printed document", () => {
  const summary = Array.from({ length: 12 }, (_, i) => `Sentence ${i} has exactly five words.`).join("\n") + "\nAvailable immediately for full-time employment.";
  const sections = { summary, skills: "", experience: "Role | Co | 2020 – 2021\n• Built x", projects: {} };
  const r = fitOnePage(sections, { name: "Jane" }, { keywords: [], required: [] }, { protect: ["Available immediately for full-time employment."] });
  assert.match(String(r.sections.summary), /Available immediately for full-time employment\.$/);
  const n = cvWordCount({ summary: "One two three.", skills: "Technical Tools: Python | Go", experience: "", projects: { "0": ["four five"] } }, { name: "Jane Doe", tagline: "Engineer", email: "j@x.com" });
  assert.equal(n, 3 + 4 + 2 + 2 + 1 + 1, "summary, skills line, project bullet, name, headline, email");
});
