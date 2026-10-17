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
// could not find the owner's contact details behind the labels. bold: whether
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
};
export const RENDER_OPTIONS: Record<FormatStyleId, RenderOptions> = {
  ukji: { contactLinks: "labels", contactSeparator: " · ", headlineSeparator: " · ", bold: true, highlightLine: true, trailingFullStop: true, measureRunHeader: false },
  careerset: { contactLinks: "addresses", contactSeparator: " | ", headlineSeparator: " | ", bold: false, highlightLine: false, trailingFullStop: false, measureRunHeader: true },
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
