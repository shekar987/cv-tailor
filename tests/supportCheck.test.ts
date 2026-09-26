// Unit tests for the sentence-by-sentence fact check of the summary and the
// cover letter (lib/supportCheck), and the letter's furniture
// (lib/letterFormat). node:test, zero dependencies. Every text is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  supportSentences,
  normalizeSupportVerdicts,
  decideSupport,
  quoteInSource,
  contentOverlap,
  trimNarration,
  narrationProblem,
  dropRepeatedSentences,
  fixHeldDegrees,
  statesDegreeAsHeld,
  mergedProjects,
  isMergeProblem,
} from "../src/lib/supportCheck.ts";
import { degreesInProgress } from "../src/lib/headline.ts";
import { normalizeLetter, capEmDashes } from "../src/lib/letterFormat.ts";

const CV = `Backend Engineer — Northwind Labs · Jul 2023 – Present
- Built REST services in Python and FastAPI, cutting response times by 25%
- Optimised PostgreSQL queries with indexing and caching, improving read times by 30%`;

const LETTER = `Dear Northwind team,
I am applying for the Platform Engineer role because your billing platform runs on Python.
At Northwind Labs I cut response times by 25% by rebuilding REST services in FastAPI.
The value of that work only became clear after I spent time with the teams asking which screens were slow.
Thank you for your time.
Kind regards,
Alex Example`;

test("sentences to check: summary lines and letter body, never the furniture", () => {
  const s = supportSentences("Backend engineer shipping Python services. Cut read times by 30%.", LETTER);
  assert.deepEqual(
    s.map((x) => `${x.id}:${x.sentence.slice(0, 22)}`),
    ["s1:Backend engineer shipp", "s2:Cut read times by 30%.", "l1:I am applying for the ", "l2:At Northwind Labs I cu", "l3:The value of that work"]
  );
});

test("quotes are verified against the source; paraphrases and invented figures are not", () => {
  assert.equal(quoteInSource("Built REST services in Python and FastAPI, cutting response times by 25%", CV), true);
  assert.equal(quoteInSource("built REST services in Python and FastAPI", CV), true);
  assert.equal(quoteInSource("Built REST services in Python and FastAPI, cutting response times by 45%", CV), false);
  assert.equal(quoteInSource("Worked closely with product teams on screen performance", CV), false);
  assert.ok(contentOverlap("At Northwind Labs I cut response times by 25% by rebuilding REST services in FastAPI.", ["Built REST services in Python and FastAPI, cutting response times by 25%"]) > 0.5);
  assert.ok(contentOverlap("I spent time with the teams asking which screens were slow.", ["Built REST services in Python and FastAPI, cutting response times by 25%"]) < 0.25);
});

test("the invented anecdote is removed, a supported claim kept, a fix applied only when accepted", () => {
  const sentences = supportSentences("Backend engineer shipping Python services.", LETTER);
  const raw = {
    checks: [
      { id: "s1", supported: true, support: ["Built REST services in Python and FastAPI, cutting response times by 25%"] },
      { id: "l2", supported: true, support: ["Built REST services in Python and FastAPI, cutting response times by 25%"] },
      { id: "l3", supported: false, support: [], fix: "" },
      { id: "l1", supported: false, support: [], fix: "I am applying for the Platform Engineer role." },
      { id: "zz", supported: false, fix: "unknown id is ignored" },
    ],
  };
  const verdicts = normalizeSupportVerdicts(raw, sentences);
  assert.equal(verdicts.size, 4);
  const decisions = decideSupport(sentences, verdicts, [CV], (_s, fix) => !/Platform Engineer role\.$/.test(fix) || true);
  const by = Object.fromEntries(decisions.map((d) => [d.id, d]));
  assert.equal(by.s1.action, "keep");
  assert.equal(by.l2.action, "keep");
  assert.equal(by.l3.action, "remove");
  assert.equal(by.l1.action, "rewrite");
  assert.equal(by.l4, undefined, "courtesy (Thank you…) is never checked");
  // The caller's gate refuses a fix → the sentence is removed instead.
  const refused = decideSupport(sentences, verdicts, [CV], () => false);
  assert.equal(refused.find((d) => d.id === "l1")!.action, "remove");
});

test("a 'supported' verdict whose quote cannot be found is reported, not acted on", () => {
  const sentences = supportSentences("Led a team of 6 engineers at Northwind Labs.", "");
  const verdicts = normalizeSupportVerdicts({ checks: [{ id: "s1", supported: true, support: ["Led a team of 6 engineers"] }] }, sentences);
  assert.equal(decideSupport(sentences, verdicts, [CV])[0].action, "unverified");
});

test("letter furniture: a company addressed as a person, a missing sign-off, a model date line", () => {
  const a = normalizeLetter("Dear Northwind,\nI am applying.\nAlex Example", { company: "Northwind", name: "ALEX EXAMPLE" });
  assert.equal(a.letter, "Dear Northwind team,\nI am applying.\nKind regards,\nAlex Example");
  assert.equal(a.fixes.salutation, "Dear Northwind team,");
  assert.equal(a.fixes.signOff, true);
  const b = normalizeLetter("20 September 2026\nDear Hiring Manager,\nI am applying.", { company: "Northwind", name: "Alex Example" });
  assert.equal(b.letter, "Dear Hiring Manager,\nI am applying.\n\nKind regards,\nAlex Example");
  assert.equal(b.fixes.dateLine, true);
  const c = normalizeLetter("Dear Northwind hiring team,\nI am applying.\nBest regards,\nAlex Example", { company: "Northwind", name: "Alex Example" });
  assert.equal(c.letter, "Dear Northwind hiring team,\nI am applying.\nBest regards,\nAlex Example");
  assert.deepEqual(c.fixes, { salutation: null, signOff: false, dateLine: false });
  const d = normalizeLetter("Dear Hiring Manager,\nI am applying.\nKind regards,", { name: "Alex Example" });
  assert.equal(d.letter, "Dear Hiring Manager,\nI am applying.\nKind regards,\nAlex Example");
  assert.deepEqual(normalizeLetter("", {}).fixes, { salutation: null, signOff: false, dateLine: false });
});

test("narration and self-grading are flagged and must be fixed; a true fact is never deleted for it", () => {
  const letter = "Dear Hiring Manager,\nI built REST services in FastAPI, cutting response times by 25%, the foundation this role needs from day one.\nI am based in London and available for hybrid work.\nThank you for your time.";
  const s = supportSentences("", letter);
  assert.equal(s.length, 1, "availability and courtesy lines are skipped");
  assert.equal(s[0].problems.length, 1);
  // The model called it supported and gave no fix: the narrating clause is cut.
  const verdicts = normalizeSupportVerdicts({ checks: [{ id: "l1", supported: true, support: ["Built REST services in Python and FastAPI, cutting response times by 25%"] }] }, s);
  const d = decideSupport(s, verdicts, [CV])[0];
  assert.equal(d.action, "rewrite");
  assert.equal(d.replacement, "I built REST services in FastAPI, cutting response times by 25%.");
  // Not listed at all: the same fallback.
  assert.equal(decideSupport(s, new Map(), [CV])[0].replacement, "I built REST services in FastAPI, cutting response times by 25%.");
  assert.equal(trimNarration("This taught me patience."), null, "nothing clean is left, so no trim");
});

test("a name copied in capitals from the CV header signs in normal case", () => {
  const r = normalizeLetter("Dear Hiring Manager,\nI am applying.\nKind regards,\nALEX EXAMPLE", { name: "ALEX EXAMPLE" });
  assert.equal(r.letter, "Dear Hiring Manager,\nI am applying.\nKind regards,\nAlex Example");
});

test("relative time and unevidenced teamwork are flagged for a fix", () => {
  const letter = "Dear Hiring Manager,\nI've spent the last year shipping production Python code at Northwind Labs.\nThat work involved designing APIs and collaborating across teams.\nKind regards,\nAlex Example";
  const s = supportSentences("", letter);
  assert.deepEqual(s.map((x) => x.problems.length), [1, 1]);
});

test("a fact-check fix that restates a neighbouring sentence is refused; the sentence goes instead", () => {
  // The Somak letter (26 Sep): the fix for a narrating line copied the sentence before it.
  const letter =
    "Dear Hiring Manager,\nAt Northwind Labs I built REST services in Python and FastAPI, cutting response times by 25%. That work taught me to read unfamiliar systems quickly.\nKind regards,\nAlex Example";
  const sentences = supportSentences("", letter);
  const verdicts = normalizeSupportVerdicts(
    { checks: [{ id: "l2", supported: false, support: [], fix: "At Northwind Labs I built REST services in Python and FastAPI, which cut response times by 25%." }] },
    sentences
  );
  const d = decideSupport(sentences, verdicts, [CV]).find((x) => x.id === "l2")!;
  assert.equal(d.action, "remove");
});

test("dropRepeatedSentences: the later telling of the same fact goes, different facts stay", () => {
  const text =
    "Dear Hiring Manager,\nIn my role as Research Assistant at the University of East London, I analysed 11 industry asset-management platforms and produced a comparative gap analysis. In my Research Assistant role I analysed 11 industry asset-management platforms and produced a comparative gap analysis identifying gaps across those platforms. I hold a BSc Computer Science with Distinction.\n\nAt Northwind Labs I built REST services in Python and FastAPI. At Northwind Labs I optimised PostgreSQL queries with indexing and caching.\nKind regards,\nAlex Example";
  const r = dropRepeatedSentences(text);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0], /^In my Research Assistant role/);
  assert.match(r.text, /comparative gap analysis\. I hold a BSc/);
  assert.match(r.text, /optimised PostgreSQL queries/, "two different facts about one employer both stay");
  assert.deepEqual(dropRepeatedSentences("Kind regards,\nAlex Example").dropped, []);
});

test("a degree still in progress is never stated as held; a completed one is left alone", () => {
  const inProgress = degreesInProgress(
    [
      { degree: "MSc Computer Science", dates: "Jan 2025 – Jan 2027" },
      { degree: "BSc Computer Science", dates: "Jul 2019 – Jul 2023", note: "Graduated with Distinction." },
      { degree: "MSc Data Science", dates: "Sep 2025 – Jun 2026" },
    ],
    new Date("2026-09-26T12:00:00Z")
  );
  assert.deepEqual(inProgress, ["MSc Computer Science"], "month precision: June 2026 has passed, January 2027 has not");
  const letter = fixHeldDegrees("I hold an MSc in Computer Science (Industrial Placement) from the University of East London, graduating January 2027.", inProgress);
  assert.equal(letter.text, "I am completing an MSc in Computer Science (Industrial Placement) from the University of East London, graduating January 2027.");
  const summary = fixHeldDegrees("Research Assistant at the University of East London, and hold an MSc Computer Science (Industrial Placement) expected Jan 2027.", inProgress);
  assert.match(summary.text, /and am completing an MSc Computer Science/);
  // The completed BSc stays held; a Master's-level phrase and a possessive are not degrees held.
  assert.equal(fixHeldDegrees("I hold a BSc Computer Science with Distinction.", inProgress).changed.length, 0);
  assert.equal(fixHeldDegrees("I have a Master's-level grounding in cloud computing.", inProgress).changed.length, 0);
  assert.equal(fixHeldDegrees("I completed the MSc's first year with a Distinction average.", inProgress).changed.length, 0);
  assert.equal(statesDegreeAsHeld("I have completed an MSc in Computer Science.", inProgress), true);
  assert.equal(statesDegreeAsHeld("I am completing an MSc in Computer Science.", inProgress), false);
  assert.equal(fixHeldDegrees("I hold an MSc.", []).changed.length, 0, "no degree in progress → nothing to fix");
});

test("the 26 Sep narration shapes are flagged", () => {
  for (const s of [
    "That work required understanding business workflows—exactly the skill set luxury travel quotations and pricing systems demand.",
    "That project built a mindset directly applicable to working with established reservation systems.",
    "I bring a product mindset to every feature.",
    "The problem you are solving maps directly to work I have done: I built event-driven pipelines.",
    "Courier software demands the same tight feedback loops and measurement discipline I have practised.",
    "Git and CI/CD proficiency across 9 end-to-end projects at CodSoft.",
  ]) assert.ok(narrationProblem(s), s);
  assert.equal(narrationProblem("At Northwind Labs I built REST services in Python and FastAPI, cutting response times by 25%."), null);
});

test("one project's facts told as another's are flagged, and a fix that merges projects is refused", () => {
  const projects = [
    { name: "Jobhuntz", text: "Secured multi-tenant data with Supabase Auth (3 OAuth methods), row-level security and AES-256-GCM encryption" },
    { name: "RideX", text: "Engineered 8 serverless REST APIs with idempotent Stripe processing and 3-D Secure compliance for a three-portal marketplace; real-time Firestore listeners" },
  ];
  const paidWork = "Built secure FastAPI backend services with JWT authentication and RBAC";
  // The Base360 letter (26 Sep): Jobhuntz's Supabase Auth inside a RideX sentence.
  const merged = "In a personal portfolio project, I engineered idempotent Stripe processing with 3-D Secure compliance for a three-portal marketplace and integrated Supabase Auth with 3 OAuth methods.";
  assert.deepEqual(mergedProjects(merged, projects, paidWork).sort(), ["Jobhuntz", "RideX"]);
  assert.deepEqual(mergedProjects("In RideX I built idempotent Stripe processing, and in Jobhuntz I added Supabase Auth with 3 OAuth methods.", projects, paidWork), [], "both named: each fact keeps its project");
  assert.deepEqual(mergedProjects("In RideX, a personal project, I engineered idempotent Stripe processing with 3-D Secure compliance.", projects, paidWork), []);
  const letter = `Dear Hiring Manager,\n${merged}\nKind regards,\nAlex Example`;
  const sentences = supportSentences("", letter, { projects, paidWork });
  assert.ok(isMergeProblem(sentences[0]));
  // The model calls it supported and offers no fix: it still goes.
  const v = normalizeSupportVerdicts({ checks: [{ id: "l1", supported: true, support: [] }] }, sentences);
  assert.equal(decideSupport(sentences, v, [CV])[0].action, "remove");
});

test("a fix that mostly repeats the rest of its section is refused", () => {
  const letter =
    "Dear Hiring Manager,\nThe chance to work on billing appeals to me because I like hard data problems.\nAt Northwind Labs I built REST services in Python and FastAPI, cutting response times by 25%, and optimised PostgreSQL queries with indexing and caching.\nKind regards,\nAlex Example";
  const sentences = supportSentences("", letter);
  const v = normalizeSupportVerdicts(
    { checks: [{ id: "l1", supported: false, support: [], fix: "At Northwind Labs I built REST services in Python and FastAPI and optimised PostgreSQL queries." }] },
    sentences
  );
  assert.equal(decideSupport(sentences, v, [CV]).find((d) => d.id === "l1")!.action, "remove");
});

test("capEmDashes: one em-dash at most — pairs become brackets, later singles commas", () => {
  const letter =
    "Dear Base360.ai team,\nAt Brane Group I shipped 20+ production API modules that handled real workflows—dashboards, forms, automation services—across multiple resource categories. I optimised data access across PostgreSQL and Redis—indexing, query tuning, caching—which cut response times by 30%.\nI build features and ship them—and I like it. Then more—and more.\nKind regards,\nAlex Example";
  const r = capEmDashes(letter);
  assert.equal((r.text.match(/—/g) || []).length, 1);
  assert.match(r.text, /real workflows \(dashboards, forms, automation services\) across multiple/);
  assert.match(r.text, /Redis \(indexing, query tuning, caching\) which cut/);
  assert.match(r.text, /ship them—and I like it\. Then more, and more\./);
  assert.equal(capEmDashes("No dashes here.").replaced, 0);
  // normalizeLetter applies it and reports it.
  const n = normalizeLetter(letter, { name: "Alex Example" });
  assert.equal(((n.letter as string).match(/—/g) || []).length, 1);
  assert.equal(n.fixes.emDashes, 5);
});
