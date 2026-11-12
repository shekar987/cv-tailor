// "Fix before sending" suggestions checked like the CV (lib/suggestionCheck,
// 5 Nov 2026): one the master CV can't back becomes "needs your evidence",
// never a line ready to paste. The CV is made up; the HTTP line is the shape
// the 5 Nov sweep saw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSuggestions, proposedLines } from "../src/lib/suggestionCheck.ts";

const CV = `EXPERIENCE
Software Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Diagnosed and resolved production incidents across three Python services, cutting repeat tickets by 30%
• Built REST APIs in FastAPI serving 2,000 daily users

SKILLS
Python, FastAPI, PostgreSQL, Docker`;

const ctx = { sources: [CV], absentTerms: ["HTTP", "FastAPI", "Terraform"] };

test("a line the master CV can't support is never shown as ready to paste", () => {
  const r = checkSuggestions([`Add "HTTP" to the Northgate bullet: "Optimised HTTP request handling and response serialisation"`], ctx);
  assert.deepEqual(r.kept, []);
  assert.equal(r.needsEvidence.length, 1);
  assert.equal(r.needsEvidence[0].term, "HTTP");
  // The CV shows the work as REST APIs (a rename): the note says so, and still never offers the line.
  assert.match(r.needsEvidence[0].note, /^HTTP: your CV may show the work as “Built REST APIs in FastAPI serving 2,000 daily users”/);
  assert.doesNotMatch(r.needsEvidence[0].note, /Optimised/, "the term, never the line");
  const bare = checkSuggestions([`Add DNS: "Configured DNS records and routing for the payments service"`], { ...ctx, absentTerms: ["DNS"] });
  assert.match(bare.needsEvidence[0].note, /^DNS: your main CV doesn't show this/);
});

test("a short quoted term before the quoted line: the line itself is checked", () => {
  // The most common edit shape. The invented 45% is caught, not the words between the quotes.
  const r = checkSuggestions([`Add "FastAPI" to the Northgate Systems role: "Led the FastAPI migration that cut infrastructure costs by 45%"`], ctx);
  assert.deepEqual(r.kept, []);
  assert.deepEqual(proposedLines(`Add "FastAPI" to the Northgate Systems role: "Led the FastAPI migration that cut infrastructure costs by 45%"`), [
    "Led the FastAPI migration that cut infrastructure costs by 45%",
  ]);
});

test("an apostrophe is never a quote mark", () => {
  const kept = checkSuggestions([`Lead with this so a recruiter doesn't overlook it: "Built REST APIs in FastAPI serving 2,000 daily users"`], ctx);
  assert.equal(kept.kept.length, 1, "doesn't opens no quote");
  assert.deepEqual(proposedLines(`Add ‘Cut the team’s deploy time by 45%’ to the summary`), ["Cut the team’s deploy time by 45%"]);
  const held = checkSuggestions([`Add ‘Cut the team’s deploy time by 45%’ to the summary`], ctx);
  assert.deepEqual(held.kept, [], "the whole curly-quoted line is checked, apostrophe and all");
});

test("a suggestion that surfaces what the master CV already shows stays", () => {
  const r = checkSuggestions(
    [
      "Move FastAPI into the first line of Technical Tools.",
      `Name the incident work in your summary: "Diagnosed and resolved production incidents across three Python services"`,
      "Your 9/15 rises if you name FastAPI in the summary.",
    ],
    ctx
  );
  assert.equal(r.kept.length, 3, "the score's own count is no claim");
  assert.deepEqual(r.needsEvidence, []);
});

test("words recombined from several CV lines are not a traced line", () => {
  const r = checkSuggestions([`Add: "Resolved production incidents in FastAPI services serving daily users"`], ctx);
  assert.deepEqual(r.kept, []);
});

test("an absent term the master CV never names is evidence the user must bring, even without a quoted line", () => {
  const r = checkSuggestions(["Mention Terraform in your skills line.", "Add Terraform to the Northgate role."], ctx);
  assert.deepEqual(r.kept, []);
  assert.equal(r.needsEvidence.length, 1, "one line per term");
  assert.equal(r.needsEvidence[0].term, "Terraform");
});

test("a proposed line with a figure the master CV doesn't have is held, like the CV", () => {
  const r = checkSuggestions([`Lead with the result: "Built REST APIs in FastAPI serving 9,000 daily users"`], ctx);
  assert.deepEqual(r.kept, []);
  assert.equal(r.needsEvidence[0].term, null);
});

test("quoted lines are read off the suggestion; short quotes are names, not lines", () => {
  assert.deepEqual(proposedLines(`Add "FastAPI" and write “Built REST APIs for the payments team”`), ["Built REST APIs for the payments team"]);
  assert.deepEqual(proposedLines("No quotes here."), []);
  assert.deepEqual(checkSuggestions(["", "   "], ctx), { kept: [], needsEvidence: [] });
});
