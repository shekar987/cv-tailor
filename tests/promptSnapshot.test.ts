// The UKJI prompt strings, byte for byte. tests/fixtures/ukji-prompts.json
// was captured from src/prompts/steps.ts BEFORE the prompts took their
// style-block parameters (scripts/gen-prompt-fixture.mjs, 16 Oct 2026). Every
// UKJI prompt the pipeline builds — the old arguments plus the UKJI style's
// blocks in the new trailing parameters — must still equal that capture
// exactly: the CareerSet style lives beside UKJI, never inside it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as steps from "../src/prompts/steps.ts";
import { UKJI } from "../src/lib/formatStyles/ukji.ts";
import { CAREERSET } from "../src/lib/formatStyles/careerset.ts";

type Case = { name: string; fn: keyof typeof steps; args: unknown[]; text: string };
type Fixture = { inputs: { cv: string }; cases: Case[]; constants: Record<string, string> };

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ukji-prompts.json", import.meta.url), "utf8")) as Fixture;

// JSON cannot hold `undefined`; the generator passed it for a defaulted
// argument and JSON.stringify wrote null in its place.
const baseArgs = (c: Case) => c.args.map((a) => (a === null ? undefined : a));

// The style-block parameters each prompt gained, after its original
// parameters (arity = how many the capture's calls could pass).
const STYLE_ARGS: Partial<Record<keyof typeof steps, { arity: number; extra: unknown[] }>> = {
  summaryPrompt: { arity: 7, extra: [UKJI.prompts.summaryForm({ availabilityAppended: false })] },
  skillsPrompt: { arity: 4, extra: [UKJI.prompts.skillsShape] },
  experiencePrompt: { arity: 6, extra: [UKJI.prompts.verbRule, UKJI.prompts.experienceFormat] },
  projectsPrompt: { arity: 6, extra: [UKJI.prompts.projectsBullets] },
  poolProjectsPrompt: { arity: 6, extra: [UKJI.prompts.poolBullets] },
};
const callArgs = (c: Case): unknown[] => {
  const base = baseArgs(c);
  const s = STYLE_ARGS[c.fn];
  if (!s) return base;
  while (base.length < s.arity) base.push(undefined);
  return [...base, ...s.extra];
};

for (const c of fixture.cases) {
  test(`UKJI prompt ${c.name} is byte-identical to the capture`, () => {
    const fn = steps[c.fn] as (...a: unknown[]) => string;
    assert.equal(typeof fn, "function", `${c.fn} is exported`);
    assert.equal(fn(...callArgs(c)), c.text);
  });
}

for (const [name, text] of Object.entries(fixture.constants)) {
  test(`shared constant ${name} is unchanged`, () => {
    assert.equal((steps as Record<string, unknown>)[name], text);
  });
}

test("the UKJI style's letter function is the UKJI letter prompt", () => {
  const c = fixture.cases.find((x) => x.name === "letter.omitRtw")!;
  const [cv, claims, omit, evidence] = baseArgs(c) as [string, string, boolean, string];
  assert.equal(UKJI.prompts.coverLetter(cv, claims, omit, evidence, "IGNORED"), c.text);
});

test("a prompt built without its style block is NOT the UKJI prompt (no silent default)", () => {
  const c = fixture.cases.find((x) => x.name === "summary.min")!;
  assert.notEqual(steps.summaryPrompt(fixture.inputs.cv), c.text);
  const k = fixture.cases.find((x) => x.name === "skills.min")!;
  assert.notEqual(steps.skillsPrompt(fixture.inputs.cv), k.text);
});

test("the CareerSet prompts carry their own rules and none of UKJI's shape", () => {
  const cv = fixture.inputs.cv;
  const summary = steps.summaryPrompt(cv, undefined, "", "", "", "", false, CAREERSET.prompts.summaryForm({ availabilityAppended: true }));
  assert.match(summary, /65 to 90 words/);
  assert.doesNotMatch(summary, /45 to 70 words/);
  const skills = steps.skillsPrompt(cv, undefined, "", "", CAREERSET.prompts.skillsShape);
  for (const g of ["Languages & Frameworks:", "Databases:", "AI & LLM:", "Cloud & DevOps:", "Testing:", "Other:"]) assert.ok(skills.includes(g), g);
  assert.doesNotMatch(skills, /ONE flat list/);
  const exp = steps.experiencePrompt(cv, undefined, undefined, "", "[R1.1] x", "", CAREERSET.prompts.verbRule, CAREERSET.prompts.experienceFormat);
  assert.doesNotMatch(exp, /Bold quantified wins/);
  assert.doesNotMatch(exp, /output it as that role's FIRST bullet/);
  assert.match(exp, /No full stop at the end of a bullet/);
  const letter = CAREERSET.prompts.coverLetter(cv, undefined, true, "", "ELIGIBLE REQUIREMENTS:\n- Java");
  assert.match(letter, /300 to 420 words/);
  assert.ok(letter.includes("Having read the job description, these are the four areas where I can add value from the start:"));
  assert.ok(letter.includes("Thank you for considering my application."));
  assert.ok(letter.includes("Hiring Team"));
  assert.ok(letter.includes("ELIGIBLE REQUIREMENTS:\n- Java"));
  assert.doesNotMatch(letter, /great fit due to the following reasons/);
});
