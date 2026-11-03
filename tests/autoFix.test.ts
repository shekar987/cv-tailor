// The last pass on every tailored CV and letter (lib/autoFix, 3 Nov 2026). The
// defects are the exact strings of the Navan and V7 outputs of 3 Nov; the master
// CV is made up in the shape of the real one. Every rule reads the user's own
// CV or answers: nothing about any one person is written into the code.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoFixes,
  cvLabelFixes,
  keepAvailabilityLast,
  labelProjectName,
  labelProjectNames,
  masterProjectLabels,
  masterStackItems,
  normalizeAutoFixes,
  stripApplyingFor,
} from "../src/lib/autoFix.ts";
import { buildHeadline } from "../src/lib/headline.ts";
import { guardFacts, dropReason, dropUnbackedSentences, dropUnbackedTools, fixDegreeLabels, unbackedToolsIn } from "../src/lib/factGuard.ts";
import { applyLetterLint, describeLetterProjects, projectDescriptor, projectsLabelledInLetter } from "../src/lib/letterLint.ts";
import { lockRoleHeaders, parseMasterExperience } from "../src/lib/bulletIds.ts";
import { cvTextOutsideSkills, listedSkillNames, sectionBlock, skillsFromCv } from "../src/lib/claims.ts";
import { tidyNumberedPoints } from "../src/lib/letterStyle.ts";

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
    droppedTools: [{ tool: "OpenAI API", why: "no role or project on your master CV shows it" }],
    unsupportedTools: ["Kafka"],
    degrees: ["BSc → BTech"],
    summaryRemoved: ["applying for the Junior Backend Software Engineer role"],
    availabilityAdded: AVAILABLE,
    letterLabels: ["RideX"],
    headerStack: "Python, TypeScript, JavaScript",
    postingStack: ["Java", "TypeScript"],
  });
  assert.deepEqual(fixes.map((f) => f.kind), ["tool", "tool", "tagline", "summary", "summary", "label", "fact"]);
  assert.match(fixes[0].text, /^Removed OpenAI API from the skills: no role or project on your master CV shows it\.$/);
  assert.match(fixes[2].text, /Python, TypeScript, JavaScript/);
  assert.match(fixes[2].text, /Java/);
  assert.match(fixes[3].text, /applying for the Junior Backend Software Engineer role/);
  assert.deepEqual(buildAutoFixes({}), []);
  assert.deepEqual(buildAutoFixes({ headerStack: "Python", postingStack: ["Python", "AWS"] }), [], "the posting's first is theirs anyway");
});

test("a stored note is re-bounded on read", () => {
  assert.deepEqual(normalizeAutoFixes([{ kind: "tool", text: "Removed X." }, { kind: "nope", text: "y" }, { kind: "fact" }, "z"]), [{ kind: "tool", text: "Removed X." }]);
  assert.deepEqual(normalizeAutoFixes(null), []);
  assert.equal(normalizeAutoFixes([{ kind: "tool", text: "x".repeat(900) }])[0].text.length, 300);
});

// ── The defects a fresh review found, each by its own input ─────────────────

const LABELS = ["RideX (personal portfolio project modelled on a real-world brief)"];
const RIDEX_LABEL = "a personal portfolio project modelled on a real-world brief";

test("a label goes only where it reads: never inside a phrase, a possessive or the salutation", () => {
  for (const untouched of [
    "On the RideX platform I built the API.",
    "RideX's booking flow takes payments.",
    "My RideX project shipped.",
    "I worked on the RideX rebuild.",
    "Dear RideX team,\nI am applying.",
    "The RideX-style flow worked.",
    "RideX Platform shipped.",
  ]) {
    const r = describeLetterProjects(untouched, LABELS);
    assert.equal(r.text, untouched, untouched);
    assert.deepEqual(r.described, []);
  }
  const titled = ["RideX — Ride-Hailing Platform (personal portfolio project modelled on a real-world brief)"];
  assert.equal(describeLetterProjects("RideX — Ride-Hailing Platform runs on Node.js.", titled).text, `RideX — Ride-Hailing Platform, ${RIDEX_LABEL}, runs on Node.js.`);
  for (const dash of ["1. RideX — Built 8 serverless APIs.", "RideX - I built it alone."]) {
    assert.equal(describeLetterProjects(dash, titled).text, dash, "the writer's own dash");
  }
  assert.equal(
    describeLetterProjects("The RideX platform is live. I built RideX on Node.js.", LABELS).text,
    `The RideX platform is live. I built RideX, ${RIDEX_LABEL}, on Node.js.`,
    "the first mention where it reads"
  );
  assert.equal(describeLetterProjects("This insight helped.", ["Insight (personal analytics project)"]).text, "This insight helped.", "a common word is not the project");
});

test("every short or comma label reaches the letter, and the note claims only what the letter holds", () => {
  assert.equal(projectDescriptor("Jobhuntz (personal project, live product)")?.descriptor, "a personal project");
  assert.equal(projectDescriptor("Tally (Personal project)")?.descriptor, "a Personal project");
  assert.deepEqual(projectsLabelledInLetter(`I built RideX, ${RIDEX_LABEL}, alone.`, LABELS), LABELS);
  assert.deepEqual(projectsLabelledInLetter("I built RideX alone.", LABELS), []);
});

test("a project heading in any common shape does not end the section, and its label is still read", () => {
  for (const heading of ["RideX", "RideX\t2025", "RideX - Platform", "RIDEX PLATFORM", "RideX — Platform"]) {
    const cv = `SKILLS\nPython\nPROJECTS\n${heading}\nPersonal portfolio project  |  Tech: Go, GraphQL\n• Built it\nEDUCATION\nBTech`;
    assert.deepEqual([...masterProjectLabels(cv).values()], ["personal portfolio project"], heading);
    assert.ok(sectionBlock(cv, "projects").includes("Personal portfolio project  |  Tech: Go, GraphQL"), heading);
    assert.ok(!sectionBlock(cv, "projects").includes("BTech"), "education ends it");
    assert.match(cvTextOutsideSkills(cv), /GraphQL/, "the project's tech line is evidence");
  }
  assert.doesNotMatch(cvTextOutsideSkills("SKILLS\nOpenAI API, Python\nEXPERIENCE\nEngineer | Acme | 2022\n• Built it\nCurrently learning: GraphQL"), /OpenAI|GraphQL/);
  assert.deepEqual([...masterProjectLabels("PROJECTS\nAlpha | Tech: Go\nBeta Project | 2025\nTech: Rust").values()], [], "a heading is not a label");
  assert.deepEqual([...masterProjectLabels("PROJECTS\nAlpha\nBeta Project\n• Built it").values()], [], "nor is a title");
  assert.deepEqual([...masterProjectLabels("PROJECTS\nAlpha\nPersonal Project | Tech: Go\n• Built it").values()], ["personal Project"]);
  for (const evidence of ["SKILLS\nGraphQL\nPROJECTS\nX\nTech Stack: React, GraphQL", "SKILLS\nGraphQL\nEXPERIENCE\nDev | Acme | 2022\nTechnologies: React, GraphQL", "SKILLS\nGraphQL\nINTERNSHIPS\n• Built a GraphQL gateway", "SKILLS\nGraphQL\nTECHNICAL PROJECTS\n• Built a GraphQL gateway", "SKILLS\nGraphQL\nRESEARCH EXPERIENCE\n• Built a GraphQL gateway"]) {
    assert.match(cvTextOutsideSkills(evidence).replace(/^SKILLS\n/, ""), /GraphQL/, evidence);
    assert.doesNotMatch(cvTextOutsideSkills(evidence).split("\n").slice(0, 2).join("\n"), /^GraphQL$/m, "the list itself is not evidence");
  }
});

test("true sentences survive the strip; only the job-hunting clause goes", () => {
  for (const kept of [
    "Engineer with two years, targeting role-based access control for internal tools.",
    "Engineer with two years, targeting position reconciliation across ledgers.",
    "Built a service targeting the London job market.",
    "Mentored engineers seeking promotion to senior roles.",
    "Engineer pursuing an MSc while working in a part-time role.",
    "Reduced errors by applying retries to failed jobs in the queue.",
    "Built a recruiting tool for candidates applying for jobs.",
  ]) {
    assert.equal(stripApplyingFor(kept).text, kept, kept);
  }
  const cases: [string, string][] = [
    ["Engineer with two years, applying for the Node.js Developer role.", "Engineer with two years."],
    ["Engineer with two years, applying for the .NET Developer role.", "Engineer with two years."],
    ["Engineer with two years, applying for the Software Engineer, Backend role.", "Engineer with two years."],
    ["Engineer with two years, applying for backend engineering roles.", "Engineer with two years."],
    ["Full Stack Engineer seeking Backend Engineer roles.", "Full Stack Engineer."],
    ["Engineer with two years, targeting a Backend Engineer opportunity.", "Engineer with two years."],
    ["Engineer with two years, applying for the Backend role at Navan where my experience with Python applies directly.", "Engineer with two years."],
    ["Engineer with two years, applying for the Backend role, with a focus on APIs.", "Engineer with two years, with a focus on APIs."],
    ["Full-stack engineer applying for the Backend Engineer role with two years of Python and 20+ production APIs.", "Full-stack engineer with two years of Python and 20+ production APIs."],
    ["Engineer with two years, applying for roles in backend engineering.", "Engineer with two years."],
    ["Applying for the Backend role, I bring two years of Python.", "I bring two years of Python."],
  ];
  for (const [input, want] of cases) assert.equal(stripApplyingFor(input).text, want, input);
});

test("the stack: a version is the same skill, and non-tools never headline, in any list shape", () => {
  const claims = { skills: [{ name: "React", level: "project" }, { name: "Next.js", level: "learning" }] };
  assert.deepEqual(masterStackItems("SKILLS\nReact 19, Next.js 16, Python", claims), ["Python"]);
  assert.deepEqual(masterStackItems("SKILLS\nLanguages:\nPython, Java", null), ["Python", "Java"], "a bare group label");
  assert.deepEqual(masterStackItems("SKILLS\nCore Skills: Communication, Leadership, Python", null), ["Python"]);
  assert.deepEqual(masterStackItems("SKILLS\nREST API Design, Python", null), ["Python"], "a practice, unlabelled");
  assert.deepEqual(masterStackItems("SKILLS\nLanguages: English (native), Hindi, French\nTools: Go", null), ["Go"]);
  assert.deepEqual(masterStackItems("SKILLS\nGitHub: github.com/alex\nTools: Go", null), ["Go"]);
  assert.deepEqual(masterStackItems("SKILLS\nPython • React • AWS", null), ["Python", "React", "AWS"]);
  assert.deepEqual(masterStackItems("SKILLS\nPython\nINTERNSHIPS\nDev at Acme, London", null), ["Python"], "a heading it doesn't know");
  assert.deepEqual(masterStackItems("SKILLS\nPython\nTECHNICAL PROJECTS\nRideX", null), ["Python"]);
  assert.deepEqual(masterStackItems("SKILLS\nAWS\nSQL\nPython", null), ["AWS", "SQL", "Python"], "short capitals are items");
  assert.deepEqual(masterStackItems("EXPERIENCE\nDev | Acme | 2022\nTools Used\nReact, Vue\nSKILLS\nPython, Go", null), ["Python", "Go"], "a role's tools are not the list");
  assert.deepEqual(masterStackItems("SKILLS\nASP.NET, Socket.io, vercel.app", null), ["ASP.NET", "Socket.io"], "a tool with a dot is not an address");
  assert.deepEqual(masterStackItems("SKILLS\nCore Competencies\nTeamwork, Delivery\nTechnical Tools:\nGo, Rust", null), ["Go", "Rust"]);
  const list = "SKILLS\nAI & LLM: OpenAI API, LangChain\nEXPERIENCE\nEngineer | Acme | 2022\n• Built with LangChain";
  const names = ["OpenAI API", "LangChain"];
  assert.deepEqual(masterStackItems(list, null, 3, (i) => unbackedToolsIn(i, list, names, cvTextOutsideSkills(list)).length > 0), ["LangChain"], "what the guard strips can't lead");
});

test("a removed tool goes wherever the skills write it, and the reason given is the true one", () => {
  const names = ["Python", "GraphQL", "OpenAI API"];
  const drop = (s: string) => dropUnbackedTools(s, MASTER, names, "Built with Python.").text;
  assert.equal(drop("**Technical Tools:** GraphQL, Python"), "**Technical Tools:** Python");
  assert.equal(drop("Tools: Python, **GraphQL**"), "Tools: Python");
  assert.equal(drop("Tools: GraphQL APIs, Python"), "Tools: Python");
  assert.equal(drop("AI: OpenAI, LangChain"), "AI: LangChain");
  assert.equal(drop("AI: LLM (OpenAI API, Claude), Go"), "AI: LLM (Claude), Go");
  assert.equal(drop("AI: OpenAI Gym, Go"), "AI: OpenAI Gym, Go", "another product");
  assert.equal(drop("Tools: Python\nAI: OpenAI API\nDatabases: Redis"), "Tools: Python\nDatabases: Redis");
  assert.equal(drop("Tools: Docker/GraphQL, Python"), "Tools: Docker, Python", "only its own part");
  assert.equal(drop("**Technical Tools**: GraphQL, Python"), "**Technical Tools**: Python", "the label survives");
  assert.equal(drop("Python, Java | GraphQL, React"), "Python, Java | React", "separators stay as written");
  assert.equal(drop("Tools: Python, Go\nOther: Redis"), "Tools: Python, Go\nOther: Redis", "an untouched line keeps every byte");
  assert.equal(dropReason("GraphQL", "• Built a GraphQL gateway", ["Python"]), "it is not on your master CV's skills list");
  assert.equal(dropReason("OpenAI API", "Skills: OpenAI API", ["OpenAI API"]), "no role or project on your master CV shows it");
  assert.equal(dropReason("Kafka", "Skills: Python", ["Python"]), "your master CV does not name it");
  assert.deepEqual(dropUnbackedTools("AI: OpenAI, Go", MASTER, names, "Called OpenAI from a worker.").dropped, [], "a role naming the vendor backs it");
});

test("the prose loses a sentence claiming a stripped tool; an honest gap and the reader's stack stay", () => {
  const opts = { skillNames: ["Python", "GraphQL"], evidenceText: "Built with Python." };
  const master = "SKILLS\nPython, GraphQL\nEXPERIENCE\nBuilt with Python.";
  const summary = dropUnbackedSentences("Engineer with two years of Python. Experienced with GraphQL and REST.", "summary", master, opts);
  assert.equal(summary.text, "Engineer with two years of Python.");
  assert.deepEqual(summary.tools, ["GraphQL"]);
  const letter = "Dear Acme team,\nI built APIs in Python. I used GraphQL on every service.\nI have not yet worked with GraphQL in production.\nYour team's GraphQL platform is impressive.\nKind regards,\nAlex";
  const l = dropUnbackedSentences(letter, "coverLetter", master, opts);
  assert.doesNotMatch(l.text, /I used GraphQL/);
  assert.match(l.text, /I have not yet worked with GraphQL/, "the honest gap");
  assert.match(l.text, /Your team's GraphQL platform/, "not a claim about the candidate");
  assert.equal(dropUnbackedSentences("Experienced with GraphQL.", "summary", master, opts).text, "Experienced with GraphQL.", "never emptied");
  for (const aside of ["I used Python at Acme, where other teams ran GraphQL.", "I built APIs in Python, while GraphQL is new to me."]) {
    assert.equal(dropUnbackedSentences(aside, "coverLetter", master, opts).text, aside, aside);
  }
  assert.equal(dropUnbackedSentences("Dear Acme,\n1. I built a GraphQL gateway.\n2. I built APIs in Python.", "coverLetter", master, opts).text, "Dear Acme,\n2. I built APIs in Python.", "no bare number left");
  const titled = dropUnbackedSentences("GraphQL Engineer with two years. Uses Python.", "summary", master, { ...opts, keep: (s) => s.includes("GraphQL Engineer") });
  assert.match(titled.text, /GraphQL Engineer/, "the title's own sentence");
});

test("a project name keeps its date as a date, whichever way it was written", () => {
  const labels = new Map([["x", "personal project"]]);
  const label = (n: string) => labelProjectName(n, labels);
  assert.equal(label("X — App — 2026"), "X — App (personal project) | 2026");
  assert.equal(label("X - App - Jan 2025 – Jan 2027"), "X - App (personal project) | Jan 2025 – Jan 2027");
  assert.equal(label("X (2025)"), "X (personal project) | 2025");
  assert.equal(label("X | 2025"), "X (personal project) | 2025");
  assert.equal(label(label("X — App — 2026")), label("X — App — 2026"), "relabelling changes nothing");
});

test("the note says what happened, and only that", () => {
  const unchanged = buildAutoFixes({ headerLock: { locked: [{ output: "Engineer | Acme | Jul 2022 to Sep 2024", master: "Engineer | Acme | Jul 2022 – Sep 2024" }] } });
  assert.deepEqual(unchanged, [], "the same dates in other words");
  const header = buildAutoFixes({ headerStack: "TypeScript, JavaScript", postingStack: ["Java"] });
  assert.match(header[0].text, /\(TypeScript, JavaScript\)/, "the stack as printed");
  const labels = new Map([["ridex", "personal portfolio project"]]);
  assert.deepEqual(cvLabelFixes(["RideX — Platform | 2025", "RideX (personal portfolio project) | 2025", "Other"], labels).map((f) => f.text), ["Added your label to RideX on the CV, as your master CV writes it."]);
  const drops = buildAutoFixes({ sentenceDrops: [{ where: "cover letter", tool: "GraphQL", why: "your master CV does not name it" }] });
  assert.equal(drops[0].text, "Removed a sentence naming GraphQL from the cover letter: your master CV does not name it.");
});

test("the third review pass: sub-headings, other headings, and true sentences", () => {
  assert.deepEqual(masterStackItems("SKILLS\nProgramming Languages\nPython, Java\nCloud Platforms\nAWS", null), ["Python", "Java", "AWS"]);
  // A heading the seed doesn't read still lists a skill, and a bullet backs it.
  for (const heading of ["IT SKILLS", "Programming Skills", "TECHNICAL EXPERTISE", "Skills Summary"]) {
    const cv = `${heading}\nPython, GraphQL\nEXPERIENCE\nDev | Acme | 2022\n• Built a GraphQL gateway`;
    assert.deepEqual(masterStackItems(cv, null), ["Python", "GraphQL"], heading);
    assert.deepEqual(dropUnbackedTools("Tools: Python, GraphQL", cv, listedSkillNames(cv, null), cvTextOutsideSkills(cv)).dropped, [], heading);
    const unbacked = `${heading}\nPython, OpenAI API\nEXPERIENCE\nDev | Acme | 2022\n• Built it in Python`;
    assert.deepEqual(dropUnbackedTools("Tools: Python, OpenAI API", unbacked, listedSkillNames(unbacked, null), cvTextOutsideSkills(unbacked)).dropped, ["OpenAI API"], `the list is not its own evidence: ${heading}`);
  }
  const caps = "SKILLS\nCLOUD & DEVOPS\nAWS, OpenAI API\nEXPERIENCE\nDev | Acme | 2022\n• Built it";
  assert.doesNotMatch(cvTextOutsideSkills(caps), /OpenAI/, "a caps sub-heading stays inside the list");
  assert.deepEqual(listedSkillNames("SKILLS\nGraphQL\nCurrently learning: Rust", { skills: [{ name: "Go", level: "production" }, { name: "Zig", level: "learning" }] }), ["Go", "GraphQL"]);
  assert.equal(stripApplyingFor("Full-stack engineer applying for the Backend Engineer role with 20+ production APIs behind me.").text, "Full-stack engineer with 20+ production APIs behind me.");
  const opts = { skillNames: ["Python", "GraphQL"], evidenceText: "Built with Python." };
  const master = "SKILLS\nPython, Kafka\nEXPERIENCE\nBuilt with Python.";
  const reader = "I built 20 Python APIs and would like to apply that to your GraphQL pipelines.";
  assert.equal(dropUnbackedSentences(reader, "coverLetter", master, opts).text, reader);
  // The route renumbers a letter that lost a point, in either style.
  const dropped = dropUnbackedSentences("My two reasons:\n1. I built a GraphQL consumer.\n2. I shipped APIs.\n3. I led a team.", "coverLetter", master, opts);
  assert.match(tidyNumberedPoints(dropped.text).text, /1\. I shipped APIs\.\n2\. I led a team\./);
});
