// Unit tests for the PDF text-run seam rules (lib/textRuns). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsSpace, unglue, WIDE_GAP_EM } from "../src/lib/textRuns.ts";

test("needsSpace: a wide gap always; a narrow gap only across a word seam; kerning inside a word never", () => {
  assert.equal(needsSpace("REST APIs", "LlamaIndex", 0.1), true, "lowercase-s then a capitalised word");
  assert.equal(needsSpace("Python)", "Django", 0.08), true);
  assert.equal(needsSpace("Java", "Script", 0.0), false, "no gap: one word in two runs");
  assert.equal(needsSpace("Postgre", "SQL", 0.1), false, "the next run is not a word (no lowercase after the capital)");
  assert.equal(needsSpace("built", "with", 0.1), false, "lowercase to lowercase is one word or already spaced");
  assert.equal(needsSpace("anything", "Else", WIDE_GAP_EM + 0.01), true);
  assert.equal(needsSpace("ends ", "Word", 0.1), false, "a space is already there");
  assert.equal(needsSpace("", "Word", 1), false);
});

test("unglue: a plural glued to the next word splits; internal capitals in one name do not", () => {
  assert.deepEqual(unglue("APIsLlamaIndex"), ["APIs", "LlamaIndex"]);
  assert.deepEqual(unglue("servicesKubernetesHelm"), ["services", "Kubernetes", "Helm"], "every plural-s seam, first to last");
  for (const whole of ["PostgreSQL", "JavaScript", "TypeScript", "OpenTelemetry", "LlamaIndex", "GraphQL", "iOS", "AWS", "Kubernetes"]) assert.deepEqual(unglue(whole), [whole], whole);
});
