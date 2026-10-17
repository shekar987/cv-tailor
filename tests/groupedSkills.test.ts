// The grouped skills block (lib/formatStyles, CareerSet) through every rule
// that reads the Technical Tools line: the format rules, the claims check's
// lead slots, the repair's trims and the scorer's text. Each test also shows
// the flat reader (UKJI) leaving the same text exactly as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { capTechnicalTools, dropUnsupportedTools, separateSkillLines, restoreAskedTools, applyFormatRules, formatRulesFor } from "../src/lib/formatRules.ts";
import { technicalTools, demoteProjectTools, checkClaims, type ClaimsRegistry } from "../src/lib/claims.ts";
import { removeSkillMentions, listRepairs, checkSections, surgicalPass, type RepairSections } from "../src/lib/claimRepair.ts";
import { matchAtsKeywords, tailoredSectionsText } from "../src/lib/atsMatch.ts";
import { stripGroupLabels } from "../src/lib/skillsLines.ts";
import { SKILLS_SHAPE } from "../src/lib/formatStyles/ids.ts";

const CS = SKILLS_SHAPE.careerset;
const groupedBlock = [
  "Functional Competencies: Backend development | API design",
  "Technical Tools:",
  "Languages & Frameworks: Python, TypeScript, Java, React, Node.js, GraphQL",
  "Databases: PostgreSQL, MongoDB, Redis",
  "Cloud & DevOps: Docker, Kubernetes, Terraform, AWS, GCP, GitHub Actions, Jenkins",
  "Testing: Jest, Playwright",
].join("\n");

test("grouped: capTechnicalTools ranks across the groups, keeps each line's order and drops an emptied group", () => {
  const { skills, fix } = capTechnicalTools(groupedBlock, ["Python", "Docker"], ["Kubernetes", "PostgreSQL"], 6, CS);
  assert.ok(fix);
  assert.deepEqual(fix.kept, ["Python", "TypeScript", "Java", "PostgreSQL", "Docker", "Kubernetes"], "required first, keywords next, then the model's order — reported in reading order");
  assert.equal(fix.dropped.length, 12);
  assert.equal(
    skills,
    "Functional Competencies: Backend development | API design\nTechnical Tools:\nLanguages & Frameworks: Python, TypeScript, Java\nDatabases: PostgreSQL\nCloud & DevOps: Docker, Kubernetes"
  );
  assert.deepEqual(capTechnicalTools(groupedBlock, [], [], 30, CS), { skills: groupedBlock, fix: null }, "18 tools is under 30");
  assert.deepEqual(capTechnicalTools(groupedBlock, [], [], 6), { skills: groupedBlock, fix: null }, "the flat reader sees no items on a label-only line and leaves the block alone");
});

test("grouped: dropUnsupportedTools holds every group to the master CV", () => {
  const master = "SKILLS\nPython, TypeScript, PostgreSQL, Docker, Jest";
  const r = dropUnsupportedTools(groupedBlock, [master], CS);
  assert.deepEqual(r.dropped, ["Java", "React", "Node.js", "GraphQL", "MongoDB", "Redis", "Kubernetes", "Terraform", "AWS", "GCP", "GitHub Actions", "Jenkins", "Playwright"]);
  assert.equal(r.skills, "Functional Competencies: Backend development | API design\nTechnical Tools:\nLanguages & Frameworks: Python, TypeScript\nDatabases: PostgreSQL\nCloud & DevOps: Docker\nTesting: Jest");
  assert.deepEqual(dropUnsupportedTools(groupedBlock, [master]), { skills: groupedBlock, dropped: [] }, "flat reading: untouched");
});

test("grouped: separateSkillLines moves a practice phrase into a competencies line with room (cap 12) and drops a tool repeated on both", () => {
  const block = "Functional Competencies: API design | Docker\nTechnical Tools:\nLanguages & Frameworks: Python, Full-Stack Development, React\nCloud & DevOps: Docker";
  const r = separateSkillLines(block, CS, 12);
  assert.ok(r.fix);
  assert.deepEqual(r.fix.moved, ["Full-Stack Development"]);
  assert.deepEqual(r.fix.removedFromCompetencies, ["Docker"]);
  assert.equal(r.skills, "Functional Competencies: API design | Full-Stack Development\nTechnical Tools:\nLanguages & Frameworks: Python, React\nCloud & DevOps: Docker");
  const full = "Functional Competencies: a | b\nTechnical Tools:\nLanguages & Frameworks: Python, Full-Stack Development";
  const r2 = separateSkillLines(full, CS, 2);
  assert.deepEqual(r2.fix?.removedFromTools, ["Full-Stack Development"], "no room: the phrase leaves Tools");
  assert.equal(r2.skills, "Functional Competencies: a | b\nTechnical Tools:\nLanguages & Frameworks: Python");
  assert.deepEqual(separateSkillLines(block), { skills: block, fix: null }, "flat reading: no Technical Tools items, untouched");
});

test("grouped: restoreAskedTools lands the posting's tool in its group, creating the line when needed, never a project skill into the lead slots", () => {
  const master = "SKILLS\nTechnical Tools: Python | TypeScript | PostgreSQL | Redis | Jest | Terraform";
  const block = "Functional Competencies: API design\nTechnical Tools:\nLanguages & Frameworks: Python, TypeScript\nDatabases: PostgreSQL";
  const analysis = { required_skills: ["Redis", "Terraform"], top_15_ats_keywords: ["Jest"] };
  const r = restoreAskedTools(block, analysis, master, null, CS, 30, 8);
  assert.deepEqual(r.restored, ["Redis", "Terraform", "Jest"]);
  assert.equal(r.skills, "Functional Competencies: API design\nTechnical Tools:\nLanguages & Frameworks: Python, TypeScript\nDatabases: PostgreSQL, Redis\nCloud & DevOps: Terraform\nTesting: Jest");
  const reg: ClaimsRegistry = { version: 1, confirmedAt: null, seededFrom: null, skills: [{ name: "Terraform", level: "project", confirmed: true }] };
  assert.deepEqual(restoreAskedTools(block, { required_skills: ["Terraform"] }, master, reg, CS, 30, 8).restored, [], "three tools: a project skill would land in the lead eight");
  // A full block: the restored tool takes the place of the last tool the posting never mentions, in reading order.
  const fullBlock = "Technical Tools:\nLanguages & Frameworks: Python, TypeScript\nDatabases: PostgreSQL";
  const r3 = restoreAskedTools(fullBlock, { required_skills: ["Redis"] }, master, null, CS, 3, 0);
  assert.deepEqual(r3.restored, ["Redis"]);
  assert.equal(r3.skills, "Technical Tools:\nLanguages & Frameworks: Python, TypeScript\nDatabases: Redis");
});

test("applyFormatRules with CareerSet's limits keeps five summary sentences and 95 words; UKJI's default keeps three", () => {
  const rules = formatRulesFor({ skills: CS, limits: { tools: { max: 30, leadSlots: 8 }, competencies: { max: 12 }, summary: { maxSentences: 5, maxWords: 95 } } });
  const r = applyFormatRules({ summary: "One a. Two b. Three c. Four d. Five e. Six f.", skills: groupedBlock }, {}, [], "", null, rules);
  assert.equal(r.summary, "One a.\nTwo b.\nThree c.\nFour d.\nFive e.");
  assert.deepEqual(r.fixes.summary, { sentences: 6, kept: 5 });
  assert.equal(r.fixes.tools, null);
  assert.equal(r.skills, groupedBlock);
  const u = applyFormatRules({ summary: "One a. Two b. Three c. Four d.", skills: "" }, {}, []);
  assert.deepEqual(u.fixes.summary, { sentences: 4, kept: 3 });
  const long = ["Alpha", ...Array.from({ length: 29 }, (_, i) => `word${i}`)].join(" ");
  const w = applyFormatRules({ summary: `${long}. ${long}. ${long}. ${long}.`, skills: "" }, {}, [], "", null, rules);
  assert.deepEqual(w.fixes.summary, { sentences: 4, kept: 3, words: 120 }, "over 95 words the last sentence goes, as the 85-word rule does for UKJI");
});

test("grouped tools: reading order across the group lines; a project tool in the lead eight moves to Other; the claims check reads the lead slots across groups", () => {
  const reg: ClaimsRegistry = {
    version: 1,
    confirmedAt: "2026-09-19T00:00:00Z",
    seededFrom: null,
    skills: [
      { name: "Python", level: "production", confirmed: true },
      { name: "LangChain", level: "project", confirmed: true },
      { name: "LlamaIndex", level: "project", confirmed: true },
    ],
  };
  const masterCv = "EXPERIENCE\nEngineer | Acme | 2022 – 2024\n• Built FastAPI services in Python on PostgreSQL, Redis, Docker and AWS with Terraform and GitHub Actions.\nPROJECTS\nDocket — RAG with LangChain and LlamaIndex.";
  const skills = "Functional Competencies: AI Integration\nTechnical Tools:\nLanguages & Frameworks: Python, FastAPI, LangChain, React\nDatabases: PostgreSQL, Redis\nCloud & DevOps: Docker, AWS, Terraform, GitHub Actions\nAI & LLM: LlamaIndex";
  assert.deepEqual(technicalTools(skills, CS), ["Python", "FastAPI", "LangChain", "React", "PostgreSQL", "Redis", "Docker", "AWS", "Terraform", "GitHub Actions", "LlamaIndex"]);
  // The flat reader's regex runs past the label-only line onto the next (its `\s*` crosses the newline); it never
  // sees the grouped block as such, which is why every caller passes the shape.
  assert.notDeepEqual(technicalTools(skills), technicalTools(skills, CS), "the flat reader does not read the group lines");
  const d = demoteProjectTools(skills, ["LangChain", "LlamaIndex"], CS);
  assert.deepEqual(d.demoted, ["LangChain"]);
  assert.deepEqual(technicalTools(d.skills, CS), ["Python", "FastAPI", "React", "PostgreSQL", "Redis", "Docker", "AWS", "Terraform", "GitHub Actions", "LlamaIndex", "LangChain"]);
  assert.ok(String(d.skills).endsWith("\nOther: LangChain"), String(d.skills));
  assert.deepEqual(demoteProjectTools(skills, ["LangChain"]).demoted, [], "flat reading: nothing to police");
  const c = checkClaims([{ where: "cv", text: stripGroupLabels(skills, CS), skills, skillsShape: CS }], reg, [masterCv]);
  assert.ok(c.skillViolations.some((v) => v.skill === "LangChain" && v.rule === "project_lead_tool"), JSON.stringify(c.skillViolations));
  const ok = checkClaims([{ where: "cv", text: stripGroupLabels(String(d.skills), CS), skills: d.skills, skillsShape: CS }], reg, [masterCv]);
  assert.ok(!ok.skillViolations.some((v) => v.rule === "project_lead_tool"), JSON.stringify(ok.skillViolations));
  const short = demoteProjectTools("Technical Tools:\nLanguages & Frameworks: Python, LangChain", ["LangChain"], CS);
  assert.deepEqual(short.demoted, [], "a short block cannot move the tool out of the lead: reported, never looped");
});

test("grouped repair: the trim takes the item out of its group line (commas and pipes both read) and the repair list names the group line", () => {
  assert.equal(removeSkillMentions("Languages & Frameworks: Python, TypeScript | FastAPI, LangChain", ["LangChain"], true, undefined, true), "Languages & Frameworks: Python, TypeScript, FastAPI");
  assert.equal(removeSkillMentions("Databases: PostgreSQL, Redis", ["Redis"], true, undefined, true), "Databases: PostgreSQL");
  assert.equal(removeSkillMentions("Cloud & DevOps: AWS (Lambda, SQS), Terraform", ["Terraform"], true, undefined, true), "Cloud & DevOps: AWS (Lambda, SQS)", "brackets stay whole");
  assert.equal(removeSkillMentions("Databases: Redis", ["Redis"], true, undefined, true), null, "a line of only the skill is not trimmed (the drop pass removes it)");
  const registry: ClaimsRegistry = {
    version: 1,
    confirmedAt: "2026-09-19T00:00:00Z",
    seededFrom: null,
    skills: [
      { name: "Python", level: "production", confirmed: true },
      { name: "FastAPI", level: "production", confirmed: true },
      { name: "LangChain", level: "project", confirmed: true },
    ],
  };
  const master = "Full Stack Engineer | Northwind Labs | Jul 2023 – Sep 2024\n• Delivered 20+ production API modules in Python and FastAPI on Redis.\nProjects: Docket — RAG pipelines with LangChain.";
  const s: RepairSections = {
    summary: "Backend engineer shipping services in Python and FastAPI.",
    skills: "Functional Competencies: API design\nTechnical Tools:\nLanguages & Frameworks: Python, FastAPI, LangChain\nDatabases: Redis",
    experience: "Full Stack Engineer | Northwind Labs | Jul 2023 – Sep 2024\n• Delivered 20+ production API modules in Python and FastAPI on Redis.",
    projects: {},
    coverLetter: "",
  };
  const items = listRepairs(s, checkSections(s, registry, [master], "", [], CS), registry, CS);
  const lead = items.find((i) => i.section === "skills");
  assert.ok(lead, JSON.stringify(items));
  assert.equal(lead!.sentence, "Languages & Frameworks: Python, FastAPI, LangChain");
  const pass = surgicalPass(s, items, registry, CS);
  assert.equal(pass.sections.skills, "Functional Competencies: API design\nTechnical Tools:\nLanguages & Frameworks: Python, FastAPI\nDatabases: Redis");
  assert.ok(!listRepairs(s, checkSections(s, registry, [master], ""), registry).some((i) => i.section === "skills"), "the flat reader finds no Technical Tools items: no lead-tool item");
});

test("tailoredSectionsText drops a grouped block's labels so 'Testing' or 'LLM' alone never scores; the flat text is untouched", () => {
  const grouped = "Functional Competencies: API design\nTechnical Tools:\nDatabases: PostgreSQL\nAI & LLM: LangChain\nTesting: Jest";
  const text = tailoredSectionsText({ summary: "S.", skills: grouped, experience: "", projects: {} }, CS);
  assert.equal(text, "S.\nFunctional Competencies: API design\nPostgreSQL\nLangChain\nJest");
  assert.equal(matchAtsKeywords(text, ["Testing"]).matched, 0, "the label is not a claim");
  assert.equal(matchAtsKeywords(text, ["LLM"]).matched, 0);
  assert.equal(matchAtsKeywords(text, ["Jest"]).matched, 1);
  const flat = "Functional Competencies: API design\nTechnical Tools: Python | Jest";
  assert.equal(tailoredSectionsText({ skills: flat }), flat);
  assert.equal(tailoredSectionsText({ skills: flat }, SKILLS_SHAPE.ukji), flat);
  assert.equal(tailoredSectionsText({ skills: grouped }), grouped, "no shape: the text exactly as before");
});
