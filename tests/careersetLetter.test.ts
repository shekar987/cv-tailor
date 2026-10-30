// The CareerSet letter's deterministic pieces (lib/letterStyle, lib/letterFormat):
// the eligible points block, the interest line's source check, the tidy of a
// numbered list, the statement in the close, the salutation suffix and the
// page fit's protected lines. UKJI's behaviour is pinned beside each.
import test from "node:test";
import assert from "node:assert/strict";
import { eligiblePointsBlock, interestReason, interestLineSupported, checkInterestLine, tidyNumberedPoints, countNumberedPoints, insertIntoClose, protectedLetterLines, INTEREST_MIN_OVERLAP } from "../src/lib/letterStyle.ts";
import { normalizeLetter, insertBeforeSignoff } from "../src/lib/letterFormat.ts";
import { fitLetterToOnePage } from "../src/lib/letterFit.ts";
import { applyLetterLint } from "../src/lib/letterLint.ts";
import { CAREERSET } from "../src/lib/formatStyles/careerset.ts";
import { UKJI } from "../src/lib/formatStyles/ukji.ts";
import type { EvidenceMap } from "../src/lib/evidenceMap.ts";

const OPENING = CAREERSET.letter.interestOpening!;
const JD = "Enablis puts engineers directly with clients, taking AI from a business problem to a working, tested solution. You will build AI prototypes and applications with Python. Desirable: experience with AI coding agents such as Claude Code.";

test("eligiblePointsBlock lists only requirements the master CV shows, required first, with where the evidence is", () => {
  const map: EvidenceMap = {
    items: [
      { term: "Kubernetes", importance: "required", kind: "technical", status: "gap", evidence: null, where: null },
      { term: "Python", importance: "required", kind: "technical", status: "experience", evidence: "Delivered 20+ API modules in Python", where: "Full Stack Engineer, Northgate Systems" },
      { term: "Terraform", importance: "keyword", kind: "technical", status: "project", evidence: "Provisioned with Terraform", where: "CampaignPulse" },
      { term: "AWS", importance: "preferred", kind: "technical", status: "listed", evidence: null, where: null },
      { term: "Rust", importance: "required", kind: "technical", status: "learning", evidence: null, where: null },
      { term: "python", importance: "keyword", kind: "technical", status: "experience", evidence: null, where: null },
    ],
  };
  const block = eligiblePointsBlock(map);
  assert.equal(block, "\nELIGIBLE REQUIREMENTS for the numbered points — the posting's own words, each one the master CV shows; a point on any other requirement is removed by a deterministic check:\n- Python (paid work shows it: Full Stack Engineer, Northgate Systems)\n- AWS (listed on the CV only — name it, never describe work done with it)\n- Terraform (only a personal project shows it: CampaignPulse — the point must name the project and say it is one)\n");
  assert.doesNotMatch(block, /Kubernetes|Rust/, "a gap and a learning skill are never eligible");
  assert.equal(eligiblePointsBlock({ items: [] }), "");
  assert.equal(eligiblePointsBlock(null), "");
});

test("the interest line: the reason after the opening must share its content words with the posting or the research", () => {
  const good = `${OPENING} Enablis puts engineers directly with clients, taking AI from a business problem to a working, tested solution.`;
  const invented = `${OPENING} the company recently opened a Berlin office and sponsors the local rowing club.`;
  assert.equal(interestReason(good, OPENING), "Enablis puts engineers directly with clients, taking AI from a business problem to a working, tested solution");
  assert.equal(interestReason("I built a thing.", OPENING), null);
  assert.equal(interestLineSupported(good, OPENING, [JD]), true);
  assert.equal(interestLineSupported(invented, OPENING, [JD]), false);
  assert.equal(interestLineSupported("I built a thing.", OPENING, [JD]), true, "not an interest line: nothing to check");
  assert.equal(interestLineSupported(`${OPENING}.`, OPENING, [JD]), false, "no reason at all");
  assert.equal(INTEREST_MIN_OVERLAP, 0.5);
  const letter = `Dear Enablis Hiring Team,\nI am applying for the Deployed AI Engineer role at Enablis. I delivered 20+ API modules at Northgate. ${invented}\nHaving read the job description, these are the four areas where I can add value from the start:\n1. Python: I delivered 20+ API modules at Northgate.\nKind regards,\nJane`;
  const r = checkInterestLine(letter, OPENING, [JD]);
  assert.equal(r.kept, false);
  assert.equal(r.line, invented);
  assert.equal(r.text.split("\n")[1], "I am applying for the Deployed AI Engineer role at Enablis. I delivered 20+ API modules at Northgate.");
  const kept = checkInterestLine(letter.replace(invented, good), OPENING, [JD]);
  assert.equal(kept.kept, true);
  assert.equal(kept.text, letter.replace(invented, good), "a supported reason leaves the letter as it was");
  assert.deepEqual(checkInterestLine("Dear X,\nI am applying for the role.\nKind regards,\nJane", OPENING, [JD]), { text: "Dear X,\nI am applying for the role.\nKind regards,\nJane", line: null, kept: false });
  // The lint never removes the interest line: it is neither second person nor the posting told back.
  assert.equal(applyLetterLint(`Dear Enablis Hiring Team,\nI am applying for the role at Enablis. ${good}\nKind regards,\nJane`).lint.secondPerson.length, 0);
});

test("tidyNumberedPoints closes the holes a removal left and renumbers; countNumberedPoints counts the points that stand", () => {
  const holed = "Dear X,\nIntro.\nHaving read the job description, these are the four areas where I can add value from the start:\n1. Python: I built it.\n2.\n3. Testing: I wrote 192 tests.\n4. AWS: I deployed to Lambda.\nClose.\nKind regards,\nJane";
  const t = tidyNumberedPoints(holed);
  assert.equal(t.bareRemoved, 1);
  assert.equal(t.renumbered, true);
  assert.equal(t.points, 3);
  assert.equal(t.text, "Dear X,\nIntro.\nHaving read the job description, these are the four areas where I can add value from the start:\n1. Python: I built it.\n2. Testing: I wrote 192 tests.\n3. AWS: I deployed to Lambda.\nClose.\nKind regards,\nJane");
  assert.equal(countNumberedPoints(t.text), 3);
  const fine = "1. A: x.\n2. B: y.";
  assert.deepEqual(tidyNumberedPoints(fine), { text: fine, bareRemoved: 0, renumbered: false, points: 2 }, "an intact list is returned as it is");
});

test("insertIntoClose opens the close paragraph with the statement; insertBeforeSignoff is UKJI's own paragraph", () => {
  const letter = "Dear X,\nIntro.\nThank you for considering my application. I would welcome a conversation.\n\nKind regards,\nJane";
  const statement = "I have the permanent right to work in the UK and will not require visa sponsorship.";
  assert.equal(insertIntoClose(letter, statement, CAREERSET.letter.thanksLine), "Dear X,\nIntro.\nI have the permanent right to work in the UK and will not require visa sponsorship. Thank you for considering my application. I would welcome a conversation.\n\nKind regards,\nJane");
  assert.equal(insertIntoClose("Dear X,\nIntro.\nKind regards,\nJane", statement, CAREERSET.letter.thanksLine), null, "no close line: the caller falls back");
  assert.equal(insertIntoClose(insertIntoClose(letter, statement, CAREERSET.letter.thanksLine)!, statement, CAREERSET.letter.thanksLine), insertIntoClose(letter, statement, CAREERSET.letter.thanksLine), "never twice");
  assert.equal(insertBeforeSignoff(letter, statement), "Dear X,\nIntro.\nThank you for considering my application. I would welcome a conversation.\n\nI have the permanent right to work in the UK and will not require visa sponsorship.\n\nKind regards,\nJane");
  assert.equal(UKJI.letter.statementPlacement, "own_paragraph");
});

test("normalizeLetter: a company addressed as a person gets the style's suffix; the default is UKJI's 'team'", () => {
  assert.equal(normalizeLetter("Dear Enablis,\nBody.\nKind regards,\nJane", { company: "Enablis", name: "Jane", teamSuffix: "Hiring Team" }).letter, "Dear Enablis Hiring Team,\nBody.\nKind regards,\nJane");
  assert.equal(normalizeLetter("Dear Enablis,\nBody.\nKind regards,\nJane", { company: "Enablis", name: "Jane" }).letter, "Dear Enablis team,\nBody.\nKind regards,\nJane");
  assert.equal(normalizeLetter("Dear Enablis Hiring Team,\nBody.\nKind regards,\nJane", { company: "Enablis", name: "Jane", teamSuffix: "Hiring Team" }).fixes.salutation, null, "already addressed to the team: untouched");
});

test("the page fit never trims the fixed line or the close paragraph when they are protected; unprotected (UKJI) it can", () => {
  const fixed = CAREERSET.letter.fixedLine!;
  const close = "Thank you for considering my application. I would welcome a conversation about the role.";
  const letter = `Dear X,\nI am applying for the role at X. I built the thing.\n${fixed}\n1. Python: I built services in Python at Northgate, cutting response times by 25%.\n2. Testing: I wrote 192 tests.\n${close}\nKind regards,\nJane`;
  const protect = protectedLetterLines(letter, CAREERSET.letter.furniture, CAREERSET.letter.thanksLine);
  assert.deepEqual(protect, [fixed, close]);
  // A fake counter: two pages until two sentences have gone.
  const counter = (n: number) => (text: string) => (text.split(/(?<=[.!?:])\s+(?=[A-Z0-9])/).length > n ? 2 : 1);
  const kept = fitLetterToOnePage(letter, counter(6), { protect });
  assert.ok(kept.text.includes(fixed), "the fixed line stands");
  assert.ok(kept.text.includes(close), "the close stands");
  assert.ok(kept.report.removed.length > 0);
  const loose = fitLetterToOnePage(letter, counter(6), { protect: [] });
  assert.ok(loose.report.removed.includes(fixed) || loose.report.removed.some((s) => close.includes(s)), "unprotected, the longest lines are the ones that go — UKJI's behaviour today");
});
