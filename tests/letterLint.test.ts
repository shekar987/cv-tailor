// Unit tests for the cover letter's shape rules (lib/letterLint). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSecondPerson, restatesJd, hasHonestGap, applyLetterLint } from "../src/lib/letterLint.ts";

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
