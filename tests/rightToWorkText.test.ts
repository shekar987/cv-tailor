import test from "node:test";
import assert from "node:assert/strict";
import { mentionsRightToWork, stripRightToWorkLines, stripRightToWorkSentences, stripRightToWorkBullets } from "../src/lib/rightToWorkText.ts";

test("mentionsRightToWork: the status vocabulary, not a company called Visa", () => {
  for (const s of [
    "Currently in the UK on a Student visa with full-time work authorised.",
    "From January 2027 I move to the Graduate Route with no sponsorship required.",
    "I have the right to work in the UK.",
    "No visa sponsorship needed.",
    "Eligible to work in the UK without restriction.",
    "Holds indefinite leave to remain (ILR).",
    "British citizenship required.",
  ]) assert.equal(mentionsRightToWork(s), true, s);
  for (const s of [
    "Built a payments integration for Visa and Mastercard card networks.",
    "Shipped 20+ API modules at Brane Group.",
    "Led the migration to Next.js 16.",
  ]) assert.equal(mentionsRightToWork(s), false, s);
});

test("stripRightToWorkSentences: the offending sentence goes, the line keeps the rest, paragraphs survive", () => {
  const summary = [
    "Full Stack Engineer with 2 years building AI-enabled services at Brane Group.",
    "Shipped 20+ API modules and cut frontend load time by 20%. Currently on a Student visa with full work authorisation, moving to the Graduate Route in January 2027.",
    "Built Jobhuntz, a Next.js and Supabase CV tool with 90+ automated tests.",
  ].join("\n");
  const r = stripRightToWorkSentences(summary);
  assert.equal(r.removed.length, 1);
  assert.match(r.removed[0], /Student visa/);
  assert.equal(r.text.split("\n").length, 3);
  assert.match(r.text.split("\n")[1], /^Shipped 20\+ API modules and cut frontend load time by 20%\.$/);
  assert.equal(mentionsRightToWork(r.text), false);

  // A cover-letter paragraph that is only the status disappears whole; the
  // blank line between the neighbours does not double up.
  const letter = "Dear Hiring Manager,\n\nI am applying for the Software Engineer role.\n\nI hold a Student visa with full-time work rights and will not need sponsorship until 2027.\n\nAt Brane Group I shipped 20+ API modules.\n\nKind regards,\nSoma";
  const l = stripRightToWorkSentences(letter);
  assert.equal(l.removed.length, 1);
  assert.equal(l.text, "Dear Hiring Manager,\n\nI am applying for the Software Engineer role.\n\nAt Brane Group I shipped 20+ API modules.\n\nKind regards,\nSoma");
});

test("stripRightToWorkSentences: nothing to strip returns the text unchanged", () => {
  const t = "Line one.\n\nLine two, e.g. this one. Line three.";
  const r = stripRightToWorkSentences(t);
  assert.deepEqual(r, { text: t, removed: [] });
});

test("stripRightToWorkLines and stripRightToWorkBullets: whole bullets go", () => {
  const exp = "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024\n• Shipped 20+ API modules.\n• Right to work in the UK, no sponsorship required.\n\nResearch Assistant | UEL | 2026 – Present\n• Analysed 11 platforms.";
  const r = stripRightToWorkLines(exp);
  assert.deepEqual(r.removed, ["• Right to work in the UK, no sponsorship required."]);
  assert.equal(r.text, "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024\n• Shipped 20+ API modules.\n\nResearch Assistant | UEL | 2026 – Present\n• Analysed 11 platforms.");
  const p = stripRightToWorkBullets({ "0": ["Built a RAG pipeline.", "Available immediately with full working rights."], "1": ["Deployed on Vercel."] });
  assert.deepEqual(p.removed, ["Available immediately with full working rights."]);
  assert.deepEqual(p.projects, { "0": ["Built a RAG pipeline."], "1": ["Deployed on Vercel."] });
  assert.deepEqual(stripRightToWorkBullets(null), { projects: null, removed: [] });
});
