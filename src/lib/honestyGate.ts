// Honesty gate: runs after generation and at download time (JH-6, 25 Nov 2026).
// Checks three new guarantees that the tailor route's existing guards missed on 24 Nov:
//   A. Availability claims ("available immediately", "can start now", "notice period")
//      only appeared in generated summaries and letters before; experience bullets were
//      unchecked. The gate strips them from ALL sections.
//   B. Numbers in generated bullets must appear in the master CV text. "150 automated
//      tests" with no source was kept because checkClaims only blocks in enforce mode.
//      The gate flags (does not block downloads) unsupported figures.
//   C. Pinned bullets: a bullet the user marked pinned: true in the structured profile
//      must survive the whole pipeline. The gate detects when one is missing.
//
// Does NOT duplicate:
//   - Retired phrase removal (applyRetired — already in the tailor route and document
//     guard). The gate reapplies it for the download routes.
//   - Fact guard / degree / overclaimed tools (factGuard — already in tailor route).
//   - Right-to-work strip (reconcileRightToWorkSentences — already in tailor route).
//
// Import-free from external packages; runs under node:test with no @/ alias.

import { mentionsAvailability } from "./rightToWorkText.ts";
import { extractFigures } from "./claims.ts";
import { applyRetired, type RetiredClaim } from "./retiredClaims.ts";

export type HonestyDoc = {
  summary: string;
  skills: string;
  experience: string;
  projects: Record<string, string[]>; // key → bullets
  coverLetter: string;
};

export type HonestyGateInput = {
  sections: HonestyDoc;
  masterCv: string;
  retiredClaims?: readonly RetiredClaim[];
  // The exact availability sentence the route will place (from rightToWorkStatement or
  // availabilityCvSentence). When set, only this sentence is allowed; all other
  // availability claims are stripped. When null/absent, all are stripped.
  allowedAvailabilitySentence?: string | null;
  // Texts of pinned bullets from the structured profile.
  pinnedTexts?: readonly string[];
};

export type HonestyGateResult = {
  sections: HonestyDoc;
  removed: string[]; // lines/sentences removed (shown in the notice)
  blocked: string[]; // present but flagged (number unsupported, pinned missing)
};

// Split a prose text into sentences at . ! ? followed by whitespace + capital.
// Mirrors the private splitSentences in rightToWorkText.ts (import-free, same rule).
function splitSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim());
}

// Is this sentence the exact allowed availability sentence? Trims and compares.
function isAllowedSentence(s: string, allowed: string): boolean {
  return s.trim() === allowed.trim();
}

// Strip availability claims from a prose text (summary / cover letter).
// Operates sentence by sentence within each line.
function stripAvailabilityFromProse(
  text: string,
  allowed: string | null | undefined,
  removed: string[],
): string {
  const lines = (text ?? "").split("\n");
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    const sentences = splitSentences(line);
    const kept = sentences.filter((s) => {
      if (!mentionsAvailability(s)) return true;
      if (allowed && isAllowedSentence(s, allowed)) return true;
      removed.push(s.trim());
      return false;
    });
    return kept.join(" ").trim();
  });
  // Collapse consecutive blank lines (mirrors rightToWorkText collapseBlankRuns).
  const collapsed: string[] = [];
  for (const line of out) {
    if (!line.trim() && collapsed.length > 0 && !collapsed[collapsed.length - 1].trim()) continue;
    collapsed.push(line);
  }
  while (collapsed.length && !collapsed[0].trim()) collapsed.shift();
  while (collapsed.length && !collapsed[collapsed.length - 1].trim()) collapsed.pop();
  return collapsed.join("\n");
}

// Strip availability claims from a line-oriented section (skills / experience).
// A whole line that mentions availability is removed.
function stripAvailabilityFromLines(
  text: string,
  allowed: string | null | undefined,
  removed: string[],
): string {
  const lines = (text ?? "").split("\n");
  const kept = lines.filter((line) => {
    if (!line.trim()) return true;
    if (!mentionsAvailability(line)) return true;
    // For line sections, if the allowed sentence matches the whole trimmed line exactly,
    // keep it. Otherwise strip.
    if (allowed && isAllowedSentence(line, allowed)) return true;
    removed.push(line.trim());
    return false;
  });
  return kept.join("\n");
}

// Strip availability claims from a list of bullet strings (project bullets).
function stripAvailabilityFromBullets(
  bullets: string[],
  allowed: string | null | undefined,
  removed: string[],
): string[] {
  return bullets.filter((b) => {
    if (!b.trim()) return true;
    if (!mentionsAvailability(b)) return true;
    if (allowed && isAllowedSentence(b, allowed)) return true;
    removed.push(b.trim());
    return false;
  });
}

// Check a single bullet's figures against the master CV. Returns the numeric
// strings (from Figure.key) that are not found anywhere in masterCv.
// extractFigures returns figures with a `key` like "150", "40%", "£2.3m".
// We extract the numeric part of each key and look for it as a substring.
function unsupportedFiguresInBullet(bullet: string, masterCv: string): string[] {
  const figures = extractFigures(bullet);
  const result: string[] = [];
  for (const fig of figures) {
    // fig.key is e.g. "150", "40%", "£2.3m". We want the raw numeric digits+decimal.
    // The key starts with an optional currency symbol then the number+unit.
    // Check whether the numeric digits appear literally in the masterCv.
    // We use fig.text (the verbatim match, e.g. "150") and also try the key itself.
    const numericPart = fig.key.replace(/^[£$€₹]/, "").replace(/%$/, "").replace(/ .*/, "");
    const inMaster = masterCv.includes(numericPart) || masterCv.includes(fig.text.trim());
    if (!inMaster) {
      result.push(numericPart);
    }
  }
  return result;
}

// Check all bullets in experience (line-based) for unsupported figures.
// Experience is a prose block with bullet lines (starting with •, -, *, etc., or just text).
function flagUnsupportedFiguresInExperience(
  experience: string,
  masterCv: string,
  blocked: string[],
): void {
  for (const line of experience.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bad = unsupportedFiguresInBullet(trimmed, masterCv);
    for (const n of bad) {
      blocked.push(`Unsupported figure in experience: ${n} (in: "${trimmed.slice(0, 80)}")`);
    }
  }
}

// Check all bullets in project arrays for unsupported figures.
function flagUnsupportedFiguresInProjects(
  projects: Record<string, string[]>,
  masterCv: string,
  blocked: string[],
): void {
  for (const bullets of Object.values(projects)) {
    for (const bullet of bullets) {
      const trimmed = bullet.trim();
      if (!trimmed) continue;
      const bad = unsupportedFiguresInBullet(trimmed, masterCv);
      for (const n of bad) {
        blocked.push(`Unsupported figure in project: ${n} (in: "${trimmed.slice(0, 80)}")`);
      }
    }
  }
}

// Check whether each pinned text is still present somewhere in the output sections.
function checkPinnedBullets(
  pinnedTexts: readonly string[],
  sections: HonestyDoc,
  blocked: string[],
): void {
  // Build one concatenated output text to search in.
  const allProjectBullets = Object.values(sections.projects).flat().join("\n");
  const allText = [
    sections.summary,
    sections.skills,
    sections.experience,
    allProjectBullets,
    sections.coverLetter,
  ].join("\n");

  for (const pinned of pinnedTexts) {
    if (!pinned.trim()) continue;
    if (!allText.includes(pinned.trim())) {
      blocked.push(`Pinned bullet missing: ${pinned.trim().slice(0, 80)}`);
    }
  }
}

// Apply retired claims to a prose string. Returns the cleaned text and reports
// removed phrases (those replaced with null replacement) in `removed`.
function applyRetiredToProse(
  text: string,
  rules: readonly RetiredClaim[],
  removed: string[],
): string {
  if (!rules.length) return text;
  const { text: out, report } = applyRetired(text, rules);
  // report.removed contains the phrases that were removed (replacement === null).
  for (const phrase of report.removed) {
    removed.push(phrase);
  }
  return out;
}

export function honestyGate(input: HonestyGateInput): HonestyGateResult {
  const { sections, masterCv, retiredClaims, allowedAvailabilitySentence, pinnedTexts } = input;
  const removed: string[] = [];
  const blocked: string[] = [];

  // ── Step 1: Strip availability from all sections ─────────────────────────

  const summary = stripAvailabilityFromProse(sections.summary, allowedAvailabilitySentence, removed);
  const skills = stripAvailabilityFromLines(sections.skills, allowedAvailabilitySentence, removed);
  const experience = stripAvailabilityFromLines(sections.experience, allowedAvailabilitySentence, removed);
  const coverLetter = stripAvailabilityFromProse(sections.coverLetter, allowedAvailabilitySentence, removed);

  const projects: Record<string, string[]> = {};
  for (const [key, bullets] of Object.entries(sections.projects)) {
    projects[key] = stripAvailabilityFromBullets(bullets, allowedAvailabilitySentence, removed);
  }

  // ── Step 2: Re-apply retired claims ──────────────────────────────────────

  const rules = retiredClaims ?? [];

  const cleanedSections: HonestyDoc = {
    summary: applyRetiredToProse(summary, rules, removed),
    skills: applyRetiredToProse(skills, rules, removed),
    experience: applyRetiredToProse(experience, rules, removed),
    projects: Object.fromEntries(
      Object.entries(projects).map(([k, bullets]) => [
        k,
        bullets.map((b) => applyRetiredToProse(b, rules, removed)),
      ]),
    ),
    coverLetter: applyRetiredToProse(coverLetter, rules, removed),
  };

  // ── Step 3: Flag unsupported figures (does not remove) ───────────────────

  flagUnsupportedFiguresInExperience(cleanedSections.experience, masterCv, blocked);
  flagUnsupportedFiguresInProjects(cleanedSections.projects, masterCv, blocked);

  // ── Step 4: Check pinned bullets survived ────────────────────────────────

  if (pinnedTexts && pinnedTexts.length > 0) {
    checkPinnedBullets(pinnedTexts, cleanedSections, blocked);
  }

  return { sections: cleanedSections, removed, blocked };
}
