// Where a space belongs between two text runs the PDF laid side by side. A
// PDF often omits the space glyph between separately positioned runs, and
// unpdf hands them back as fragments: the parser (lib/parseCv) inserts a
// space when the gap is wide. A narrower gap still hides a missing space
// when a word ends and another begins across the seam ("REST APIs" then
// "LlamaIndex" read "REST APIsLlamaIndex" on 30 Sep). Kerned letters of one
// word never straddle runs with a lowercase-to-uppercase seam AND a positive
// gap, so that seam is the tell. Import-free (tests/).

export const WIDE_GAP_EM = 0.2;
export const SEAM_GAP_EM = 0.03;

// A word ended and a new one begins: lowercase or a closing bracket, then a
// capital followed by a lowercase letter ("APIs|Llama", "Python)|Django").
const SEAM_RE = /(?:[a-z)]|\d)$/;
const NEXT_WORD_RE = /^[A-Z][a-z]/;

export function needsSpace(prev: string, next: string, gapEm: number): boolean {
  if (!prev || !next) return false;
  if (/\s$/.test(prev) || /^\s/.test(next)) return false;
  if (gapEm > WIDE_GAP_EM) return true;
  return gapEm > SEAM_GAP_EM && SEAM_RE.test(prev) && NEXT_WORD_RE.test(next);
}

// The same seam inside ONE stored token: a plural word glued to the next
// ("APIsLlamaIndex" → "APIs", "LlamaIndex"). Only a plural-s seam counts —
// "PostgreSQL", "JavaScript", "OpenTelemetry" have internal capitals with no
// s before them and stay whole.
// The left part must be four letters or more: "OpsGenie" and "AwsSdk" are
// one name each (review, 1 Oct).
const GLUED_RE = /^(.*?[A-Za-z]s)([A-Z][a-z].*)$/;
export function unglue(token: string): string[] {
  const m = GLUED_RE.exec(token);
  if (!m || m[1].length < 4 || m[2].length < 3) return [token];
  return [m[1], ...unglue(m[2])];
}
