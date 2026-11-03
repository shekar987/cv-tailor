// The last pass on every tailored CV and letter (lib/autoFix, 3 Nov 2026). The
// defects are the exact strings of the Navan and V7 outputs of 3 Nov; the master
// CV is made up in the shape of the real one. Every rule reads the user's own
// CV or answers: nothing about any one person is written into the code.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoFixes,
  keepAvailabilityLast,
  labelProjectName,
  labelProjectNames,
  masterProjectLabels,
  masterStackItems,
  normalizeAutoFixes,
  stripApplyingFor,
} from "../src/lib/autoFix.ts";
import { buildHeadline } from "../src/lib/headline.ts";
import { guardFacts, dropUnbackedTools, fixDegreeLabels } from "../src/lib/factGuard.ts";
import { applyLetterLint, describeLetterProjects, projectDescriptor } from "../src/lib/letterLint.ts";
import { lockRoleHeaders, parseMasterExperience } from "../src/lib/bulletIds.ts";
import { skillsFromCv } from "../src/lib/claims.ts";

const MASTER = `ALEX MORGAN
London, UK | alex.morgan@example.com
PROFESSIONAL SUMMARY
Full-stack and AI engineer with two years of production experience at Northgate Systems. Available immediately for full-time employment.
SKILLS
Functional Competencies: Full-Stack Development | REST & GraphQL API Design | AI/LLM Integration & RAG
Technical Tools:
•\tLanguages & Frameworks: Python, TypeScript, JavaScript, SQL, Java | FastAPI, React, Next.js, Node.js, GraphQL
•\tDatabases: PostgreSQL, MySQL
•\tAI & LLM: Anthropic Claude API, OpenAI API, LangChain
WORK EXPERIENCE
Full Stack Engineer  —  Northgate Systems\tJul 2022 – Oct 2024
•\tDelivered 20+ production API modules using Python, FastAPI, React and TypeScript
PROJECTS
Jobhuntz — AI Career Platform\t2026
Personal project, live product  |  Tech: Next.js, TypeScript, Anthropic Claude API, Vercel  |  GitHub
•\tLaunched a live AI career platform as sole developer
CampaignPulse — Event-Driven Delivery Platform\t2026
Personal portfolio project  |  Tech: React 19, TypeScript, GraphQL, Node.js  |  GitHub
•\tDesigned an event-driven AWS pipeline with retries
RideX — Ride-Hailing Platform\t2025
Personal portfolio project modelled on a real-world brief  |  Tech: React 19, Firebase, Node.js  |  Live demo  |  GitHub
•\tCreated 8 serverless REST APIs on Node.js Cloud Functions
EDUCATION
BTech Computer Science  —  Riverside Institute of Technology\tJul 2019 – Jul 2023
`;
const AVAILABLE = "Available immediately for full-time employment.";

// ── a. Tools ────────────────────────────────────────────────────────────────

const NAVAN_SKILLS = "Functional Competencies: Full-Stack Development | RAG\nTechnical Tools:\nLanguages & Frameworks: Python, Java\nAI & LLM: Anthropic Claude API, OpenAI API, LangChain";

test("OpenAI API: on the skills list but shown by no role or project → removed, and logged", () => {
  assert.match(NAVAN_SKILLS, /OpenAI API/, "the defect in the 3 Nov outputs");
  const names = skillsFromCv(MASTER).map((s) => s.name);
  const g = guardFacts({ summary: "", skills: NAVAN_SKILLS }, MASTER, "", { skillNames: names, evidenceText: "Delivered 20+ modules. Next.js, Anthropic Claude API, GraphQL." });
  assert.doesNotMatch(String(g.skills), /OpenAI/);
  assert.deepEqual(g.report.droppedTools, ["OpenAI API"]);
  assert.match(String(g.skills), /Anthropic Claude API, LangChain/, "its neighbours stay");
});

test("GraphQL: gone when nothing shows it, kept when a project does; a tool the master never names goes too", () => {
  const skills = "Technical Tools: Python | GraphQL | React";
  const names = ["Python", "GraphQL", "React"];
  assert.deepEqual(dropUnbackedTools(skills, MASTER, names, "Built with Python and React.").dropped, ["GraphQL"]);
  assert.deepEqual(dropUnbackedTools(skills, MASTER, names, "CampaignPulse: React, GraphQL, Node.js.").dropped, []);
  assert.deepEqual(dropUnbackedTools("Technical Tools: Python | GraphQL", "Skills: Python", [] , "").dropped, ["GraphQL"]);
  // "REST & GraphQL API Design" is the user's own competency, not the tool.
  assert.equal(dropUnbackedTools("Functional Competencies: REST & GraphQL API Design", MASTER, names, "").text, "Functional Competencies: REST & GraphQL API Design");
});

// ── b. Tagline ──────────────────────────────────────────────────────────────

test("the tagline's stack is the master CV's top skills in master order, Python first, never the posting's", () => {
  const stack = masterStackItems(MASTER, null);
  assert.deepEqual(stack, ["Python", "TypeScript", "JavaScript"]);
  const base = { claims: null, yearsExperience: 2, heldTitles: ["Full Stack Engineer"] };
  for (const defect of ["Java, TypeScript, REST & GraphQL API Design", "TypeScript, AI/LLM Integration"]) {
    const posting = defect.split(", ");
    assert.ok(!defect.startsWith("Python"), "the defect in the 3 Nov outputs");
    const { headline } = buildHeadline({ ...base, requiredSkills: posting, keywords: posting, masterStack: stack });
    assert.equal(headline, "Full Stack Engineer · 2 years' experience · Python, TypeScript, JavaScript");
  }
  const careerset = buildHeadline({ ...base, masterStack: stack }, { headlineSeparator: " | " }).headline;
  assert.equal(careerset, "Full Stack Engineer | 2 years' experience | Python, TypeScript, JavaScript");
});

test("the stack never holds a competency, a group label, a learning or project-level skill, or a skill named by the role", () => {
  const claims = { skills: [{ name: "TypeScript", level: "project" }, { name: "JavaScript", level: "learning" }] };
  assert.deepEqual(masterStackItems(MASTER, claims), ["Python", "SQL", "Java"]);
  assert.deepEqual(masterStackItems("Experience only, no skills.", null), []);
  const empty = buildHeadline({ claims: null, requiredSkills: ["Java"], keywords: [], yearsExperience: 2, heldTitles: ["Engineer"], masterStack: [] });
  assert.equal(empty.headline, "Engineer · 2 years' experience", "no skills on the CV: no stack, never the posting's");
  assert.deepEqual(masterStackItems("SKILLS\nCurrently learning: Go\nTools: AWS (Lambda, SQS), Docker", null), ["AWS (Lambda, SQS)", "Docker"]);
});

// ── c. "applying for the … role" ────────────────────────────────────────────

test("'…, applying for the Junior Backend Software Engineer role' leaves the summary, the true clause stays", () => {
  const navan = "Full-stack engineer with two years of production experience at Northgate Systems, applying for the Junior Backend Software Engineer role.\nAvailable immediately for full-time employment.";
  assert.match(navan, /applying for/, "the defect in the 3 Nov outputs");
  const r = stripApplyingFor(navan);
  assert.equal(r.text, "Full-stack engineer with two years of production experience at Northgate Systems.\nAvailable immediately for full-time employment.");
  assert.deepEqual(r.removed, ["applying for the Junior Backend Software Engineer role"]);
});

test("the variants; a sentence that is nothing else goes; ordinary sentences are untouched", () => {
  const strip = (s: string) => stripApplyingFor(s).text;
  assert.equal(strip("Engineer with two years, targeting a Backend Engineer role at Navan."), "Engineer with two years.");
  assert.equal(strip("Engineer with two years, seeking the Platform Engineer position."), "Engineer with two years.");
  assert.equal(strip("Engineer with two years - applying to the Forward Deployed Engineer role."), "Engineer with two years.");
  assert.equal(strip("Applying for the Software Engineer role. Built 20 APIs."), "Built 20 APIs.");
  assert.equal(strip("Now applying for this role."), "");
  for (const keep of [
    "Built a service targeting the London job market.",
    "Led a role-based access rewrite for the team.",
    "Engineer applying machine learning to fraud signals.",
    "Pursuing an MSc in Computer Science.",
  ]) {
    assert.deepEqual(stripApplyingFor(keep), { text: keep, removed: [] }, keep);
  }
});

// ── d. Exact labels, from the user's own CV ─────────────────────────────────

test("each project's label is read from the master CV's own line, never from code", () => {
  const labels = masterProjectLabels(MASTER);
  assert.equal(labels.size, 3);
  assert.equal(labelProjectName("RideX — Ride-Hailing Platform", labels), "RideX — Ride-Hailing Platform (personal portfolio project modelled on a real-world brief)");
  assert.equal(labelProjectName("CampaignPulse — Event-Driven Delivery Platform | 2026", labels), "CampaignPulse — Event-Driven Delivery Platform (personal portfolio project) | 2026");
  // A pool's longer title is the same project.
  assert.match(labelProjectName("RideX — Full-Stack Ride-Hailing Platform", labels), /\(personal portfolio project modelled on a real-world brief\)$/);
  const once = labelProjectName("RideX — Ride-Hailing Platform", labels);
  assert.equal(labelProjectName(once, labels), once, "idempotent");
  assert.equal(labelProjectName("FinSight", labels), "FinSight", "no label on the CV, none invented");
  assert.equal(masterProjectLabels("No projects here.").size, 0);
  // An ordinary project heading is not a label.
  assert.equal(masterProjectLabels("PROJECTS\nCapstone Project\t2025\n•\tBuilt a parser\n").size, 0);
  assert.deepEqual(labelProjectNames(["RideX — Ride-Hailing Platform"], MASTER), ["RideX — Ride-Hailing Platform (personal portfolio project modelled on a real-world brief)"]);
});

test("the letter carries the exact label at a project's first mention", () => {
  const names = labelProjectNames(["RideX — Ride-Hailing Platform", "CampaignPulse — Event-Driven Delivery Platform"], MASTER);
  assert.deepEqual(projectDescriptor(names[0]), { name: "RideX", descriptor: "a personal portfolio project modelled on a real-world brief" });
  assert.equal(projectDescriptor(names[1])?.descriptor, "a personal portfolio project");
  const letter = "Dear Navan team,\n\nI built RideX with 8 serverless APIs. CampaignPulse uses retries. RideX also handles payments.\n\nKind regards,\nAlex Morgan";
  assert.doesNotMatch(letter, /modelled on a real-world brief/, "the defect");
  const r = describeLetterProjects(letter, names);
  assert.match(r.text, /I built RideX, a personal portfolio project modelled on a real-world brief, with 8 serverless APIs\./);
  assert.match(r.text, /CampaignPulse, a personal portfolio project, uses retries\./);
  assert.match(r.text, /\. RideX also handles payments\./, "the first mention only");
  assert.deepEqual(r.described.sort(), ["CampaignPulse", "RideX"]);
  assert.deepEqual(describeLetterProjects(r.text, names).described, [], "already right: nothing to report");
  assert.ok(applyLetterLint(letter, { projects: names }).rules.projectDescriptors.includes("RideX"), "the earlier pass reads the same names");
});

// ── e. Facts ────────────────────────────────────────────────────────────────

test("BTech, never BSc, from the master CV's own label; a degree of the CV's stays", () => {
  const r = fixDegreeLabels("I hold a BSc in Computer Science.", MASTER);
  assert.equal(r.text, "I hold a BTech in Computer Science.");
  assert.deepEqual(r.fixed, ["BSc → BTech"]);
  assert.equal(fixDegreeLabels("I hold a BTech.", MASTER).fixed.length, 0);
  assert.equal(fixDegreeLabels("I hold a BSc.", "EDUCATION\nBSc Physics").fixed.length, 0, "another user's BSc is true");
});

test("an employer's dates come from the master CV: Oct 2024, whatever the draft says", () => {
  const roles = parseMasterExperience(MASTER);
  const draft = "Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024\n• Delivered 20+ production API modules using Python";
  assert.match(draft, /Sep 2024/, "the defect");
  const locked = lockRoleHeaders(draft, roles);
  assert.match(locked.experience, /Jul 2022 – Oct 2024/);
  const fixes = buildAutoFixes({ headerLock: locked.report });
  assert.deepEqual(fixes.filter((f) => f.kind === "fact").map((f) => f.text), ["Dates for Full Stack Engineer set to your master CV: Jul 2022 – Oct 2024."]);
  assert.deepEqual(buildAutoFixes({ headerLock: lockRoleHeaders("Full Stack Engineer | Northgate Systems | Jul 2022 – Oct 2024\n• x", roles).report }), [], "right already: no note");
});

test("the summary ends on the availability sentence, from the user's own answer", () => {
  const r = keepAvailabilityLast(`${AVAILABLE} Full-stack engineer with two years.`, AVAILABLE);
  assert.equal(r.text, `Full-stack engineer with two years.\n${AVAILABLE}`);
  assert.equal(r.added, false);
  const added = keepAvailabilityLast("Full-stack engineer with two years.", AVAILABLE);
  assert.equal(added.text, `Full-stack engineer with two years.\n${AVAILABLE}`);
  assert.equal(added.added, true);
  const done = keepAvailabilityLast(`Engineer.\n${AVAILABLE}`, AVAILABLE);
  assert.deepEqual(done, { text: `Engineer.\n${AVAILABLE}`, added: false, moved: false });
  assert.equal(keepAvailabilityLast("Engineer.", null).text, "Engineer.", "unanswered: nothing is claimed");
  assert.equal(keepAvailabilityLast("", AVAILABLE).text, "", "no summary is not rebuilt here");
});

// ── The note ────────────────────────────────────────────────────────────────

test("Auto-fixed: every change is listed in plain British English, and a clean run lists nothing", () => {
  const fixes = buildAutoFixes({
    droppedTools: ["OpenAI API"],
    unsupportedTools: ["Kafka"],
    degrees: ["BSc → BTech"],
    summaryRemoved: ["applying for the Junior Backend Software Engineer role"],
    availabilityAdded: AVAILABLE,
    letterLabels: ["RideX"],
    headerStack: ["Python", "TypeScript", "JavaScript"],
    postingStack: ["Java", "TypeScript"],
  });
  assert.deepEqual(fixes.map((f) => f.kind), ["tool", "tool", "tagline", "summary", "summary", "label", "fact"]);
  assert.match(fixes[0].text, /^Removed OpenAI API from the skills: no role or project on your master CV shows it\.$/);
  assert.match(fixes[2].text, /Python, TypeScript, JavaScript/);
  assert.match(fixes[2].text, /Java/);
  assert.match(fixes[3].text, /applying for the Junior Backend Software Engineer role/);
  assert.deepEqual(buildAutoFixes({}), []);
  assert.deepEqual(buildAutoFixes({ headerStack: ["Python"], postingStack: ["Python", "AWS"] }), [], "the posting's first is theirs anyway");
});

test("a stored note is re-bounded on read", () => {
  assert.deepEqual(normalizeAutoFixes([{ kind: "tool", text: "Removed X." }, { kind: "nope", text: "y" }, { kind: "fact" }, "z"]), [{ kind: "tool", text: "Removed X." }]);
  assert.deepEqual(normalizeAutoFixes(null), []);
  assert.equal(normalizeAutoFixes([{ kind: "tool", text: "x".repeat(900) }])[0].text.length, 300);
});
