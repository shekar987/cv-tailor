import { test } from "node:test";
import assert from "node:assert/strict";
import { companyNamesMatch, normalizeCompanyName } from "../src/lib/companyMatch.ts";

test("normalizeCompanyName drops noise and punctuation", () => {
  assert.equal(normalizeCompanyName("Deliveroo Ltd."), "deliveroo");
  assert.equal(normalizeCompanyName("The Guardian"), "guardian");
  assert.equal(normalizeCompanyName("Acme, Inc"), "acme");
  assert.equal(normalizeCompanyName(""), "");
  assert.equal(normalizeCompanyName(null), "");
});

test("same company, different spellings", () => {
  assert.ok(companyNamesMatch("Deliveroo", "Deliveroo Ltd"));
  assert.ok(companyNamesMatch("Acme Inc", "Acme"));
  assert.ok(companyNamesMatch("Monzo", "Monzo Bank"));
  assert.ok(companyNamesMatch("The Guardian", "Guardian News & Media"));
  assert.ok(companyNamesMatch("incident.io", "Incident.io"));
});

test("different companies never match", () => {
  assert.ok(!companyNamesMatch("Meta", "Metaphor Labs"));
  assert.ok(!companyNamesMatch("Go", "Google"));
  assert.ok(!companyNamesMatch("Unitary", "Unity Technologies"));
  assert.ok(!companyNamesMatch("", "Acme"));
  assert.ok(!companyNamesMatch("Acme", undefined));
});
