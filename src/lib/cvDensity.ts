// Adaptive layout density for the generated CV.
//
// The CV targets TWO A4 pages, and should FILL them without looking crammed.
// Those two goals pull against each other, so the layout is not fixed: we
// estimate how much content this particular CV has, then pick the roomiest
// spacing that still fits in two pages. A short CV gets generous margins and
// breathing room; only a long one gets tightened.
//
// Content volume is controlled separately by LENGTH_BUDGET in prompts/steps.ts —
// that decides how many bullets exist, this decides how much air sits between
// them. Change one and re-check the other.
//
// Kept free of Next/docx imports so it stays directly testable.
//
// All values are twips (1/20 pt); 1440 twips = 1 inch.

export type Density = {
  name: string;
  margin: number;
  sectionBefore: number;
  sectionAfter: number;
  jobBefore: number;
  bulletAfter: number;
  tightAfter: number;
};

// Roomiest first — we take the first one that fits two pages.
export const DENSITIES: Density[] = [
  { name: "roomy",  margin: 1080, sectionBefore: 240, sectionAfter: 100, jobBefore: 170, bulletAfter: 100, tightAfter: 40 },
  { name: "normal", margin: 900,  sectionBefore: 200, sectionAfter: 80,  jobBefore: 135, bulletAfter: 70,  tightAfter: 30 },
  { name: "snug",   margin: 810,  sectionBefore: 175, sectionAfter: 70,  jobBefore: 115, bulletAfter: 55,  tightAfter: 25 },
  { name: "tight",  margin: 720,  sectionBefore: 160, sectionAfter: 60,  jobBefore: 100, bulletAfter: 40,  tightAfter: 20 },
];

export const PAGE_HEIGHT = 16838; // A4 height in twips
const BODY_LINE = 250;            // rendered height of one 10.5pt line
const HEADING_LINE = 290;         // section headings are 12pt + a rule
const CHARS_PER_LINE = 95;        // ~10.5pt Calibri across the usable measure
const TARGET_PAGES = 2;

// A short CV should still look like a short CV, not a normal one with absurd
// gaps stretched through it, so the fill-out expansion is capped.
const MAX_BULLET_AFTER = 150;

// estimatedHeight approximates Word's line breaking from character counts, so it
// carries a few percent of error. Spending every last twip of the slack would
// let that error push a two-page CV onto a third page — the one outcome this is
// all meant to prevent. Spend most of it and keep the rest as headroom.
const SLACK_USE = 0.7;

export type ContentSize = { lines: number; paragraphs: number; headings: number };

// How many rendered lines a block of text occupies once it wraps.
export function wrappedLines(text: string, charsPerLine = CHARS_PER_LINE): number {
  if (!text) return 0;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

export function estimatedHeight(size: ContentSize, d: Density): number {
  return (
    size.lines * BODY_LINE +
    size.paragraphs * d.bulletAfter +
    size.headings * (HEADING_LINE + d.sectionBefore + d.sectionAfter)
  );
}

export function capacity(d: Density): number {
  return TARGET_PAGES * (PAGE_HEIGHT - 2 * d.margin);
}

// Pick the roomiest density that still fits two pages, then spend any leftover
// space on extra breathing room between paragraphs so the content reaches the
// bottom of page two instead of stopping halfway down it.
export function chooseDensity(size: ContentSize): Density {
  const fitting = DENSITIES.find((d) => estimatedHeight(size, d) <= capacity(d));
  // Nothing fits: the content is over budget even at the tightest setting. Use
  // the tightest and let it run long rather than silently dropping anything —
  // the user can trim in the editable preview.
  const base = fitting ?? DENSITIES[DENSITIES.length - 1];
  if (!fitting || size.paragraphs === 0) return base;

  const slack = capacity(base) - estimatedHeight(size, base);
  if (slack <= 0) return base;

  const extraPerParagraph = Math.floor((slack * SLACK_USE) / size.paragraphs);
  return {
    ...base,
    bulletAfter: Math.min(MAX_BULLET_AFTER, base.bulletAfter + extraPerParagraph),
  };
}
