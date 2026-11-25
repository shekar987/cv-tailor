// Validating a structured profile against the master CV it was built from, and
// the two helpers TL-6 (the honesty verifier) will use to trace a generated
// sentence back to a real fact.
//
// Deterministic and import-free apart from the schema types (relative, with the
// extension Node's test runner needs), so it runs identically on the server, in
// the editor's "Save" button and under node:test. It NEVER throws — it returns
// a list of plain-English problems, because the owner reads them.

import type { StructuredProfile, Metric, Bullet } from "./schema.ts";

// RideX is a personal portfolio project; its label is fixed so no tailored CV
// can quietly turn it into paid or client work.
export const RIDEX_LABEL = "personal portfolio project modelled on a real-world brief";
const RIDEX_NAME = /\bridex\b/i;

// Phrases that describe a project as client work. Deliberately narrow — a
// genuine "client-side rendering" bullet must pass — so each pattern names the
// work, not just the word "client".
const CLIENT_WORK = [
  /\bclient work\b/i,
  /\bclient project\b/i,
  /\bclient engagement\b/i,
  /\bclient[- ]facing\b/i,
  /\bfor (?:a |our |the )?clients?\b/i,
  /\breal clients?\b/i,
  /\bpaying clients?\b/i,
  /\bclients? brief\b/i,
];

function normalizeForMatch(s: string): string {
  return (s || "")
    .replace(/\*\*/g, "")
    .replace(/[‒-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, " ")
    .toLowerCase()
    .trim();
}

// A metric value appears "verbatim" in the CV when the same run of characters
// sits there as its own number — not buried inside a longer one. So "5%" is
// NOT found inside "15%", and an invented "50%" is NOT found inside "150%": the
// value must be preceded by a non-digit (and non ".,") and followed by a
// non-digit. Tolerant of **bold**, en-dashes and smart quotes (normalised on
// both sides).
export function metricValueInSource(value: string, cvText: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const hay = normalizeForMatch(cvText);
  const needle = normalizeForMatch(v);
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not part of a longer number on either side. The value itself may end in a
  // unit char (% ) — the lookahead only forbids a trailing DIGIT.
  const re = new RegExp(`(?<![\\d.,])${esc}(?![\\d])`);
  return re.test(hay);
}

export type ValidationResult = { ok: boolean; problems: string[] };

// Check a structured profile against the master CV text it claims to come
// from. Returns every problem found, not just the first.
export function validateStructuredProfile(profile: StructuredProfile, cvText: string): ValidationResult {
  const problems: string[] = [];
  const cv = cvText || "";

  // Collect every bullet (experience + project) and the ids that exist.
  const expBullets: Bullet[] = profile.experience.flatMap((e) => e.bullets);
  const projBullets: Bullet[] = profile.projects.flatMap((p) => p.bullets);
  const expBulletIds = new Set(expBullets.map((b) => b.id));
  const allBullets = [...expBullets, ...projBullets];

  // Rule 1 — every metric value must appear verbatim in the master CV.
  const metrics: { metric: Metric; where: string }[] = [
    ...expBullets.flatMap((b) => b.metrics.map((m) => ({ metric: m, where: `bullet ${b.id}` }))),
    ...projBullets.flatMap((b) => b.metrics.map((m) => ({ metric: m, where: `project bullet ${b.id}` }))),
  ];
  for (const { metric, where } of metrics) {
    if (!metricValueInSource(metric.value, cv)) {
      problems.push(
        `Metric "${metric.label || metric.id}" (${metric.value || "no value"}) in ${where} is not in your master CV. Every number must appear in the CV exactly as written.`
      );
    }
  }

  // Rule 2 — a production skill must link to at least one experience bullet.
  for (const skill of profile.skills) {
    if (skill.evidence !== "production") continue;
    const linksToExperience = skill.evidence_refs.some((ref) => expBulletIds.has(ref));
    if (!linksToExperience) {
      problems.push(
        `Skill "${skill.name || skill.id}" is marked "production" but is not linked to any work-experience bullet. Lower it to "project", or link it to a real experience bullet.`
      );
    }
  }

  // Rule 3 — RideX keeps its exact label.
  for (const project of profile.projects) {
    if (RIDEX_NAME.test(project.name) && project.label.trim() !== RIDEX_LABEL) {
      problems.push(
        `Project "${project.name}" must be labelled exactly "${RIDEX_LABEL}" (found "${project.label || "no label"}").`
      );
    }
  }

  // Rule 4 — no project may be described as client work.
  for (const project of projectDescriptions(profile)) {
    const hay = normalizeForMatch(project.text);
    if (CLIENT_WORK.some((re) => re.test(hay))) {
      problems.push(
        `Project "${project.name}" is described as client work ("${project.text.trim().slice(0, 80)}"). A project is not client work — reword it.`
      );
    }
  }

  // Rule 5 — every traceable fact must carry a source.
  for (const b of allBullets) {
    if (!b.source.section.trim()) problems.push(`Bullet "${b.id}" has no source. Every bullet must say where it came from.`);
    for (const m of b.metrics) {
      if (!m.source.section.trim()) {
        problems.push(`Metric "${m.label || m.id}" in bullet "${b.id}" has no source. Every number must say where it came from.`);
      }
    }
  }
  for (const ed of profile.education) {
    if (!ed.source.section.trim()) problems.push(`Education entry "${ed.degree || ed.id}" has no source.`);
  }
  for (const c of profile.certifications) {
    if (!c.source.section.trim()) problems.push(`Certification "${c.name || c.id}" has no source.`);
  }
  for (const sf of profile.summary_facts) {
    if (!sf.source.section.trim()) problems.push(`Summary fact "${sf.text.slice(0, 40) || sf.id}" has no source.`);
  }

  return { ok: problems.length === 0, problems };
}

function projectDescriptions(profile: StructuredProfile): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const p of profile.projects) {
    out.push({ name: p.name, text: p.label });
    for (const b of p.bullets) out.push({ name: p.name, text: b.text });
  }
  return out;
}

// ── Honesty-trace hooks (for TL-6) ────────────────────────────────────────────
// Given a value or a sentence that a tailored CV wants to use, find the real
// fact it traces back to — or null when nothing does (which is what the
// verifier will treat as "do not say this").

export function findMetric(profile: StructuredProfile, value: string): Metric | null {
  const target = normalizeForMatch(value);
  if (!target) return null;
  const metrics = [...profile.experience, ...profile.projects]
    .flatMap((x) => x.bullets)
    .flatMap((b) => b.metrics);
  // Exact value first, then a value that stands as its own number inside the
  // asked-for string (so "40%" matches a request for "40% faster").
  const exact = metrics.find((m) => normalizeForMatch(m.value) === target);
  if (exact) return exact;
  return metrics.find((m) => m.value.trim() && metricValueInSource(m.value, value)) ?? null;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "at",
  "from", "as", "that", "this", "it", "is", "was", "were", "i", "my", "we", "our",
]);

function contentTokens(s: string): string[] {
  return normalizeForMatch(s)
    .replace(/[^a-z0-9%+#. ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

// Find the master bullet a generated sentence came from: an exact match first,
// else the bullet sharing the most content words, if that overlap clears
// OVERLAP_MIN of the sentence's own words.
const OVERLAP_MIN = 0.6;
export function findBullet(profile: StructuredProfile, text: string): Bullet | null {
  const bullets = [...profile.experience, ...profile.projects].flatMap((x) => x.bullets);
  if (!bullets.length) return null;
  const target = normalizeForMatch(text);
  if (!target) return null;
  const exact = bullets.find((b) => normalizeForMatch(b.text) === target);
  if (exact) return exact;
  const wanted = contentTokens(text);
  if (!wanted.length) return null;
  let best: Bullet | null = null;
  let bestScore = 0;
  for (const b of bullets) {
    const have = new Set(contentTokens(b.text));
    const hits = wanted.filter((t) => have.has(t)).length;
    const score = hits / wanted.length;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return bestScore >= OVERLAP_MIN ? best : null;
}
