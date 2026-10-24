// The format styles' identities and the small, import-free facts every side
// of the app needs: the ids and their labels, how each style DRAWS the
// document (the contact line, bold, the separators — read by lib/cvDocument,
// CvPreview and the two builders) and the SHAPE of its skills block (read by
// lib/skillsLines and every parser of the Technical Tools line). The prompt
// blocks, limits, lint rules and letter furniture live in ./index.ts, which
// only the server imports: a page must never pull the prompts into the client
// bundle.
//
// UKJI is the shape the app has always produced. CareerSet (16 Oct 2026) is
// the shape the owner scored by hand in their university's CV tool: printed
// contact addresses, a " | " headline, grouped tool lines, no bold and no
// trailing full stop on a bullet. Import-free, so it runs anywhere.

export type FormatStyleId = "ukji" | "careerset";
export const FORMAT_STYLE_IDS: readonly FormatStyleId[] = ["ukji", "careerset"];
export const DEFAULT_FORMAT_STYLE: FormatStyleId = "ukji";
export const FORMAT_STYLE_LABELS: Record<FormatStyleId, string> = { ukji: "UKJI", careerset: "CareerSet" };

export function isFormatStyleId(v: unknown): v is FormatStyleId {
  return v === "ukji" || v === "careerset";
}
// Anything that is not exactly "careerset" is UKJI: a missing key, an old
// stored value, a typo, a non-string.
export function normalizeFormatStyle(v: unknown): FormatStyleId {
  return v === "careerset" ? "careerset" : "ukji";
}

// A tracker row's tag: the style stored with it, else "unknown" — a row added
// by hand without a pick, or one saved before styles existed ("Not recorded";
// decided 17 Oct 2026: never read as UKJI, so the insights compare only the
// weeks both styles ran).
export type RowStyle = FormatStyleId | "unknown";
export function rowStyle(v: unknown): RowStyle {
  return isFormatStyleId(v) ? v : "unknown";
}
export const ROW_STYLE_LABELS: Record<RowStyle, string> = { ukji: "UKJI", careerset: "CareerSet", unknown: "Not recorded" };

// How the document is drawn. contactLinks: "labels" prints LinkedIn / GitHub
// / Portfolio with the address behind the link; "addresses" prints the
// address itself (linkedin.com/in/…), still hyperlinked — CareerSet's parser
// could not find the owner's contact details behind the labels. Both styles
// print addresses since 24 Oct 2026: a parser that keeps only a CV's text
// loses every address behind a label (the same loss put "Gmail" in the
// header, lib/contactCheck), and tests/cvRoundTrip holds the text. bold: whether
// a bullet may carry ** spans. highlightLine: whether a role's "Highlight:"
// line is kept as such. trailingFullStop: whether a bullet keeps its final
// full stop. measureRunHeader: whether the real page count is measured with
// the run's own headline (CareerSet's longer header and printed addresses can
// wrap; UKJI keeps today's measurement, see lib/onePage).
export type RenderOptions = {
  contactLinks: "labels" | "addresses";
  contactSeparator: string;
  headlineSeparator: string;
  bold: boolean;
  highlightLine: boolean;
  trailingFullStop: boolean;
  measureRunHeader: boolean;
  // The headline's slots (lib/headline): UKJI "qualification · skill · years ·
  // positioning"; CareerSet "positioning | years | tools".
  headlineShape: "ukji" | "careerset";
};
export const RENDER_OPTIONS: Record<FormatStyleId, RenderOptions> = {
  ukji: { contactLinks: "addresses", contactSeparator: " · ", headlineSeparator: " · ", bold: true, highlightLine: true, trailingFullStop: true, measureRunHeader: false, headlineShape: "ukji" },
  careerset: { contactLinks: "addresses", contactSeparator: " | ", headlineSeparator: " | ", bold: false, highlightLine: false, trailingFullStop: false, measureRunHeader: true, headlineShape: "careerset" },
};

// The skills block's shape. UKJI: one "Technical Tools:" line, items split
// on " | ". CareerSet: a label-only "Technical Tools:" line followed by one
// "Group: items" line per group in this fixed order, items split on ", "
// outside brackets as well as on " | " ("AWS (Lambda, SQS)" stays one item).
export type SkillsShape = { grouped: boolean; groups: readonly string[]; commaItems: boolean };
export const CAREERSET_TOOL_GROUPS = ["Languages & Frameworks", "Databases", "AI & LLM", "Cloud & DevOps", "Testing", "Other"] as const;
export const SKILLS_SHAPE: Record<FormatStyleId, SkillsShape> = {
  ukji: { grouped: false, groups: [], commaItems: false },
  careerset: { grouped: true, groups: CAREERSET_TOOL_GROUPS, commaItems: true },
};
export const FLAT_SKILLS: SkillsShape = SKILLS_SHAPE.ukji;

// ── The rules, as data ───────────────────────────────────────────────────────
// Everything a style decides that is not a prompt: limits, the skills shape,
// the lint rules, the renderer options, the letter's furniture. Import-free,
// so the page can run the style's format check on the edited preview
// (lib/styleCheck) and the tracker can draw a stored row. The server's
// FormatStyle (./index.ts) is these rules plus the prompt blocks.
//
// UKJI's numbers are the values that have always lived in lib/formatRules,
// lib/claims, lib/bulletShape and lib/onePage, written here as literals
// because this module imports nothing; tests/formatStyles.test.ts holds them
// equal to those exports, so a drift fails the suite.

export type StyleLimits = {
  summary: { maxSentences: number; maxWords: number };
  competencies: { max: number };
  tools: { max: number; leadSlots: number };
  bullets: {
    maxWords: number | null;
    maxLines: number;
    // Across experience AND projects; null = no total cap (the page fit decides).
    total: { min: number; max: number } | null;
    perProject: { min: number; max: number };
  };
  cv: { maxWords: number | null };
  letter: { minWords: number; maxWords: number };
};
export type StyleLint = {
  // Words a bullet may not carry (whole words / phrases, case-insensitive).
  bannedWords: readonly string[];
  // A banned word → the plain words it may become, in order of preference,
  // "" meaning "drop the word". A banned word with no entry is only ever
  // reported: no automatic swap may claim more than the master CV.
  equivalences: Readonly<Record<string, readonly string[]>>;
  // How many bullets across the CV may open with the same verb; null = no cap.
  verbCap: number | null;
  letterBanned: readonly string[];
};
export type StyleLetter = {
  // Sentences the fact check never judges (the style's fixed lines).
  furniture: readonly RegExp[];
  interestOpening: string | null;
  fixedLine: string | null;
  thanksLine: string;
  points: number;
  // "Dear <Company> team," (UKJI) vs "Dear <Company> Hiring Team," (CareerSet).
  teamSuffix: string;
  // Where the right-to-work statement goes: its own paragraph above the
  // sign-off, or the start of the close paragraph (the one with the thanks).
  statementPlacement: "own_paragraph" | "close_paragraph";
  // Remove a bare "N." line a removal left behind and renumber the points.
  renumberPoints: boolean;
  // The prompt gets the evidence map's eligible requirements for its points
  // (lib/letterStyle eligiblePointsBlock).
  pointsFromEvidence: boolean;
  // The page fit never trims the fixed lines or the close paragraph.
  protectFurnitureInFit: boolean;
};
export type StyleRules = {
  id: FormatStyleId;
  label: string;
  limits: StyleLimits;
  skills: SkillsShape;
  lint: StyleLint;
  render: RenderOptions;
  summary: {
    // Append the Eligibility availability sentence (CV voice) as the last
    // sentence, when the answer is given.
    appendAvailability: boolean;
  };
  letter: StyleLetter;
  // Whether the style has its own deterministic format check (lib/styleCheck).
  check: boolean;
};

export const CAREERSET_BANNED_WORDS = ["contributed", "supported", "assisted", "helped", "worked on", "work in", "responsible for", "successfully", "used"] as const;
// The only automatic swaps. "applied" says no more than "used"; dropping
// "successfully" removes a grade, never a fact; "owned" is what "responsible
// for" states. "supported", "assisted", "contributed", "helped", "worked on"
// and "work in" have no plain equivalent that claims the same — a stronger
// verb would be the overclaim ABSOLUTE_RULES 10 forbids — so such a bullet is
// reported (the "Your master CV" notice) and left as the master CV wrote it.
export const CAREERSET_EQUIVALENCES: Readonly<Record<string, readonly string[]>> = {
  used: ["applied", "implemented"],
  successfully: [""],
  "responsible for": ["owned"],
};
export const CAREERSET_LETTER_BANNED = ["used", "assisted", "contribute", "contributed", "also", "kind of"] as const;
export const CAREERSET_FIXED_LINE = "Having read the job description, these are the four areas where I can add value from the start:";
export const CAREERSET_INTEREST_OPENING = "I am particularly interested in this role because";
export const CAREERSET_THANKS = "Thank you for considering my application.";

export const STYLE_RULES: Record<FormatStyleId, StyleRules> = {
  ukji: {
    id: "ukji",
    label: "UKJI",
    limits: {
      summary: { maxSentences: 3, maxWords: 85 },
      competencies: { max: 6 },
      tools: { max: 15, leadSlots: 8 },
      // No word cap and no total cap: lib/contentBudget and lib/onePage decide
      // by the page; projects 4/3/2 per project by count, floor one.
      bullets: { maxWords: null, maxLines: 2, total: null, perProject: { min: 1, max: 4 } },
      cv: { maxWords: null },
      // The letter prompt asks for "230 to 330 words".
      letter: { minWords: 230, maxWords: 330 },
    },
    skills: SKILLS_SHAPE.ukji,
    lint: { bannedWords: [], equivalences: {}, verbCap: null, letterBanned: [] },
    render: RENDER_OPTIONS.ukji,
    summary: { appendAvailability: false },
    letter: {
      furniture: [],
      interestOpening: null,
      fixedLine: "I have read the job description and feel that I'm a great fit due to the following reasons:",
      thanksLine: "Thank you",
      points: 3,
      teamSuffix: "team",
      statementPlacement: "own_paragraph",
      renumberPoints: false,
      pointsFromEvidence: false,
      protectFurnitureInFit: false,
    },
    check: false,
  },
  careerset: {
    id: "careerset",
    label: "CareerSet",
    limits: {
      // The model writes 3-4 sentences (65-90 words); the app appends the
      // availability sentence; the cap leaves room for both.
      summary: { maxSentences: 5, maxWords: 95 },
      competencies: { max: 12 },
      tools: { max: 30, leadSlots: 8 },
      bullets: { maxWords: 30, maxLines: 2, total: { min: 12, max: 20 }, perProject: { min: 2, max: 4 } },
      cv: { maxWords: 900 },
      letter: { minWords: 300, maxWords: 420 },
    },
    skills: SKILLS_SHAPE.careerset,
    lint: { bannedWords: CAREERSET_BANNED_WORDS, equivalences: CAREERSET_EQUIVALENCES, verbCap: 2, letterBanned: CAREERSET_LETTER_BANNED },
    render: RENDER_OPTIONS.careerset,
    summary: { appendAvailability: true },
    letter: {
      furniture: [/^Having read the job description, these are the four areas where I can add value from the start:?$/i, /^I am particularly interested in this role because\b/i],
      interestOpening: CAREERSET_INTEREST_OPENING,
      fixedLine: CAREERSET_FIXED_LINE,
      thanksLine: CAREERSET_THANKS,
      points: 4,
      teamSuffix: "Hiring Team",
      statementPlacement: "close_paragraph",
      renumberPoints: true,
      pointsFromEvidence: true,
      protectFurnitureInFit: true,
    },
    check: true,
  },
};
