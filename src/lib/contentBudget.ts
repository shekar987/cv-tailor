// Adaptive content budget for the tailoring prompts.
//
// LENGTH_BUDGET in prompts/steps.ts fixes 5/4/3 bullets per role and "2 per
// project" no matter how much the master CV holds — sized for a worst-case
// CV. cvDensity.ts then adapts the layout's SPACING to fill two pages, so a
// compact CV ended up with a large share of its real bullets dropped AND
// half-empty pages. This module closes the loop from the content side: look
// at how much experience the master CV actually has, and only ask the model
// to trim when two pages genuinely can't hold it.
//
// Deterministic and dependency-free. CV formats vary wildly, so the parsing
// is heuristic — and every failure path returns null, in which case the
// caller uses the fixed default budget and behaviour is exactly what it was
// before this module existed.

export type ExperienceShape = {
  roleCount: number;
  bulletsPerRole: number[];
  totalBullets: number;
};

// ~22 experience bullets is what two pages hold once the header, summary,
// skills, projects, education and right-to-work sections take their share —
// the same arithmetic LENGTH_BUDGET's comment in prompts/steps.ts documents.
const EXPERIENCE_BULLET_CAPACITY = 22;

const EXPERIENCE_HEADING = /^\s*(?:WORK\s+|PROFESSIONAL\s+)?EXPERIENCE\s*:?\s*$/i;
// Any later ALL-CAPS line ends the section (PROJECTS, EDUCATION, ...).
const NEXT_HEADING = /^\s*[A-Z][A-Z\s&/-]{2,40}:?\s*$/;
// A role header: a non-bullet line carrying a year range ("Jul 2022 – Sep
// 2024", "2019-2023", "Jan 2022 – Present"). Date-only lines (two-line
// header format) match too, which still counts one role per position.
const YEAR = String.raw`(?:19|20)\d{2}`;
const ROLE_HEADER = new RegExp(
  String.raw`${YEAR}\s*[–—-]\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?${YEAR}|present)`,
  "i"
);
const BULLET = /^\s*[-•*]\s+/;
const HIGHLIGHT = /^\s*highlight\s*:/i;

export function parseExperienceShape(cvText: string): ExperienceShape | null {
  const lines = (cvText || "").split("\n");
  const start = lines.findIndex((l) => EXPERIENCE_HEADING.test(l));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_HEADING.test(lines[i]) && !EXPERIENCE_HEADING.test(lines[i])) {
      end = i;
      break;
    }
  }

  const bulletsPerRole: number[] = [];
  for (let i = start + 1; i < end; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!BULLET.test(lines[i]) && ROLE_HEADER.test(line)) {
      bulletsPerRole.push(0);
      continue;
    }
    if (bulletsPerRole.length === 0) continue; // stray line before the first role
    // A "Highlight:" line under a header is content the tailored CV keeps
    // (as the role's first bullet), so it counts toward the role's bullets.
    if (BULLET.test(lines[i]) || HIGHLIGHT.test(line)) {
      bulletsPerRole[bulletsPerRole.length - 1] += 1;
    }
  }

  if (bulletsPerRole.length === 0) return null;
  const totalBullets = bulletsPerRole.reduce((a, b) => a + b, 0);
  if (totalBullets === 0) return null;
  return { roleCount: bulletsPerRole.length, bulletsPerRole, totalBullets };
}

const SHARED_RULES = `- Keep every bullet to a maximum of two printed lines (roughly 200 characters).
- Trim ONLY by deleting whole bullets. Never merge two achievements into one sentence, never combine metrics, and never drop a qualifier that a claim depends on — that would state something the master CV does not support.
- Never drop a whole role, and never change any employer, title, or date.`;

// The experience budget for THIS master CV, or null when the CV can't be
// parsed (the caller then uses the fixed LENGTH_BUDGET default).
export function experienceBudget(cvText: string): string | null {
  const shape = parseExperienceShape(cvText);
  if (!shape) return null;

  if (shape.totalBullets <= EXPERIENCE_BULLET_CAPACITY) {
    return `LENGTH BUDGET — the finished CV must fit on TWO A4 pages, and this master CV is compact enough that EVERY experience bullet fits:
- Keep EVERY bullet from EVERY role — this CV has ${shape.totalBullets} experience bullets across ${shape.roleCount} role(s), and two pages hold them all. Do not drop content to "tailor" it; tailor by REORDERING bullets within each role so the most JD-relevant come first, and by rephrasing.
${SHARED_RULES}`;
  }

  // Over capacity: distribute the two-page allowance across roles in
  // master-CV order (most recent first by convention), never below 2 bullets
  // for a role and never above what the role actually has.
  const caps: number[] = [];
  let remaining = EXPERIENCE_BULLET_CAPACITY;
  shape.bulletsPerRole.forEach((have, i) => {
    const rolesLeft = shape.roleCount - i;
    const fairShare = Math.ceil(remaining / rolesLeft) + (i === 0 ? 1 : 0);
    const cap = Math.max(2, Math.min(have, fairShare, remaining - (rolesLeft - 1) * 2));
    caps.push(cap);
    remaining -= cap;
  });
  const perRole = caps
    .map((c, i) => `- Role ${i + 1} (in master-CV order): at most ${c} bullets.`)
    .join("\n");
  return `LENGTH BUDGET — the finished CV must fit on TWO A4 pages; this master CV has more experience bullets (${shape.totalBullets}) than two pages hold, so trim to these caps:
${perRole}
- If it still runs long, DROP the least JD-relevant bullets entirely, oldest roles first.
${SHARED_RULES}`;
}

// Per-project bullet allowance scaled by how many projects there are.
export function projectsBudget(projectCount: number): string {
  const per = projectCount <= 2 ? 4 : projectCount <= 4 ? 3 : 2;
  return `LENGTH BUDGET — the finished CV must fit on TWO A4 pages, and projects sit after experience, so they are what pushes it over. This CV has ${projectCount} project(s): write up to ${per} bullets per project — use the project's REAL bullets from the master CV as the base (rephrased and reordered for this JD), never pad with invented ones, and fewer is fine when the master CV has fewer. Keep each bullet to a single printed line where possible and never more than two. Trim by dropping a whole bullet, never by merging two achievements or combining their metrics into one sentence.`;
}
