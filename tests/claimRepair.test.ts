// Unit tests for the claims repair behind "Fix it" (lib/claimRepair).
// node:test, zero dependencies: `npm test`. Every CV here is synthetic,
// shaped like the real blocked download of 25 Sep: the master CV's own
// "LLM/RAG knowledge solutions" bullet under a paid role, with RAG
// registered at project level.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSections,
  listRepairs,
  removeSkillMentions,
  surgicalPass,
  surgicalUntilStable,
  normalizeRepairEdits,
  applyModelEdits,
  replacementPasses,
  dropUntilClean,
  replaceSentence,
  locate,
  rebold,
  wordChanges,
  type RepairSections,
} from "../src/lib/claimRepair.ts";
import { checkClaims, type ClaimsRegistry } from "../src/lib/claims.ts";

const registry: ClaimsRegistry = {
  version: 1,
  confirmedAt: "2026-09-19T00:00:00Z",
  seededFrom: null,
  skills: [
    { name: "Python", level: "production", confirmed: true },
    { name: "FastAPI", level: "production", confirmed: true },
    { name: "RAG and knowledge retrieval", level: "project", confirmed: true },
    { name: "LangChain", level: "project", confirmed: true },
    { name: "AWS Lambda", level: "project", confirmed: true },
    { name: "Axonius", level: "learning", confirmed: false },
    { name: "Qualys", level: "learning", confirmed: false },
  ],
};

const MASTER = [
  "Full Stack Engineer | Northwind Labs | Jul 2023 – Sep 2024",
  "• Built AI-enabled services across 2+ solution areas, including facial-recognition workflows and later LLM/RAG knowledge solutions for automated business-document generation, reducing manual documentation effort by 25%.",
  "• Analysed 11 industry asset-management platforms (Axonius, Qualys, Tenable, runZero) from verified user reviews.",
  "• Delivered 20+ production API modules in Python and FastAPI.",
  "Projects: Docket — RAG pipelines with LangChain on AWS Lambda.",
].join("\n");
const JD = "We want a backend engineer with Python and FastAPI.";

const EXPERIENCE = [
  "Full Stack Engineer | Northwind Labs | Jul 2023 – Sep 2024",
  "• Built AI-enabled services across **2+ solution areas**, including facial-recognition workflows and later LLM/RAG knowledge solutions for automated business-document generation, reducing manual documentation effort by **25%**",
  "• Analysed **11 industry asset-management platforms** (Axonius, Qualys, Tenable, runZero) from verified user reviews",
  "• Delivered **20+ production API modules** in Python and FastAPI",
].join("\n");

const doc = (over: Partial<RepairSections> = {}): RepairSections => ({
  summary: "Backend engineer shipping production services in Python and FastAPI.",
  skills: "Functional Competencies: API design | Backend services\nTechnical Tools: Python | FastAPI | Redis",
  experience: EXPERIENCE,
  projects: { "0": ["Built Docket RAG pipelines with LangChain on AWS Lambda."] },
  coverLetter: "Dear team,\nI build production services in Python.\nKind regards",
  ...over,
});

test("the blocked Northwind bullet: only the flagged half of LLM/RAG goes, every other word and the bold figures stay", () => {
  const s = doc();
  const check = checkSections(s, registry, [MASTER], JD);
  assert.equal(check.blocking, true);
  const out = surgicalUntilStable(s, registry, [MASTER], JD);
  assert.match(
    out.sections.experience,
    /^• Built AI-enabled services across \*\*2\+ solution areas\*\*, including facial-recognition workflows and later LLM knowledge solutions for automated business-document generation, reducing manual documentation effort by \*\*25%\*\*$/m
  );
  // The learning-level products leave the bracketed list; the rest of it stays.
  assert.match(out.sections.experience, /^• Analysed \*\*11 industry asset-management platforms\*\* \(Tenable, runZero\) from verified user reviews$/m);
  // Untouched lines are byte-identical.
  assert.match(out.sections.experience, /^• Delivered \*\*20\+ production API modules\*\* in Python and FastAPI$/m);
  assert.equal(out.sections.experience.split("\n")[0], "Full Stack Engineer | Northwind Labs | Jul 2023 – Sep 2024");
  assert.equal(checkSections(out.sections, registry, [MASTER], JD).blocking, false);
  assert.ok(out.changes.every((c) => c.how === "trimmed"));
  // A project-level skill in Projects, with no proficiency wording, is allowed and stays.
  assert.deepEqual(out.sections.projects, s.projects);
});

test("every rule a flagged skill breaks is listed at once, not only the first one the check reports", () => {
  const s = doc({
    summary: "Backend engineer with strong RAG experience building production services in Python.",
  });
  const check = checkSections(s, registry, [MASTER], JD);
  // The check reports RAG once (its first rule: written into Experience)…
  assert.equal(check.skillViolations.filter((v) => v.skill === "RAG and knowledge retrieval" && v.where === "cv").length, 1);
  // …but the repair list also carries the competency claim in the summary.
  const items = listRepairs(s, check);
  const sections = items.filter((i) => i.skills.includes("RAG and knowledge retrieval")).map((i) => i.section).sort();
  assert.deepEqual(sections, ["experience", "summary"]);
  assert.ok(items.every((i, n) => i.id === `r${n + 1}`));
  // Header lines never become items.
  assert.ok(!items.some((i) => /\|/.test(i.sentence) && i.section === "experience"));
});

test("a project tool among the lead Technical Tools on a short line leaves the line; the label stays", () => {
  const s = doc({ skills: "Functional Competencies: API design\nTechnical Tools: Python | AWS Lambda | FastAPI" });
  const items = listRepairs(s, checkSections(s, registry, [MASTER], JD));
  const tools = items.find((i) => i.section === "skills");
  assert.ok(tools, "the tools line is listed");
  const out = surgicalPass(s, items);
  assert.equal(out.sections.skills, "Functional Competencies: API design\nTechnical Tools: Python | FastAPI");
});

test("removeSkillMentions: exact list shapes only; prose is left for the model", () => {
  assert.equal(removeSkillMentions("Built LLM/RAG tools.", ["RAG and knowledge retrieval"]), "Built LLM tools.");
  assert.equal(removeSkillMentions("Built RAG/LLM tools.", ["RAG and knowledge retrieval"]), "Built LLM tools.");
  assert.equal(removeSkillMentions("Worked with Python, LangChain and Redis.", ["LangChain"]), "Worked with Python and Redis.");
  assert.equal(removeSkillMentions("Worked with Python and LangChain.", ["LangChain"]), "Worked with Python.");
  assert.equal(removeSkillMentions("Reviewed tools (Axonius, Qualys).", ["Axonius", "Qualys"]), "Reviewed tools.");
  // Prose: removing the word would leave a claim about the same work, so the model decides.
  assert.equal(removeSkillMentions("Deep experience building RAG pipelines.", ["RAG and knowledge retrieval"]), null);
  // A skills line keeps its separator and label; bold labels survive.
  assert.equal(
    removeSkillMentions("**Technical Tools:** Python | LangChain | FastAPI", ["LangChain"], true),
    "**Technical Tools:** Python | FastAPI"
  );
  assert.equal(removeSkillMentions("Tools: Python, LangChain, FastAPI", ["LangChain"], true), "Tools: Python, FastAPI");
  // The only item on a line is never emptied by the trim.
  assert.equal(removeSkillMentions("Tools: LangChain", ["LangChain"], true), null);
});

test("model edits: applied only when the rewrite passes on its own; bold comes back around kept figures", () => {
  const s = doc({
    experience: "Engineer | Northwind Labs | 2023 – 2024\n• Shipped **20+ production API modules** with a RAG layer for document search",
  });
  const items = listRepairs(s, checkSections(s, registry, [MASTER], JD));
  assert.equal(items.length, 1);
  const id = items[0].id;
  // Still names the project skill in Experience → rejected.
  const bad = normalizeRepairEdits({ edits: [{ id, replacement: "Shipped 20+ production API modules with RAG search" }] }, items);
  const rejected = applyModelEdits(s, items, bad, (it, rep) => replacementPasses(rep, it.section, registry, [MASTER], JD));
  assert.equal(rejected.rejected, 1);
  assert.equal(rejected.sections.experience, s.experience);
  // A clean rewrite is applied, and the figure is bold again.
  const good = normalizeRepairEdits({ edits: [{ id, replacement: "• Shipped 20+ production API modules for document search" }] }, items);
  const applied = applyModelEdits(s, items, good, (it, rep) => replacementPasses(rep, it.section, registry, [MASTER], JD));
  assert.equal(applied.rejected, 0);
  assert.match(applied.sections.experience, /^• Shipped \*\*20\+ production API modules\*\* for document search$/m);
  assert.equal(checkSections(applied.sections, registry, [MASTER], JD).blocking, false);
});

test("a rewrite with a figure the master CV lacks is rejected", () => {
  const s = doc({ summary: "Backend engineer with strong RAG experience." });
  const items = listRepairs(s, checkSections(s, registry, [MASTER], JD));
  const it = items.find((i) => i.section === "summary")!;
  assert.equal(replacementPasses("Backend engineer who cut costs by 45%.", it.section, registry, [MASTER], JD), false);
  assert.equal(replacementPasses("Backend engineer shipping Python services.", it.section, registry, [MASTER], JD), true);
});

test("drop: what no trim or rewrite fixed is removed, so the check always ends clean", () => {
  const s = doc({
    summary: "Backend engineer with strong RAG experience.\nShips production services in Python.",
    coverLetter: "Dear team,\nI have deep expertise in RAG systems.\nI build production services in Python.\nKind regards",
  });
  const out = dropUntilClean(s, registry, [MASTER], JD);
  const end = checkSections(out.sections, registry, [MASTER], JD);
  assert.equal(end.blocking, false);
  assert.equal(end.skillViolations.length, 0);
  assert.equal(out.sections.summary, "Ships production services in Python.");
  assert.equal(out.sections.coverLetter, "Dear team,\nI build production services in Python.\nKind regards");
  assert.ok(out.changes.some((c) => c.how === "removed" && c.section === "coverLetter"));
});

test("a figure absent from the master CV is listed with the figure and left to the model, then dropped", () => {
  const s = doc({ summary: "Backend engineer who cut infrastructure cost by 45%.\nShips production services in Python." });
  const items = listRepairs(s, checkSections(s, registry, [MASTER], JD));
  const fig = items.find((i) => i.figures.length > 0);
  assert.ok(fig);
  assert.equal(fig!.section, "summary");
  assert.deepEqual(fig!.figures, ["45%"]);
  // No exact trim for a figure.
  assert.equal(surgicalPass(s, items).changes.length, items.filter((i) => i.figures.length === 0 && i.skills.length > 0).length);
  const out = dropUntilClean(s, registry, [MASTER], JD);
  assert.equal(checkSections(out.sections, registry, [MASTER], JD).blocking, false);
  assert.ok(!/45%/.test(out.sections.summary));
});

test("a project bullet that ends up empty leaves the list", () => {
  const s = doc({ projects: { "0": ["Expert in LangChain.", "Built Docket on AWS Lambda."] } });
  const out = dropUntilClean(s, registry, [MASTER], JD);
  assert.deepEqual(out.sections.projects["0"], ["Built Docket on AWS Lambda."]);
});

test("normalizeRepairEdits keeps known ids only, one bounded sentence each", () => {
  const items = [{ id: "r1", section: "summary" as const, sentence: "x", problems: [], skills: [], figures: [] }];
  const edits = normalizeRepairEdits(
    { edits: [{ id: "r1", replacement: "•  Two   spaces\nand a line." }, { id: "r9", replacement: "unknown" }, { id: "r1" }, "junk"] },
    items
  );
  assert.deepEqual([...edits.entries()], [["r1", "Two spaces and a line."]]);
  assert.equal(normalizeRepairEdits({ edits: [{ id: "r1", replacement: "a".repeat(900) }] }, items).get("r1")!.length, 600);
  assert.equal(normalizeRepairEdits(null, items).size, 0);
  assert.equal(normalizeRepairEdits({ edits: "no" }, items).size, 0);
});

test("replaceSentence tidies the line and removes it when nothing is left", () => {
  const text = "First line.\n• Built X, with RAG.\nLast line.";
  assert.equal(replaceSentence(text, "Built X, with RAG.", "Built X."), "First line.\n• Built X.\nLast line.");
  assert.equal(replaceSentence(text, "Built X, with RAG.", ""), "First line.\nLast line.");
  assert.equal(replaceSentence(text, "Not in the text.", ""), null);
  // Bold markers in the text don't stop the match, and a whole bold span goes with it.
  const bold = "• Cut latency by **30%** with caching";
  const at = locate(bold, "Cut latency by 30% with caching");
  assert.deepEqual(at, [2, bold.length]);
  assert.equal(replaceSentence("Lead. **Deep RAG expertise.** Tail.", "Deep RAG expertise.", ""), "Lead. Tail.");
});

test("rebold puts bold back only around words that survive, once", () => {
  assert.equal(rebold("Shipped **20+ modules** in **Python**", "Shipped 20+ modules in Go"), "Shipped **20+ modules** in Go");
  assert.equal(rebold("No bold here", "Rewritten"), "Rewritten");
  assert.equal(rebold("**30%** faster", "**30%** faster"), "**30%** faster");
});

test("a document that already passes is returned unchanged", () => {
  const s = doc({ experience: "Engineer | Northwind Labs | 2023 – 2024\n• Delivered **20+ production API modules** in Python and FastAPI" });
  assert.equal(checkClaims([{ where: "cv", text: s.experience, experience: s.experience }], registry, [MASTER]).blocking, false);
  const out = dropUntilClean(s, registry, [MASTER], JD);
  assert.deepEqual(out.sections, s);
  assert.equal(out.changes.length, 0);
});

test("wordChanges names exactly what a trim took out, case kept", () => {
  assert.deepEqual(wordChanges("later LLM/RAG knowledge solutions", "later LLM knowledge solutions"), { removed: ["RAG"], added: [] });
  assert.deepEqual(wordChanges("platforms (Axonius, Qualys, Tenable, runZero) from", "platforms (Tenable, runZero) from"), { removed: ["Axonius", "Qualys"], added: [] });
  assert.deepEqual(wordChanges("Technical Tools: Python | AWS Lambda | FastAPI", "Technical Tools: Python | FastAPI"), { removed: ["AWS", "Lambda"], added: [] });
  assert.deepEqual(wordChanges("Shipped **20+ modules** with RAG", "Shipped 20+ modules for search"), { removed: ["with", "RAG"], added: ["for", "search"] });
});

test("trims report the removed words", () => {
  const s = doc();
  const out = surgicalUntilStable(s, registry, [MASTER], JD);
  const rag = out.changes.find((c) => /LLM knowledge solutions/.test(c.after));
  assert.deepEqual(rag?.removed, ["RAG"]);
});
