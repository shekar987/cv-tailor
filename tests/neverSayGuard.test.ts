// JH-4 (24 Nov 2026): the user's "Wording your CV must never say" list (lib/retiredClaims,
// stored in user_settings.preferences.retiredClaims, edited on My CV) is enforced in CODE,
// not only asked of the model — the sweep of 23-24 Nov found "OpenAI API" in Skills and
// "Java" in the Headline because, at tailoring time, the list did not yet hold them and
// factGuard's own over-claimed-tools guard kept both (the claims registry names "OpenAI
// API", and the master CV names "Java" once). Once a phrase is on the list, applyRetired
// removes it from the headline, summary, skills, experience, project bullets and the letter
// WHATEVER the registry or master CV say, on every tailoring path (UI, API, fallback).
//
// These lock that behaviour, and the located notice (where each removal acted) added in JH-4.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRetired,
  applyRetiredToBullets,
  parseRetiredClaims,
  locateRetired,
  neverSayNotice,
  normalizeRetiredLocations,
} from "../src/lib/retiredClaims.ts";

const neverSay = () => parseRetiredClaims("OpenAI API\nJava");

test("a never-say skill is dropped from a grouped Skills block, cleanly", () => {
  const skills = "Technical Tools: Python, Java, React\nAI & LLM: OpenAI API, LangChain, RAG\nCloud & DevOps: AWS, Docker";
  const r = applyRetired(skills, neverSay());
  assert.ok(!/\bJava\b/.test(r.text), "Java gone");
  assert.ok(!/OpenAI API/i.test(r.text), "OpenAI API gone");
  // No dangling comma, no doubled comma, no trailing separator on a line.
  assert.doesNotMatch(r.text, /,\s*,|,\s*$|:\s*,|,\s*\n/m, "no dangling comma");
  assert.equal(r.text, "Technical Tools: Python, React\nAI & LLM: LangChain, RAG\nCloud & DevOps: AWS, Docker");
  assert.deepEqual(r.report.removed.sort(), ["Java", "OpenAI API"]);
});

test("a never-say skill that is a group's only item takes the empty heading with it", () => {
  const skills = "AI & LLM: OpenAI API\nCloud & DevOps: AWS, Docker";
  const r = applyRetired(skills, neverSay());
  assert.equal(r.text, "Cloud & DevOps: AWS, Docker");
  assert.doesNotMatch(r.text, /AI & LLM:/, "empty group heading removed");
});

test("a never-say item is dropped from the Headline, leaving no empty slot", () => {
  const headline = "Software Engineer | 2 years' experience | Python, Java, React";
  const r = applyRetired(headline, neverSay());
  assert.equal(r.text, "Software Engineer | 2 years' experience | Python, React");
  assert.doesNotMatch(r.text, /\|\s*\||\|\s*$|,\s*,|,\s*$/, "no empty slot, no dangling comma");
});

test("a never-say item removes the sentence it sits in from the Summary", () => {
  const summary = "Full-stack engineer with two years in production.\nBuilt Java microservices at scale.";
  const r = applyRetired(summary, parseRetiredClaims("Java"));
  assert.ok(!/\bJava\b/.test(r.text), "Java sentence gone");
  assert.ok(/Full-stack engineer with two years/.test(r.text), "the clean sentence stays");
  assert.deepEqual(r.report.removed, ["Java"]);
});

test("a never-say item removes the sentence from the cover letter", () => {
  const letter = "Dear Hiring Manager,\nI build reliable web services.\nI have shipped Java platforms for millions of users.\nKind regards,\nAlex";
  const r = applyRetired(letter, parseRetiredClaims("Java"));
  assert.ok(!/\bJava\b/.test(r.text), "Java claim gone");
  assert.ok(/Dear Hiring Manager/.test(r.text) && /Kind regards/.test(r.text), "furniture kept");
});

test("a never-say item removes a project bullet that says it", () => {
  const projects = { "0": ["Designed a REST API in Python.", "Ported the service to Java for the client."] };
  const r = applyRetiredToBullets(projects, parseRetiredClaims("Java"));
  assert.deepEqual(r.projects["0"], ["Designed a REST API in Python."]);
  assert.deepEqual(r.report.removed, ["Java"]);
});

test("matching is whole-phrase: 'Java' never hits 'JavaScript', 'OpenAI API' never hits 'OpenAI-compatible'", () => {
  const skills = "Languages: JavaScript, TypeScript";
  assert.equal(applyRetired(skills, parseRetiredClaims("Java")).text, skills, "JavaScript survives");
  const prose = "Built an OpenAI-compatible gateway and shipped an OpenAI Codex tool.";
  assert.equal(applyRetired(prose, parseRetiredClaims("OpenAI API")).text, prose, "OpenAI-compatible / OpenAI Codex survive");
});

test("matching is case-insensitive", () => {
  const skills = "Tools: java, OPENAI api, Docker";
  const r = applyRetired(skills, neverSay());
  assert.equal(r.text, "Tools: Docker");
});

test("the user's rule wins even where the master CV / registry names the skill", () => {
  // applyRetired has no backing concept: it removes whatever is on the user's list,
  // whether or not the skill is genuine. That is the point — on 23-24 Nov the guard kept
  // Java and OpenAI API precisely because the registry/master CV backed them.
  const skills = "Languages: Java, Python"; // a master CV that genuinely names Java
  const r = applyRetired(skills, parseRetiredClaims("Java"));
  assert.equal(r.text, "Languages: Python");
});

test("an empty never-say list changes nothing (no regression for other users)", () => {
  const skills = "Technical Tools: Python, Java, OpenAI API, React";
  const r = applyRetired(skills, parseRetiredClaims(""));
  assert.equal(r.text, skills);
  assert.deepEqual(r.report.removed, []);
  assert.deepEqual(r.report.replaced, []);
});

// ── The located notice (JH-4) ────────────────────────────────────────────────

test("locateRetired tags each removal with its section", () => {
  const skills = "AI & LLM: OpenAI API, LangChain";
  const r = applyRetired(skills, parseRetiredClaims("OpenAI API"));
  const located = locateRetired("Skills", r.report);
  assert.deepEqual(located, [{ where: "Skills", phrase: "OpenAI API", kind: "removed" }]);
});

test("neverSayNotice names each phrase and where it went, on one line", () => {
  const located = [
    { where: "Skills" as const, phrase: "OpenAI API", kind: "removed" as const },
    { where: "Headline" as const, phrase: "Java", kind: "removed" as const },
    { where: "Skills" as const, phrase: "Java", kind: "removed" as const },
  ];
  const line = neverSayNotice(located);
  assert.match(line, /^Removed because you asked us never to say it: /);
  assert.match(line, /OpenAI API \(Skills\)/);
  assert.match(line, /Java \(Headline, Skills\)/);
  assert.ok(!line.includes("\n"), "one line");
});

test("neverSayNotice is empty when nothing was removed (replacements keep their own line)", () => {
  assert.equal(neverSayNotice([]), "");
  assert.equal(neverSayNotice([{ where: "Summary", phrase: "X => Y", kind: "replaced", to: "Y" }]), "");
});

test("normalizeRetiredLocations drops anything malformed", () => {
  const raw = [
    { where: "Skills", phrase: "OpenAI API", kind: "removed" },
    { where: "Nowhere", phrase: "X", kind: "removed" }, // bad where
    { where: "Headline", phrase: "", kind: "removed" }, // empty phrase
    { where: "Summary", phrase: "Java", kind: "banana" }, // unknown kind → removed
    "not an object",
  ];
  const out = normalizeRetiredLocations(raw);
  assert.deepEqual(out, [
    { where: "Skills", phrase: "OpenAI API", kind: "removed" },
    { where: "Summary", phrase: "Java", kind: "removed" },
  ]);
  assert.deepEqual(normalizeRetiredLocations("nope"), []);
});
