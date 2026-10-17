// The UKJI prompt strings, byte for byte. tests/fixtures/ukji-prompts.json
// was captured from src/prompts/steps.ts BEFORE the prompts took their
// style-block parameters (scripts/gen-prompt-fixture.mjs, 16 Oct 2026). Every
// UKJI prompt the pipeline builds must still equal that capture exactly: the
// CareerSet style lives beside UKJI, never inside it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as steps from "../src/prompts/steps.ts";

type Case = { name: string; fn: keyof typeof steps; args: unknown[]; text: string };
type Fixture = { cases: Case[]; constants: Record<string, string> };

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ukji-prompts.json", import.meta.url), "utf8")) as Fixture;

// JSON cannot hold `undefined`; the generator passed it for a defaulted
// argument and JSON.stringify wrote null in its place.
const args = (c: Case) => c.args.map((a) => (a === null ? undefined : a));

for (const c of fixture.cases) {
  test(`UKJI prompt ${c.name} is byte-identical to the capture`, () => {
    const fn = steps[c.fn] as (...a: unknown[]) => string;
    assert.equal(typeof fn, "function", `${c.fn} is exported`);
    assert.equal(fn(...args(c)), c.text);
  });
}

for (const [name, text] of Object.entries(fixture.constants)) {
  test(`shared constant ${name} is unchanged`, () => {
    assert.equal((steps as Record<string, unknown>)[name], text);
  });
}
