// Unit tests for document preferences (Right to Work off the CV by default). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePreferences, profileForDocument, rightToWorkForForms, DEFAULT_PREFERENCES } from "../src/lib/preferences.ts";

const profile = { name: "Jane", rightToWork: ["Full right to work in the UK", "No sponsorship required"], certifications: ["AWS"] };

test("normalizePreferences: anything but an explicit true is off", () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({}), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ includeRightToWorkOnCv: "yes" }), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences([true]), DEFAULT_PREFERENCES);
  assert.equal(normalizePreferences({ includeRightToWorkOnCv: true }).includeRightToWorkOnCv, true);
});

test("profileForDocument: Right to Work is dropped by default and kept only when switched on", () => {
  const off = profileForDocument(profile, DEFAULT_PREFERENCES);
  assert.deepEqual(off.rightToWork, []);
  assert.deepEqual(off.certifications, ["AWS"], "nothing else changes");
  assert.notEqual(off, profile, "a copy, never a mutation");
  assert.deepEqual(profile.rightToWork.length, 2);
  assert.equal(profileForDocument(profile, { version: 1, includeRightToWorkOnCv: true }), profile);
  assert.equal(profileForDocument(null, DEFAULT_PREFERENCES), null);
  const none = { name: "Jane", rightToWork: [] };
  assert.equal(profileForDocument(none, DEFAULT_PREFERENCES), none, "no work when there is nothing to drop");
});

test("rightToWorkForForms keeps the CV's own wording, one line each", () => {
  assert.equal(rightToWorkForForms(profile), "Full right to work in the UK\nNo sponsorship required");
  assert.equal(rightToWorkForForms({ rightToWork: [" ", ""] }), "");
  assert.equal(rightToWorkForForms(null), "");
});
