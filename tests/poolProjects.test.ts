// Unit tests for the pool-mode project selection boundary (lib/poolProjects). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSelectedProjects, projectsFromSelected } from "../src/lib/poolProjects.ts";

const POOL = `AssetGuard+ (personal portfolio project modelled on a real-world brief)
Next.js, Supabase
- Built a gap-analysis dashboard for 11 platforms.

Ledgerly
AWS Lambda, SQS
- Built a billing pipeline.`;

test("normalizeSelectedProjects: bounded, nameless or bullet-less entries dropped, ' | ' in a name replaced", () => {
  const sel = normalizeSelectedProjects({
    selected: [
      { name: "Ledgerly | Billing", date: "2025", tech: "AWS Lambda", bullets: ["- Built a billing pipeline.", ""] },
      { name: "", bullets: ["x"] },
      { name: "No bullets", bullets: [] },
      { name: "Third", bullets: ["a"] },
    ],
  });
  assert.deepEqual(sel.map((s) => s.name), ["Ledgerly – Billing", "Third"]);
  assert.deepEqual(sel[0].bullets, ["Built a billing pipeline."]);
  assert.deepEqual(projectsFromSelected(sel), { "0": ["Built a billing pipeline."], "1": ["a"] });
  assert.deepEqual(normalizeSelectedProjects(null), []);
  assert.deepEqual(normalizeSelectedProjects({ selected: "no" }), []);
});

test("normalizeSelectedProjects: with the pool's text a bare name gets its qualifier back", () => {
  const sel = normalizeSelectedProjects({ selected: [{ name: "AssetGuard+", bullets: ["Built a gap-analysis dashboard for 11 platforms."] }, { name: "Ledgerly", bullets: ["Built a billing pipeline."] }] }, POOL);
  assert.deepEqual(sel.map((s) => s.name), ["AssetGuard+ (personal portfolio project modelled on a real-world brief)", "Ledgerly"]);
  assert.equal(normalizeSelectedProjects({ selected: [{ name: "AssetGuard+", bullets: ["x"] }] })[0].name, "AssetGuard+", "no pool text, no change");
});
