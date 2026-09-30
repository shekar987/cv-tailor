// Unit tests for document preferences (Right to Work off the CV by default). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePreferences, profileForDocument, rightToWorkForForms, pageTarget, DEFAULT_PREFERENCES } from "../src/lib/preferences.ts";

const profile = { name: "Jane", rightToWork: ["Full right to work in the UK", "No sponsorship required"], certifications: ["AWS"] };
const ON = { version: 1 as const, includeRightToWorkOnCv: true, onePageCv: false, projectLinks: {} };
const ELIG = { rightToWork: { status: "full" as const, countries: ["UK"], permissionEnds: null }, availability: { status: "now" as const, from: null }, canWorkFullTime: "yes" as const };
const UNSET = { rightToWork: { status: "unknown" as const, countries: [], permissionEnds: null }, availability: { status: "unknown" as const, from: null }, canWorkFullTime: "unknown" as const };

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
  // On the document: the Eligibility statement, never the CV's lines; and
  // nothing at all until the answer is given (30 Sep: one source of truth).
  assert.deepEqual(profileForDocument(profile, ON, ELIG).rightToWork, [
    "I have the permanent right to work in the UK and will not require visa sponsorship.",
    "I am available to start immediately and can work full time.",
  ]);
  assert.deepEqual(profileForDocument(profile, ON, UNSET).rightToWork, [], "switch on, no answer: the CV's wording is not a source");
  assert.deepEqual(profileForDocument(profile, ON).rightToWork, []);
  assert.deepEqual(profileForDocument(profile, DEFAULT_PREFERENCES, ELIG).rightToWork, [], "off the document stays off");
  assert.equal(profileForDocument(null, DEFAULT_PREFERENCES), null);
  const none = { name: "Jane", rightToWork: [] };
  assert.equal(profileForDocument(none, DEFAULT_PREFERENCES), none, "no work when there is nothing to drop");
});

test("CV length: two pages unless one page is explicitly chosen", () => {
  assert.equal(DEFAULT_PREFERENCES.onePageCv, false);
  assert.equal(pageTarget(DEFAULT_PREFERENCES), 2);
  assert.equal(normalizePreferences({ onePageCv: "yes" }).onePageCv, false);
  assert.equal(normalizePreferences({ onePageCv: true }).onePageCv, true);
  assert.equal(pageTarget(normalizePreferences({ onePageCv: true })), 1);
  // The two switches are independent.
  assert.deepEqual(normalizePreferences({ includeRightToWorkOnCv: true, onePageCv: true }), { version: 1, includeRightToWorkOnCv: true, onePageCv: true, projectLinks: {} });
});

test("rightToWorkForForms is the Eligibility statement, one sentence per line, empty until answered", () => {
  assert.equal(rightToWorkForForms(ELIG), "I have the permanent right to work in the UK and will not require visa sponsorship.\nI am available to start immediately and can work full time.");
  assert.equal(rightToWorkForForms(UNSET), "");
  assert.equal(rightToWorkForForms(null), "");
});

test("projectLinks: saved per project, cleaned and bounded (lib/projectLinks)", () => {
  const p = normalizePreferences({ projectLinks: { CampaignPulse: { github: "github.com/me/cp", live: "javascript:alert(1)" } } });
  assert.deepEqual(p.projectLinks, { campaignpulse: { github: "https://github.com/me/cp", live: "" } });
  assert.deepEqual(normalizePreferences({ projectLinks: "x" }).projectLinks, {});
  assert.deepEqual(DEFAULT_PREFERENCES.projectLinks, {});
});
