import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRetired, applyRetiredToBullets, applyRetiredToProfile, findRetired, formatRetiredClaims, mergeReports, normalizeRetiredClaims, parseRetiredClaims, retiredBlockMessage,
  MAX_RETIRED_CLAIMS,
} from "../src/lib/retiredClaims.ts";
import { fixAreasCount } from "../src/lib/letterLint.ts";
import { normalizePreferences } from "../src/lib/preferences.ts";

const RULES = parseRetiredClaims(`idempotent Payments => Payments
sharded platform architecture
exactly once => idempotently
Lead Engineer (Placement) => Research Assistant, Web (Acme Tool)`);

test("a list reads one rule a line, with or without a replacement", () => {
  assert.deepEqual(parseRetiredClaims("foo bar\nbaz qux => quux\n→ nothing\n\nx\nFOO BAR"), [
    { phrase: "foo bar", replacement: null },
    { phrase: "baz qux", replacement: "quux" },
  ]);
  assert.equal(parseRetiredClaims(5).length, 0);
  assert.equal(parseRetiredClaims(Array.from({ length: MAX_RETIRED_CLAIMS + 9 }, (_, i) => `phrase number ${i}`).join("\n")).length, MAX_RETIRED_CLAIMS);
});

test("the list round-trips, and a stored value is re-bounded on read", () => {
  assert.deepEqual(parseRetiredClaims(formatRetiredClaims(RULES)), RULES);
  assert.deepEqual(normalizeRetiredClaims(RULES), RULES);
  assert.deepEqual(normalizeRetiredClaims("nope"), []);
  assert.deepEqual(normalizeRetiredClaims([{ phrase: 5 }, null, { phrase: "ok phrase", replacement: 7 }]), [{ phrase: "ok phrase", replacement: null }]);
});

test("preferences keep the list through a read and a save", () => {
  assert.deepEqual(normalizePreferences({ retiredClaims: RULES }).retiredClaims, RULES);
  assert.deepEqual(normalizePreferences({}).retiredClaims, []);
});

test("matching ignores case, hyphens against spaces, and bold between words, never part of a word", () => {
  assert.deepEqual(findRetired("Built IDEMPOTENT payments here.", RULES), ["idempotent Payments"]);
  assert.deepEqual(findRetired("Handled each one exactly-once.", RULES), ["exactly once"]);
  assert.deepEqual(findRetired("Handled **exactly** once.", RULES), ["exactly once"]);
  assert.deepEqual(findRetired("Inexactly oncely worded.", RULES), []);
  assert.deepEqual(findRetired("", RULES), []);
});

test("a replacement keeps the rest of the sentence and the case of its start", () => {
  const r = applyRetired("Rate limiting, and idempotent Payments processing. Idempotent payments too.", RULES);
  assert.equal(r.text, "Rate limiting, and Payments processing. Payments too.");
  assert.deepEqual(r.report.replaced, [{ from: "idempotent Payments", to: "Payments" }]);
  assert.equal(findRetired(r.text, RULES).length, 0);
});

test("the rewrite reads on the sentence it was asked for", () => {
  const r = applyRetired("Used idempotent workers, processing each event exactly once under duplicate delivery", RULES);
  assert.equal(r.text, "Used idempotent workers, processing each event idempotently under duplicate delivery");
});

test("a job title is replaced in its header line, and an education line with similar words is left alone", () => {
  const experience = "Lead Engineer (Placement) | Acme University | Jun 2026 – Present\n• Built it\nMSc Computing (with Placement) | Acme University | 2025";
  const r = applyRetired(experience, RULES);
  assert.equal(r.text, "Research Assistant, Web (Acme Tool) | Acme University | Jun 2026 – Present\n• Built it\nMSc Computing (with Placement) | Acme University | 2025");
});

test("with no replacement: the sentence goes, the bullet goes when nothing else is in it", () => {
  const r = applyRetired("Built a sharded platform architecture. Shipped it in June.\n• Designed a sharded platform architecture\n• Kept this one", RULES);
  assert.equal(r.text, "Shipped it in June.\n• Kept this one");
  assert.deepEqual(r.report.removed, ["sharded platform architecture"]);
});

test("a skills line loses the item, not the line; a sentence with a colon is not a list", () => {
  assert.equal(applyRetired("Technical Tools: Python, sharded platform architecture, Docker", RULES).text, "Technical Tools: Python, Docker");
  assert.equal(applyRetired("Skills: Python | sharded platform architecture | Docker", RULES).text, "Skills: Python | Docker");
  assert.equal(applyRetired("Note: I built a sharded platform architecture, and more.", RULES).text, "");
});

test("a job header is never deleted: the check reports it for the user", () => {
  const header = "Architect of sharded platform architecture | Acme | 2025";
  const r = applyRetired(header, RULES);
  assert.equal(r.text, header);
  assert.deepEqual(findRetired(r.text, RULES), ["sharded platform architecture"]);
  const marker = "@@JOB@@Sharded platform architecture lead@@2025";
  assert.equal(applyRetired(marker, RULES).text, marker);
});

test("the built-in phrases hold for everyone, with no list at all", () => {
  assert.deepEqual(findRetired("Microservices: listed in my functional competencies", []), ["listed in my functional competencies"]);
  const letter = "Here is why:\n1. Python: three years of it.\n2. Microservices: listed in my functional competencies\nThanks.";
  assert.equal(applyRetired(letter, []).text, "Here is why:\n1. Python: three years of it.\nThanks.");
  assert.equal(applyRetired("Here, these are the one areas where I help:", []).text, "Here, this is the one area where I help:");
  assert.equal(applyRetired("One of the one areas", []).text, "One of the one area");
});

test("the letter's count never prints the one areas: the root of it", () => {
  const letter = "Having read it, these are the four areas where I can add value from the start:\n\n1. Python: built a service.\n\nKind regards,";
  const r = fixAreasCount(letter);
  assert.match(r.text, /this is the one area where I can add value from the start:/);
  assert.deepEqual(findRetired(r.text, []), []);
  const two = fixAreasCount("These are the four areas:\n\n1. One thing.\n2. Another thing.\n");
  assert.match(two.text, /These are the two areas:/);
});

test("a list keeps brackets and separators, and an unlabelled list loses one item", () => {
  assert.equal(applyRetired("Tools: AWS (Lambda, S3), sharded platform architecture, Docker", RULES).text, "Tools: AWS (Lambda, S3), Docker");
  assert.equal(applyRetired("Tools: AWS, Docker | sharded platform architecture | Redis", RULES).text, "Tools: AWS, Docker | Redis");
  assert.equal(applyRetired("React, sharded platform architecture, Docker", RULES).text, "React, Docker");
  assert.equal(applyRetired("• React, sharded platform architecture, Docker", RULES).text, "• React, Docker");
});

test("a phrase never matches across a line, and curly quotes and dashes count", () => {
  const rules = parseRetiredClaims("event driven\nmy team's platform");
  assert.deepEqual(findRetired("- event\n- driven", rules), []);
  assert.deepEqual(findRetired("An event–driven system", rules), ["event driven"]);
  assert.deepEqual(findRetired("my team’s platform", rules), ["my team's platform"]);
});

test("a replacement holding its own phrase settles instead of holding for ever", () => {
  const rules = parseRetiredClaims("React => React.js\nGo");
  assert.equal(rules.length, 2, "two letters is a phrase");
  const once = applyRetired("Built with React and Vue", rules).text;
  assert.equal(once, "Built with React.js and Vue");
  assert.equal(applyRetired(once, rules).text, once, "running it again changes nothing");
  assert.deepEqual(findRetired(once, rules), []);
});

test("what the preview cannot edit is fixed, and addresses and names are left alone", () => {
  const profile = {
    name: "Sharded Platform Architecture Ltd",
    email: "alex@example.com",
    tagline: "Engineer | exactly once",
    education: [{ degree: "MSc", note: "Built a sharded platform architecture." }],
    certifications: ["Kept", "sharded platform architecture"],
    projects: [{ name: "Sharded platform architecture", tech: "React, sharded platform architecture, Docker" }],
  };
  const out = applyRetiredToProfile(profile, RULES);
  assert.equal(out.name, profile.name);
  assert.equal(out.tagline, "Engineer | idempotently");
  assert.equal(out.education[0].note, "");
  assert.deepEqual(out.certifications, ["Kept"]);
  assert.equal(out.projects[0].name, "Sharded platform architecture", "the check holds a name, which the user can edit");
  assert.equal(out.projects[0].tech, "React, Docker");
});

test("project bullets: replaced, or gone when nothing is left; other values untouched", () => {
  const r = applyRetiredToBullets({ "0": ["Built idempotent Payments flows", "Designed a sharded platform architecture", "Kept"], "1": "not a list" }, RULES);
  assert.deepEqual(r.projects, { "0": ["Built Payments flows", "Kept"], "1": "not a list" });
  assert.deepEqual(applyRetiredToBullets(null, RULES).projects, {});
});

test("reports merge without repeats, and the message names what is held", () => {
  const merged = mergeReports({ replaced: [{ from: "a", to: "b" }], removed: ["c"] }, { replaced: [{ from: "a", to: "b" }], removed: ["c", "d"] });
  assert.deepEqual(merged, { replaced: [{ from: "a", to: "b" }], removed: ["c", "d"] });
  assert.match(retiredBlockMessage(["sharded platform architecture"]), /"sharded platform architecture"/);
});
