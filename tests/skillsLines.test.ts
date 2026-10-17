import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillsBlock, splitItems, toolItems, toolLines, writeToolLines, keepToolItems, groupFor, addToolItem, stripGroupLabels, parseLabelLine } from "../src/lib/skillsLines.ts";
import { SKILLS_SHAPE, FLAT_SKILLS, CAREERSET_TOOL_GROUPS } from "../src/lib/formatStyles/ids.ts";

const CS = SKILLS_SHAPE.careerset;
const grouped = [
  "Functional Competencies: Full-Stack Development | REST API Design | Automated Testing",
  "Technical Tools:",
  "Languages & Frameworks: Python, TypeScript, JavaScript | FastAPI, React, Next.js",
  "Databases: PostgreSQL, MySQL, Redis",
  "AI & LLM: Anthropic Claude API, LangChain, RAG",
  "Cloud & DevOps: AWS (Lambda, SQS, SNS), Terraform, Docker, GitHub Actions",
  "Testing: Jest, Playwright, axe accessibility checks",
].join("\n");
const flat = "Functional Competencies: Backend development | API design\nTechnical Tools: Python | FastAPI | PostgreSQL | AWS (Lambda, SQS)";

test("splitItems: pipes always, commas only when asked, never inside brackets, duplicates folded", () => {
  assert.deepEqual(splitItems("Python | FastAPI | AWS (Lambda, SQS)", false), ["Python", "FastAPI", "AWS (Lambda, SQS)"]);
  assert.deepEqual(splitItems("Python, TypeScript | FastAPI, React", true), ["Python", "TypeScript", "FastAPI", "React"]);
  assert.deepEqual(splitItems("AWS (Lambda, SQS, SNS), Terraform, terraform", true), ["AWS (Lambda, SQS, SNS)", "Terraform"]);
  assert.deepEqual(splitItems("Python, TypeScript", false), ["Python, TypeScript"], "a flat line keeps a comma-joined item whole");
  assert.deepEqual(splitItems("", true), []);
});

test("parseLabelLine reads plain and bold labels and keeps the prefix as written", () => {
  assert.deepEqual(parseLabelLine("**Technical Tools:** Python"), { label: "Technical Tools", prefix: "**Technical Tools:** ", body: "Python" });
  assert.deepEqual(parseLabelLine("Databases: PostgreSQL"), { label: "Databases", prefix: "Databases: ", body: "PostgreSQL" });
  assert.equal(parseLabelLine("• a bullet with: colon"), null);
  assert.equal(parseLabelLine("Role | Employer | 2020 – 2021"), null);
});

test("parseSkillsBlock: the flat shape is the header line with its items", () => {
  const b = parseSkillsBlock(flat, FLAT_SKILLS);
  assert.equal(b.competencies?.label, "Functional Competencies");
  assert.deepEqual(b.header?.items, ["Python", "FastAPI", "PostgreSQL", "AWS (Lambda, SQS)"]);
  assert.deepEqual(b.groups, []);
  assert.deepEqual(toolItems(b), ["Python", "FastAPI", "PostgreSQL", "AWS (Lambda, SQS)"]);
  assert.equal(toolLines(b).length, 1);
  // The same text read as grouped: a header with items and no groups.
  const g = parseSkillsBlock(flat, CS);
  assert.deepEqual(g.groups, []);
  assert.deepEqual(toolItems(g), [], "grouped reading order comes from the group lines only");
});

test("parseSkillsBlock: the grouped shape — a label-only header and the group lines in reading order", () => {
  const b = parseSkillsBlock(grouped, CS);
  assert.equal(b.header?.index, 1);
  assert.deepEqual(b.header?.items, []);
  assert.deepEqual(b.groups.map((g) => g.label), ["Languages & Frameworks", "Databases", "AI & LLM", "Cloud & DevOps", "Testing"]);
  assert.deepEqual(toolItems(b), [
    "Python", "TypeScript", "JavaScript", "FastAPI", "React", "Next.js",
    "PostgreSQL", "MySQL", "Redis",
    "Anthropic Claude API", "LangChain", "RAG",
    "AWS (Lambda, SQS, SNS)", "Terraform", "Docker", "GitHub Actions",
    "Jest", "Playwright", "axe accessibility checks",
  ]);
  // A second line with a label already seen is not a group (dedupe is formatRules' job).
  const twice = parseSkillsBlock(grouped + "\nDatabases: Mongo", CS);
  assert.equal(twice.groups.filter((g) => g.label === "Databases").length, 1);
  // A line whose label is not a known group is left alone.
  const stray = parseSkillsBlock(grouped + "\nSoft Skills: Communication", CS);
  assert.equal(stray.groups.length, 5);
});

test("writeToolLines / keepToolItems: each line keeps its order, an emptied group line goes, commas are written", () => {
  const b = parseSkillsBlock(grouped, CS);
  const kept = keepToolItems(b, new Set(["Python", "React", "PostgreSQL", "Docker", "Jest"]));
  assert.equal(kept, [
    "Functional Competencies: Full-Stack Development | REST API Design | Automated Testing",
    "Technical Tools:",
    "Languages & Frameworks: Python, React",
    "Databases: PostgreSQL",
    "Cloud & DevOps: Docker",
    "Testing: Jest",
  ].join("\n"));
  const f = parseSkillsBlock(flat, FLAT_SKILLS);
  assert.equal(keepToolItems(f, new Set(["Python", "AWS (Lambda, SQS)"])), "Functional Competencies: Backend development | API design\nTechnical Tools: Python | AWS (Lambda, SQS)");
  assert.equal(writeToolLines(f, [["FastAPI", "Python"]]), "Functional Competencies: Backend development | API design\nTechnical Tools: FastAPI | Python", "flat: the given order is the line's order");
  assert.equal(writeToolLines(f, [[]]), "Functional Competencies: Backend development | API design", "a line with nothing left goes");
  const bold = parseSkillsBlock("**Technical Tools:**\n**Databases:** PostgreSQL, Redis", CS);
  assert.equal(keepToolItems(bold, new Set(["Redis"])), "**Technical Tools:**\n**Databases:** Redis", "bold labels are kept as written");
});

test("groupFor: a fixed table, Other only when nothing matches", () => {
  const g = CAREERSET_TOOL_GROUPS;
  assert.equal(groupFor("PostgreSQL", g), "Databases");
  assert.equal(groupFor("Redis", g), "Databases");
  assert.equal(groupFor("LangChain", g), "AI & LLM");
  assert.equal(groupFor("Terraform", g), "Cloud & DevOps");
  assert.equal(groupFor("AWS (Lambda, SQS)", g), "Cloud & DevOps");
  assert.equal(groupFor("GitHub Actions", g), "Cloud & DevOps");
  assert.equal(groupFor("Playwright", g), "Testing");
  assert.equal(groupFor("React Testing Library", g), "Testing");
  assert.equal(groupFor("TypeScript", g), "Languages & Frameworks");
  assert.equal(groupFor("Next.js", g), "Languages & Frameworks");
  assert.equal(groupFor("Go", g), "Languages & Frameworks");
  assert.equal(groupFor("Jira", g), "Other");
  assert.equal(groupFor("Figma", g), "Other");
});

test("addToolItem: into an existing group, into a new group in the style's order, or onto the flat line", () => {
  const b = parseSkillsBlock(grouped, CS);
  assert.ok(addToolItem(b, "MongoDB", null).includes("Databases: PostgreSQL, MySQL, Redis, MongoDB"));
  const noDb = parseSkillsBlock(grouped.split("\n").filter((l) => !l.startsWith("Databases")).join("\n"), CS);
  const added = addToolItem(noDb, "MongoDB", null).split("\n");
  assert.equal(added[3], "Databases: MongoDB", "a new Databases line sits after Languages & Frameworks");
  const other = addToolItem(b, "Jira", null).split("\n");
  assert.equal(other[other.length - 1], "Other: Jira", "Other goes last");
  const f = parseSkillsBlock(flat, FLAT_SKILLS);
  assert.equal(addToolItem(f, "Redis", null).split("\n")[1], "Technical Tools: Python | FastAPI | PostgreSQL | AWS (Lambda, SQS) | Redis");
  const headerOnly = parseSkillsBlock("Functional Competencies: a\nTechnical Tools:", CS);
  assert.equal(addToolItem(headerOnly, "Python", null), "Functional Competencies: a\nTechnical Tools:\nLanguages & Frameworks: Python");
});

test("stripGroupLabels: the header line goes and group labels are dropped, items stay; the flat shape is untouched", () => {
  const stripped = stripGroupLabels(grouped, CS);
  assert.equal(stripped, [
    "Functional Competencies: Full-Stack Development | REST API Design | Automated Testing",
    "Python, TypeScript, JavaScript | FastAPI, React, Next.js",
    "PostgreSQL, MySQL, Redis",
    "Anthropic Claude API, LangChain, RAG",
    "AWS (Lambda, SQS, SNS), Terraform, Docker, GitHub Actions",
    "Jest, Playwright, axe accessibility checks",
  ].join("\n"));
  assert.ok(!/\bTesting\b/.test(stripped.split("\n").slice(1).join("\n")), "the word Testing is no longer in the tools text");
  assert.equal(stripGroupLabels(flat, FLAT_SKILLS), flat);
  assert.equal(stripGroupLabels(flat, CS), flat, "a flat block read as grouped has no labels to strip beyond a header with items");
});
