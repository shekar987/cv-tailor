// Unit tests for the cover letter's shape rules (lib/letterLint). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSecondPerson, restatesJd, hasHonestGap, applyLetterLint, projectDescriptor, coreProjectName, fixAreasCount, fixDoubleStops, modulesByDegree, keepDegreeModules, tidyFinishedLetter } from "../src/lib/letterLint.ts";

test("isSecondPerson: the reader's needs or benefit, not 'your team' in a plain fact", () => {
  for (const s of [
    "That work prepares you for the platform this role runs.",
    "Your team needs someone who has shipped under load.",
    "This gives you an engineer who has done it before.",
    "It is exactly what you are looking for.",
    "You will get a developer who tests everything.",
  ]) assert.equal(isSecondPerson(s), true, s);
  for (const s of [
    "I would welcome a conversation with your team.",
    "At Northwind Labs I cut response times by 25%.",
    "I am applying for the Backend Engineer role at Acme.",
    "Thank you for your time.",
  ]) assert.equal(isSecondPerson(s), false, s);
});

test("restatesJd: the posting told back to the reader", () => {
  for (const s of [
    "Your job description builds on Python and PostgreSQL.",
    "The role involves owning the data platform end to end.",
    "You are looking for an engineer with three years of Python.",
    "As the posting says, the team ships weekly.",
  ]) assert.equal(restatesJd(s), true, s);
  for (const s of ["I am applying for the Backend Engineer role at Acme.", "Your team's Python stack is where I have worked for two years."]) assert.equal(restatesJd(s), false, s);
});

test("hasHonestGap: the plain sentence that names what the CV lacks", () => {
  assert.equal(hasHonestGap("I have not yet worked with exchange market data or options pricing, and I would expect to learn that domain from your team."), true);
  assert.equal(hasHonestGap("I have no direct experience of Kubernetes; the nearest is the Docker deployment of RideX."), true);
  assert.equal(hasHonestGap("I would expect to learn the trading domain quickly."), true);
  assert.equal(hasHonestGap("At Northwind Labs I cut response times by 25%."), false);
  assert.equal(hasHonestGap(""), false);
});

test("applyLetterLint: offending sentences go, the opening and the furniture stay, an emptied paragraph disappears", () => {
  const letter = `Dear Acme team,
I am applying for the Backend Engineer role at Acme. Your job description builds on Python and PostgreSQL.
At Northwind Labs I cut response times by 25% by rebuilding REST services in FastAPI. That work prepares you for the platform this role runs.

You are looking for an engineer who tests everything.

I have not yet worked with Kafka, and I would expect to learn it from your team. I would welcome a conversation with your team.
Kind regards,
Alex Example`;
  const r = applyLetterLint(letter);
  assert.equal(
    r.text,
    `Dear Acme team,
I am applying for the Backend Engineer role at Acme.
At Northwind Labs I cut response times by 25% by rebuilding REST services in FastAPI.

I have not yet worked with Kafka, and I would expect to learn it from your team. I would welcome a conversation with your team.
Kind regards,
Alex Example`
  );
  assert.deepEqual(r.lint.restatedJd, ["Your job description builds on Python and PostgreSQL.", "You are looking for an engineer who tests everything."]);
  assert.deepEqual(r.lint.secondPerson, ["That work prepares you for the platform this role runs."]);
  // The opening is never removed, even when it reads as a restatement.
  const opening = applyLetterLint("Dear Acme team,\nYou are looking for a Backend Engineer, and I am applying for that role.\nAt Northwind Labs I cut response times by 25%.\nKind regards,\nAlex");
  assert.match(opening.text, /^Dear Acme team,\nYou are looking for a Backend Engineer/);
  assert.deepEqual(opening.lint, { secondPerson: [], restatedJd: [] });
  const clean = "Dear Acme team,\nI am applying for the role.\nKind regards,\nAlex";
  assert.equal(applyLetterLint(clean).text, clean, "the same string back when nothing changes");
});

test("a sentence that restates the posting and then turns to the candidate keeps the candidate's clause (review, 1 Oct)", () => {
  const letter = "Dear Acme team,\nI am applying for the Backend Engineer role at Acme.\nThe team is building a new payments platform, and I built Northgate's LLM platform from the first commit.\nKind regards,\nAlex";
  const r = applyLetterLint(letter);
  assert.ok(r.text.includes("I built Northgate's LLM platform from the first commit."), r.text);
  assert.ok(!r.text.includes("The team is building"), r.text);
  assert.equal(r.lint.restatedJd.length, 1);
});

// ── The 30 Oct rules (Chunk 5) ──────────────────────────────────────────────
const RULES_OPTS = {
  essentialGaps: ["exchange market data"],
  projects: ["RideX (personal portfolio project modelled on a real-world brief)", "Ledgerly | 2025"],
};

test("a letter with all four problems comes back clean: banned phrases, extra gaps, a repeated fact, RideX's description", () => {
  const letter = `Dear Acme team,
I am writing to express my interest in the Backend Engineer role at Acme.
At Northwind Labs I cut API response times by 40% by rebuilding the REST services in FastAPI. I am passionate about building reliable systems at your company.
I built RideX, a ride-hailing app, with FastAPI and PostgreSQL. Although I have not used Kafka, I built an event queue with Redis streams. I am eager to learn your stack.
The 40% cut in response times came from caching. I have not worked with Kubernetes. RideX handled 500 simulated bookings a minute in load tests. I believe I would be a great fit for this team.
I have not yet worked with exchange market data, and I would expect to learn that domain from your team. I would welcome a conversation.
Kind regards,
Alex Example`;
  const r = applyLetterLint(letter, RULES_OPTS);
  assert.equal(
    r.text,
    `Dear Acme team,
I am applying for the Backend Engineer role at Acme.
At Northwind Labs I cut API response times by 40% by rebuilding the REST services in FastAPI. I am interested in building reliable systems.
I built RideX, a personal portfolio project modelled on a real-world brief, with FastAPI and PostgreSQL. I built an event queue with Redis streams.
I have not yet worked with exchange market data, and I would expect to learn that domain from your team. I would welcome a conversation.
Kind regards,
Alex Example`
  );
  assert.deepEqual(r.rules.bannedPhrases, ["I am writing to express", "passionate about", "at your company", "eager to learn", "I believe I would be a great fit"]);
  assert.deepEqual(r.rules.extraGaps, ["Although I have not used Kafka, I built an event queue with Redis streams.", "I have not worked with Kubernetes."]);
  assert.deepEqual(r.rules.repeatedFacts, ["The 40% cut in response times came from caching.", "RideX handled 500 simulated bookings a minute in load tests."]);
  assert.deepEqual(r.rules.projectDescriptors, ["RideX"]);
  // Clean means clean: the result passes the lint with nothing left to change.
  const again = applyLetterLint(r.text, RULES_OPTS);
  assert.equal(again.text, r.text);
  assert.deepEqual(again.rules, { bannedPhrases: [], extraGaps: [], repeatedFacts: [], projectDescriptors: [] });
  assert.deepEqual(again.lint, { secondPerson: [], restatedJd: [] });
});

test("one gap sentence at most, and only for an essential gap; without the route's list the gap rule is off", () => {
  const letter = "Dear Acme team,\nI am applying for the role.\nI have not yet worked with exchange market data. I have not used options pricing either.\nKind regards,\nAlex";
  const r = applyLetterLint(letter, { essentialGaps: ["exchange market data", "options pricing"] });
  assert.equal(r.text, "Dear Acme team,\nI am applying for the role.\nI have not yet worked with exchange market data.\nKind regards,\nAlex", "the second gap goes even though it is essential");
  assert.equal(applyLetterLint(letter).text, letter, "no essentialGaps given: untouched");
  assert.equal(applyLetterLint(letter, { essentialGaps: [] }).rules.extraGaps.length, 2, "nothing essential is missing: every gap sentence goes");
});

test("a fact repeated inside one paragraph stays; the RideX description is never doubled, and a bracketed one becomes the master's", () => {
  const same = "Dear Acme team,\nI am applying for the role.\nI cut costs by 40%. The 40% came from caching.\nKind regards,\nAlex";
  assert.equal(applyLetterLint(same, RULES_OPTS).text, same);
  const bracket = "Dear Acme team,\nI am applying for the role.\nOn RideX (my side project) I built the booking API.\nKind regards,\nAlex";
  assert.match(applyLetterLint(bracket, RULES_OPTS).text, /On RideX, a personal portfolio project modelled on a real-world brief, I built the booking API\./);
  const end = "Dear Acme team,\nI am applying for the role.\nMy strongest project is RideX.\nKind regards,\nAlex";
  assert.match(applyLetterLint(end, RULES_OPTS).text, /My strongest project is RideX, a personal portfolio project modelled on a real-world brief\.\n/);
  const signed = "Dear RideX team,\nI am applying for the role.\nKind regards,\nAlex";
  assert.equal(applyLetterLint(signed, RULES_OPTS).text, signed, "the salutation is never touched");
});

test("projectDescriptor reads the master CV's bracketed description; a stack list or a short tag is not one", () => {
  assert.deepEqual(projectDescriptor("RideX (personal portfolio project modelled on a real-world brief)"), { name: "RideX", descriptor: "a personal portfolio project modelled on a real-world brief" });
  assert.deepEqual(projectDescriptor("Atlas (an internal analytics dashboard) | 2024"), { name: "Atlas", descriptor: "an internal analytics dashboard" });
  assert.equal(projectDescriptor("Jobhuntz (Next.js, Supabase, Claude)"), null);
  assert.equal(projectDescriptor("Ledgerly (2025)"), null);
  assert.equal(coreProjectName("RideX (personal portfolio project modelled on a real-world brief) | 2025"), "RideX");
});

// ── The final tidy (31 Oct, Chunk 6) ──────────────────────────────────────

const FIXED = "Having read the job description, these are the four areas where I can add value from the start:";

test("fixAreasCount: the intro line says how many numbered points there really are", () => {
  const letter = `Dear Acme Hiring Team,\n\nI am applying for the Software Engineer role.\n\n${FIXED}\n1. Python services.\n2. React interfaces.\n3. Testing.\n\nKind regards,\nAlex Morgan`;
  const r = fixAreasCount(letter);
  assert.deepEqual(r.fixed, { from: "four", to: "three" });
  assert.match(r.text, /these are the three areas where I can add value/);
  // Four points under "four areas": untouched.
  const four = letter.replace("3. Testing.", "3. Testing.\n4. Delivery.");
  assert.equal(fixAreasCount(four).text, four);
  // A count in the body is a fact, not the list's intro.
  const body = "Dear Acme team,\n\nI worked in three areas of the platform.\n1. One.\n2. Two.";
  assert.equal(fixAreasCount(body).fixed, null);
  // No numbered points at all: nothing to count against.
  assert.equal(fixAreasCount(`Dear Acme team,\n\n${FIXED}\nPython and React.`).fixed, null);
});

test("fixDoubleStops: 'Inc..' loses its second stop; an ellipsis stays", () => {
  const r = fixDoubleStops("I am applying for the role at Acme Inc.. My work at Northgate Systems Ltd.. shipped… and then...");
  assert.equal(r.text, "I am applying for the role at Acme Inc. My work at Northgate Systems Ltd. shipped… and then...");
  assert.equal(r.count, 2);
});

const MASTER_EDU = `EDUCATION
MSc Computer Science (with Industrial Placement) — University of Hartwell Jan 2025 – Jan 2027
Modules: Machine Learning, Cloud Computing, Big Data Analytics
BTech Computer Science — Riverside Institute of Technology Jul 2019 – Jul 2023
Relevant modules: Compiler Design, Operating Systems, Data Structures`;

test("modulesByDegree reads each degree's own module list", () => {
  const m = modulesByDegree(MASTER_EDU);
  assert.deepEqual(m.get("msc"), ["Machine Learning", "Cloud Computing", "Big Data Analytics"]);
  assert.deepEqual(m.get("btech"), ["Compiler Design", "Operating Systems", "Data Structures"]);
});

test("keepDegreeModules: a module from the other degree leaves the MSc's list", () => {
  const letter = "Dear Acme team,\n\nMy MSc modules include Machine Learning, Operating Systems and Cloud Computing.\n\nKind regards,\nAlex Morgan";
  const r = keepDegreeModules(letter, MASTER_EDU);
  assert.deepEqual(r.removed, ["Operating Systems"]);
  assert.match(r.text, /My MSc modules include Machine Learning and Cloud Computing\./);
});

test("keepDegreeModules: no module of the named degree left — the sentence goes; other sentences stay", () => {
  const letter = "Dear Acme team,\n\nI built APIs. My MSc coursework covered Compiler Design. I shipped 20+ modules.\n\nKind regards,\nAlex Morgan";
  const r = keepDegreeModules(letter, MASTER_EDU);
  assert.deepEqual(r.removed, ["Compiler Design"]);
  assert.match(r.text, /I built APIs\. I shipped 20\+ modules\./);
  assert.doesNotMatch(r.text, /coursework/);
});

test("keepDegreeModules: both degrees named, or none, or the right ones — left alone", () => {
  const both = "Dear Acme team,\n\nMy BTech and MSc modules included Compiler Design and Machine Learning.";
  assert.equal(keepDegreeModules(both, MASTER_EDU).text, both);
  const none = "Dear Acme team,\n\nMy modules included Compiler Design and Machine Learning.";
  assert.equal(keepDegreeModules(none, MASTER_EDU).text, none);
  const right = "Dear Acme team,\n\nMy BTech modules included Compiler Design and Data Structures.";
  assert.equal(keepDegreeModules(right, MASTER_EDU).text, right);
  assert.equal(keepDegreeModules(right, "no education section").removed.length, 0);
});

test("tidyFinishedLetter runs all three and reports each", () => {
  const letter = `Dear Acme Inc.. Hiring Team,\n\nI am applying for the Software Engineer role.\n\nMy MSc modules include Machine Learning and Operating Systems.\n\n${FIXED}\n1. Python.\n2. React.\n\nKind regards,\nAlex Morgan`;
  const r = tidyFinishedLetter(letter, MASTER_EDU);
  assert.deepEqual(r.tidy, { areasCount: { from: "four", to: "two" }, otherDegreeModules: ["Operating Systems"], doubleStops: 1 });
  assert.match(r.text, /^Dear Acme Inc\. Hiring Team,/);
  assert.match(r.text, /My MSc modules include Machine Learning\./);
  assert.match(r.text, /these are the two areas/);
  // A second pass changes nothing.
  assert.deepEqual(tidyFinishedLetter(r.text, MASTER_EDU).tidy, { areasCount: null, otherDegreeModules: [], doubleStops: 0 });
});

test("fixAreasCount: 'four areas' over two LABELLED areas says two", () => {
  const letter = `Dear Acme Hiring Team,\n\nI am applying for the Software Engineer role.\n\n${FIXED}\nBackend delivery: 20+ production API modules in Python.\nFrontend: React interfaces used daily by operations staff.\n\nThank you for considering my application.\n\nKind regards,\nAlex Morgan`;
  const r = fixAreasCount(letter);
  assert.deepEqual(r.fixed, { from: "four", to: "two" });
  assert.match(r.text, /these are the two areas where I can add value/);
  // Bullets count the same way.
  const bullets = letter.replace("Backend delivery:", "• Backend delivery:").replace("Frontend:", "• Frontend:");
  assert.equal(fixAreasCount(bullets).fixed?.to, "two");
});

test("fixDoubleStops: the Uncountable letter's 'Inc..'", () => {
  assert.equal(fixDoubleStops("I am applying for the Software Engineer role at Uncountable Inc.. My work at Northgate Systems").text, "I am applying for the Software Engineer role at Uncountable Inc. My work at Northgate Systems");
});

test("modules from education[i] attach only to that degree (the extracted profile's entries)", () => {
  const education = [
    { degree: "MSc Computer Science (with Industrial Placement)", note: "Modules: Machine Learning, Cloud Computing" },
    { degree: "BTech Computer Science", note: "Modules: Compiler Design, Operating Systems" },
  ];
  const m = modulesByDegree("", education);
  assert.deepEqual(m.get("msc"), ["Machine Learning", "Cloud Computing"]);
  assert.deepEqual(m.get("btech"), ["Compiler Design", "Operating Systems"]);
  const letter = "Dear Acme team,\n\nMy MSc modules included Machine Learning, Compiler Design and Cloud Computing.\n\nKind regards,\nAlex Morgan";
  const r = tidyFinishedLetter(letter, "no modules in the CV text", education);
  assert.deepEqual(r.tidy.otherDegreeModules, ["Compiler Design"]);
  assert.match(r.text, /My MSc modules included Machine Learning and Cloud Computing\./);
});
