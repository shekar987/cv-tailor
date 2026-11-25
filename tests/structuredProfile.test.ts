import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStructuredProfile } from "../src/lib/profile/import.ts";
import {
  validateStructuredProfile,
  metricValueInSource,
  findMetric,
  findBullet,
  RIDEX_LABEL,
} from "../src/lib/profile/validate.ts";
import {
  normalizeStructuredProfile,
  STRUCTURED_PROFILE_JSON_SCHEMA,
  type StructuredProfile,
} from "../src/lib/profile/schema.ts";

const CV = readFileSync("fixtures/cv.example.txt", "utf8");
const NOW = "2026-11-25T00:00:00.000Z";

function fresh(): StructuredProfile {
  return buildStructuredProfile(CV, NOW).profile;
}

// Deep-clone so a mutation in one test can't leak into another.
function clone(p: StructuredProfile): StructuredProfile {
  return JSON.parse(JSON.stringify(p));
}

test("importer places every bullet, leaves unmapped empty, and the metrics match", () => {
  const { profile, problems } = buildStructuredProfile(CV, NOW);
  assert.equal(problems.length, 0, `importer problems: ${problems.join("; ")}`);

  // All bullets placed: 6 experience + 2 project = 8, and the number of
  // bullet-glyph lines in the source equals the number of placed bullets.
  const bulletLines = CV.split("\n").filter((l) => /^\s*[-•*]\s+/.test(l)).length;
  const placed =
    profile.experience.reduce((n, e) => n + e.bullets.length, 0) +
    profile.projects.reduce((n, p) => n + p.bullets.length, 0);
  assert.equal(placed, bulletLines);
  assert.equal(placed, 8);

  // Nothing dropped or guessed.
  assert.deepEqual(profile.unmapped, []);

  // The six metrics Shekar named, with their directions.
  const metrics = profile.experience.flatMap((e) => e.bullets).flatMap((b) => b.metrics);
  const values = metrics.map((m) => m.value).sort();
  assert.deepEqual(values, ["15%", "20%", "25%", "3", "30%", "40%"].sort());
  const byValue = new Map(metrics.map((m) => [m.value, m]));
  assert.equal(byValue.get("40%")?.direction, "down"); // deployment time
  assert.equal(byValue.get("25%")?.direction, "down"); // API response time
  assert.equal(byValue.get("30%")?.direction, "down"); // query time
  assert.equal(byValue.get("15%")?.direction, "down"); // downtime
  assert.equal(byValue.get("20%")?.direction, "down"); // defects
  assert.equal(byValue.get("3")?.direction, "none"); // mentored 3 juniors

  // Every metric carries a source line.
  for (const m of metrics) {
    assert.ok(m.source.section, `metric ${m.id} has no source section`);
    assert.ok(typeof m.source.line === "number", `metric ${m.id} has no source line`);
  }
});

test("a clean imported profile passes validation", () => {
  const { profile } = buildStructuredProfile(CV, NOW);
  const result = validateStructuredProfile(profile, CV);
  assert.ok(result.ok, `unexpected problems: ${result.problems.join("; ")}`);
});

test("validation catches an invented metric (−50%)", () => {
  const p = clone(fresh());
  // Change a real 40% to a 50% that is NOT in the CV.
  p.experience[0].bullets[0].metrics[0].value = "50%";
  const result = validateStructuredProfile(p, CV);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((m) => m.includes("50%")), result.problems.join("; "));
});

test("validation catches a production skill with no experience bullet", () => {
  const p = clone(fresh());
  p.skills.push({ id: "SX", name: "Rust", tier: "technical", evidence: "production", evidence_refs: [] });
  const result = validateStructuredProfile(p, CV);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((m) => /production/i.test(m) && /Rust/.test(m)), result.problems.join("; "));
});

test("validation catches RideX relabelled (not its fixed label)", () => {
  const p = clone(fresh());
  p.projects[0].label = "a client project";
  const result = validateStructuredProfile(p, CV);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((m) => m.includes(RIDEX_LABEL)), result.problems.join("; "));
});

test("validation catches a project described as client work", () => {
  const p = clone(fresh());
  // Keep the RideX label correct so this is the client-work rule, not the label rule.
  p.projects[0].bullets[0].text = "Built a booking platform as client work for a paying client.";
  const result = validateStructuredProfile(p, CV);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((m) => /client work/i.test(m)), result.problems.join("; "));
});

test("validation catches a missing source", () => {
  const p = clone(fresh());
  p.experience[0].bullets[0].metrics[0].source = { section: "", line: null, text: "" };
  const result = validateStructuredProfile(p, CV);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((m) => /no source/i.test(m)), result.problems.join("; "));
});

test("metricValueInSource respects number boundaries", () => {
  assert.equal(metricValueInSource("40%", CV), true);
  assert.equal(metricValueInSource("3", CV), true);
  // "5%" must NOT be found inside "15%"/"25%"; the CV has no standalone 5%.
  assert.equal(metricValueInSource("5%", CV), false);
  // An invented 50% is not in the CV even though "0%" characters appear.
  assert.equal(metricValueInSource("50%", CV), false);
});

test("findMetric and findBullet trace back to real facts (TL-6 hooks)", () => {
  const p = fresh();
  const m = findMetric(p, "40%");
  assert.ok(m, "findMetric should find 40%");
  assert.equal(m?.label, "deployment time");
  assert.equal(m?.source.section, "experience");

  assert.equal(findMetric(p, "99%"), null);

  const b = findBullet(p, "Cut deployment time by 40% by introducing a CI/CD pipeline with GitHub Actions.");
  assert.ok(b, "findBullet should find the exact bullet");
  assert.equal(b?.id, "E1.1");

  // A loosely paraphrased sentence still traces when it shares enough words.
  const near = findBullet(p, "Reduced defects by 20% with unit and integration tests in Jest");
  assert.equal(near?.id, "E2.3");

  // An unrelated sentence traces to nothing.
  assert.equal(findBullet(p, "Played the violin in a string quartet"), null);
});

test("normalizeStructuredProfile coerces junk to the real shape", () => {
  const p = normalizeStructuredProfile({ version: 9, experience: "nope", skills: [{ name: "Go", evidence: "bogus" }] });
  assert.equal(p.version, 1);
  assert.deepEqual(p.experience, []);
  assert.equal(p.skills[0].name, "Go");
  assert.equal(p.skills[0].evidence, "project"); // unknown evidence falls back
  assert.equal(p.skills[0].tier, "technical");
  assert.deepEqual(p.unmapped, []);
});

test("the exported JSON Schema lists every top-level section", () => {
  const required = STRUCTURED_PROFILE_JSON_SCHEMA.required as readonly string[];
  for (const key of ["experience", "skills", "projects", "education", "certifications", "summary_facts", "unmapped"]) {
    assert.ok(required.includes(key), `JSON schema missing ${key}`);
  }
});
