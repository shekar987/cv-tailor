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
// 2024", "2019-2023", "07/2022 to 09/2024", "Jan 2022 – Present"). CVs write
// ranges with an en-dash OR a bare "to", and dates as "Sep 2024" OR
// "09/2024". Date-only lines (two-line header format) match too, which
// still counts one role per position.
const YEAR = String.raw`(?:\d{1,2}\/)?(?:19|20)\d{2}`;
const ROLE_HEADER = new RegExp(
  String.raw`${YEAR}\s*(?:[–—-]|to)\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?${YEAR}|present)`,
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
  const contentLinesPerRole: number[] = [];
  let markedBullets = 0;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!BULLET.test(lines[i]) && ROLE_HEADER.test(line)) {
      bulletsPerRole.push(0);
      contentLinesPerRole.push(0);
      continue;
    }
    if (bulletsPerRole.length === 0) continue; // stray line before the first role
    contentLinesPerRole[contentLinesPerRole.length - 1] += 1;
    // A "Highlight:" line under a header is content the tailored CV keeps,
    // so it counts toward the role's bullets.
    if (BULLET.test(lines[i]) || HIGHLIGHT.test(line)) {
      bulletsPerRole[bulletsPerRole.length - 1] += 1;
      markedBullets += 1;
    }
  }

  if (bulletsPerRole.length === 0) return null;
  // A CV uploaded as a PDF often loses its bullet glyphs in text extraction
  // (the owner's real CV did) — the achievements arrive as plain lines. When
  // NO marked bullets exist at all, count content lines instead. Wrapped
  // lines over-count a little, which only errs toward trimming slightly
  // more — the safe side of the two-page promise.
  const counts = markedBullets > 0 ? bulletsPerRole : contentLinesPerRole;
  const totalBullets = counts.reduce((a, b) => a + b, 0);
  if (totalBullets === 0) return null;
  return { roleCount: counts.length, bulletsPerRole: counts, totalBullets };
}

const SHARED_RULES = `- Keep every bullet to a maximum of two printed lines (190 characters).
- Trim ONLY by deleting whole bullets. Never merge two achievements into one sentence, never combine metrics, and never drop a qualifier that a claim depends on — that would state something the master CV does not support.
- Never drop a whole role, and never change any employer, title, or date.`;

// A style's bullet limits (lib/formatStyles): CareerSet keeps 12-20 bullets
// across experience and projects, each at most 30 words, the document
// under 900 words. `total` null = UKJI, whose budget is the page's.
export type BulletBudgetStyle = {
  maxWords: number | null;
  total: { min: number; max: number } | null;
  perProject: { min: number; max: number };
  cvMaxWords: number | null;
};
// How many bullets each project gets in the plan: four for up to two
// projects, three beyond, never above the style's own per-project cap.
export function plannedPerProject(projectCount: number, style?: BulletBudgetStyle | null): number {
  const per = projectCount <= 2 ? 4 : projectCount <= 4 ? 3 : 2;
  return style?.total ? Math.max(style.perProject.min, Math.min(per, style.perProject.max)) : per;
}
// The experience bullets a style's total leaves after the projects' share,
// never below this floor.
const STYLE_EXPERIENCE_FLOOR = 8;
export function styledExperienceCapacity(style: BulletBudgetStyle, projectCount: number): number {
  if (!style.total) return EXPERIENCE_BULLET_CAPACITY;
  return Math.max(STYLE_EXPERIENCE_FLOOR, style.total.max - projectCount * plannedPerProject(projectCount, style));
}

function perRoleCaps(shape: ExperienceShape, capacity: number): number[] {
  // Distribute the allowance across roles in master-CV order (most recent
  // first by convention), never below 2 bullets for a role and never above
  // what the role actually has.
  const caps: number[] = [];
  let remaining = capacity;
  shape.bulletsPerRole.forEach((have, i) => {
    const rolesLeft = shape.roleCount - i;
    const fairShare = Math.ceil(remaining / rolesLeft) + (i === 0 ? 1 : 0);
    const cap = Math.max(2, Math.min(have, fairShare, remaining - (rolesLeft - 1) * 2));
    caps.push(cap);
    remaining -= cap;
  });
  return caps;
}

// The experience budget for THIS master CV, or null when the CV can't be
// parsed (the caller then uses the fixed LENGTH_BUDGET default). `style`
// with a total (CareerSet): the total across experience and projects, the
// word cap per bullet and the document's word cap replace the page's own
// capacity; otherwise the text is exactly UKJI's.
export function experienceBudget(cvText: string, style?: BulletBudgetStyle | null, projectCount = 0): string | null {
  const shape = parseExperienceShape(cvText);
  if (!shape) return null;

  if (style?.total) {
    const capacity = styledExperienceCapacity(style, projectCount);
    const per = plannedPerProject(projectCount, style);
    const head = `LENGTH BUDGET — this style keeps the whole CV to ${style.total.min}-${style.total.max} bullets ACROSS experience and projects, each at most ${style.maxWords ?? 30} words and two printed lines, the document under ${style.cvMaxWords ?? 900} words and two A4 pages. This master CV has ${shape.totalBullets} experience bullets across ${shape.roleCount} role(s); with ${projectCount} project(s) at up to ${per} bullets each, keep at most ${capacity} experience bullets`;
    if (shape.totalBullets <= capacity) {
      return `${head} — every bullet from every role fits:
- Keep EVERY bullet from EVERY role; tailor by REORDERING bullets within each role so the most JD-relevant come first, and by the two-word swaps the protocol allows.
${SHARED_RULES}`;
    }
    const perRole = perRoleCaps(shape, capacity)
      .map((c, i) => `- Role ${i + 1} (in master-CV order): at most ${c} bullets.`)
      .join("\n");
    return `${head}:
${perRole}
- Keep the bullets with the strongest evidence for THIS job (a figure, a scale, a named system); drop the rest entirely, oldest roles first.
${SHARED_RULES}`;
  }

  if (shape.totalBullets <= EXPERIENCE_BULLET_CAPACITY) {
    return `LENGTH BUDGET — the finished CV must fit on TWO A4 pages, and this master CV is compact enough that EVERY experience bullet fits:
- Keep EVERY bullet from EVERY role — this CV has ${shape.totalBullets} experience bullets across ${shape.roleCount} role(s), and two pages hold them all. Do not drop content to "tailor" it; tailor by REORDERING bullets within each role so the most JD-relevant come first, and by rephrasing.
${SHARED_RULES}`;
  }

  // Over capacity: distribute the two-page allowance across roles in
  // master-CV order (most recent first by convention), never below 2 bullets
  // for a role and never above what the role actually has.
  const perRole = perRoleCaps(shape, EXPERIENCE_BULLET_CAPACITY)
    .map((c, i) => `- Role ${i + 1} (in master-CV order): at most ${c} bullets.`)
    .join("\n");
  return `LENGTH BUDGET — the finished CV must fit on TWO A4 pages; this master CV has more experience bullets (${shape.totalBullets}) than two pages hold, so trim to these caps:
${perRole}
- If it still runs long, DROP the least JD-relevant bullets entirely, oldest roles first.
${SHARED_RULES}`;
}

// The model mirrors the master CV's formatting: a master whose bullet glyphs
// were lost in PDF extraction (see parseExperienceShape above) comes back
// with plain achievement lines, which every renderer then faithfully draws
// WITHOUT bullet points — a real download shipped that way. Deterministic
// repair at the pipeline boundary: EVERY content line under a role header
// gets a bullet marker, the highlight included (it becomes the role's first
// bullet). A "plain highlight slot" was tried and withdrawn: with a
// bullet-less source there is no way to tell a role's highlight from its
// first achievement, and a role WITHOUT a highlight had its first real
// bullet misrendered as a plain line. Already-bulleted output passes
// through unchanged.
export function normalizeExperienceOutput(text: string): string {
  if (!text) return text;
  let seenHeader = false;
  return text
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      const isBullet = /^[•\-*]\s/.test(line);
      const isHeader = !isBullet && line.includes("|") && ROLE_HEADER.test(line);
      if (isHeader) {
        seenHeader = true;
        return raw;
      }
      if (!seenHeader || isBullet) return raw;
      return `• ${line}`;
    })
    .join("\n");
}

// One page (the user's opt-in, Preferences.onePageCv): the most recent role
// keeps up to 4 bullets, every earlier role 3, never below 2. lib/onePage
// then trims the finished text to what one page holds.
export function onePageExperienceBudget(cvText: string): string {
  const shape = parseExperienceShape(cvText);
  const caps = shape ? shape.bulletsPerRole.map((have, i) => Math.max(2, Math.min(have, i === 0 ? 4 : 3))) : [];
  const perRole = caps.length
    ? caps.map((c, i) => `- Role ${i + 1} (in master-CV order): at most ${c} bullets.`).join("\n")
    : "- At most 4 bullets for the most recent role and 3 for each earlier role.";
  return `LENGTH BUDGET — the candidate asked for a one-page CV, so the finished CV must fit on ONE A4 page:
${perRole}
- Keep the bullets with the strongest evidence for THIS job (a figure, a scale, a named system); drop the rest entirely, oldest roles first.
${SHARED_RULES}`;
}

// Per-project bullet allowance scaled by how many projects there are.
// `style` with a total (CareerSet): 2 to 4 per project, at most 30 words each,
// inside the style's total; otherwise the text is exactly UKJI's.
export function projectsBudget(projectCount: number, onePage = false, style?: BulletBudgetStyle | null): string {
  if (style?.total && !onePage) {
    const per = plannedPerProject(projectCount, style);
    return `LENGTH BUDGET — this style keeps the whole CV to ${style.total.min}-${style.total.max} bullets across experience and projects, and projects sit after experience. This CV has ${projectCount} project(s): write ${style.perProject.min} to ${per} bullets per project (fewer only when the master CV has fewer for that project), each at most ${style.maxWords ?? 30} words and never more than two printed lines — use the project's REAL bullets from the master CV as the base (rephrased and reordered for this JD), never pad with invented ones. Trim by dropping a whole bullet, never by merging two achievements or combining their metrics into one sentence.`;
  }
  if (onePage) {
    return `LENGTH BUDGET — the candidate asked for a one-page CV, so the finished CV must fit on ONE A4 page, and projects sit after experience. This CV has ${projectCount} project(s): write at most 2 bullets per project (1 is fine) — use the project's REAL bullets from the master CV as the base (rephrased and reordered for this JD), never pad with invented ones. Keep each bullet to a single printed line. Trim by dropping a whole bullet, never by merging two achievements or combining their metrics into one sentence.`;
  }
  const per = projectCount <= 2 ? 4 : projectCount <= 4 ? 3 : 2;
  return `LENGTH BUDGET — the finished CV must fit on TWO A4 pages, and projects sit after experience, so they are what pushes it over. This CV has ${projectCount} project(s): write up to ${per} bullets per project — use the project's REAL bullets from the master CV as the base (rephrased and reordered for this JD), never pad with invented ones, and fewer is fine when the master CV has fewer. Keep each bullet to a single printed line where possible and never more than two. Trim by dropping a whole bullet, never by merging two achievements or combining their metrics into one sentence.`;
}
