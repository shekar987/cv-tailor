import { test } from "node:test";
import assert from "node:assert/strict";
import { highConfidenceFixes, statusFixes, suggestStatus } from "../src/lib/statusFix.ts";

test("notes saying 'not submitted' on an Applied row suggest Ready to submit", () => {
  const s = suggestStatus({ id: "a", status: "applied", notes: "I have not actually submitted this yet." });
  assert.equal(s?.to, "saved");
  assert.equal(s?.confidence, "high");
});

test("notes_not_submitted flag is honoured too", () => {
  const s = suggestStatus({ id: "a", status: "applied", notes_not_submitted: true });
  assert.equal(s?.to, "saved");
});

test("a stage history reaching further than the stored status suggests the furthest stage", () => {
  const s = suggestStatus({ id: "a", status: "applied", stages_reached: ["applied", "screening", "interview"] });
  assert.equal(s?.to, "interview");
  assert.equal(s?.confidence, "high");
});

test("no suggestion when the status already matches the history", () => {
  assert.equal(suggestStatus({ id: "a", status: "interview", stages_reached: ["applied", "screening", "interview"] }), null);
});

test("an ended row is left alone (its outcome is the user's call)", () => {
  assert.equal(suggestStatus({ id: "a", status: "rejected", stages_reached: ["applied", "screening"] }), null);
  assert.equal(suggestStatus({ id: "a", status: "withdrawn", notes: "never submitted" }), null);
});

test("endings in the history do not count as 'further'", () => {
  assert.equal(suggestStatus({ id: "a", status: "applied", stages_reached: ["applied", "rejected"] }), null);
});

test("statusFixes and highConfidenceFixes group by target", () => {
  const rows = [
    { id: "a", status: "applied", notes: "not submitted" },
    { id: "b", status: "applied", stages_reached: ["applied", "screening"] },
    { id: "c", status: "interview" },
    { id: "d", status: "applied", stages_reached: ["applied", "screening"] },
  ];
  assert.equal(statusFixes(rows).length, 3);
  const byTarget = highConfidenceFixes(rows);
  assert.deepEqual(byTarget.get("saved")?.map((r) => r.id), ["a"]);
  assert.deepEqual(byTarget.get("screening")?.map((r) => r.id), ["b", "d"]);
});
