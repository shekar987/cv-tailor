import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJustSaved,
  shouldAutoOpen,
  showsJustSaved,
  justSavedKey,
  JUST_SAVED_TTL_MS,
  JUST_SAVED_AUTO_OPEN_MS,
  type JustSaved,
} from "../src/lib/justSaved.ts";

const NOW = Date.parse("2026-11-12T15:00:00Z");
const ID = "0b8f2c1e-4a6d-4f1b-9c3e-2d7a5e8f9a10";
const marker = (m: Partial<JustSaved> = {}): JustSaved => ({ id: ID, company: "Marlow Freight", role: "Backend Engineer", status: "Applied", at: NOW - 60_000, ...m });

test("a stored marker reads back, bounded", () => {
  assert.deepEqual(parseJustSaved(JSON.stringify(marker()), NOW), marker());
  const long = parseJustSaved(JSON.stringify(marker({ company: "x".repeat(500) })), NOW);
  assert.equal(long?.company.length, 200);
  assert.equal(parseJustSaved(JSON.stringify({ ...marker(), status: "" }), NOW)?.status, "Applied");
  assert.equal(parseJustSaved(JSON.stringify(marker({ opened: true, dismissed: true })), NOW)?.dismissed, true);
});

test("anything else reads as nothing", () => {
  assert.equal(parseJustSaved(null, NOW), null);
  assert.equal(parseJustSaved("", NOW), null);
  assert.equal(parseJustSaved("{not json", NOW), null);
  assert.equal(parseJustSaved("[1,2]", NOW), null);
  assert.equal(parseJustSaved(JSON.stringify({ ...marker(), id: "../../etc" }), NOW), null);
  assert.equal(parseJustSaved(JSON.stringify({ ...marker(), at: "yesterday" }), NOW), null);
  // A day old, or from a clock well ahead of this one.
  assert.equal(parseJustSaved(JSON.stringify(marker({ at: NOW - JUST_SAVED_TTL_MS - 1 })), NOW), null);
  assert.equal(parseJustSaved(JSON.stringify(marker({ at: NOW + 5 * 60_000 })), NOW), null);
});

test("the tracker opens on the saved row from its link, or once soon after the save", () => {
  // Through "Saved to tracker": always, while the line lives.
  assert.equal(shouldAutoOpen(marker({ opened: true, at: NOW - 3 * 3600_000 }), NOW, ID), true);
  assert.equal(shouldAutoOpen(marker(), NOW, "another-id-0000"), false);
  // Opened from the nav: once, within half an hour.
  assert.equal(shouldAutoOpen(marker(), NOW, null), true);
  assert.equal(shouldAutoOpen(marker({ opened: true }), NOW, null), false);
  assert.equal(shouldAutoOpen(marker({ at: NOW - JUST_SAVED_AUTO_OPEN_MS - 1 }), NOW, null), false);
  // Closed by the user: never again.
  assert.equal(shouldAutoOpen(marker({ dismissed: true }), NOW, ID), false);
  assert.equal(shouldAutoOpen(null, NOW, ID), false);
});

test("the line shows until it is closed", () => {
  assert.equal(showsJustSaved(marker()), true);
  assert.equal(showsJustSaved(marker({ opened: true })), true);
  assert.equal(showsJustSaved(marker({ dismissed: true })), false);
  assert.equal(showsJustSaved(null), false);
});

test("kept under the workspace prefix, so sign-out sweeps it (lib/workspace clearAllWorkspaces)", () => {
  assert.ok(justSavedKey("user-1").startsWith("cvtailor:workspace:"));
  assert.notEqual(justSavedKey("user-1"), "cvtailor:workspace:user-1");
});
