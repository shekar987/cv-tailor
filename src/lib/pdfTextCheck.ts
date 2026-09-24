// The PDF text-layer check the download routes run before sending a file.
//
// An earlier PDF pipeline rasterised the document into a JPEG: it looked
// right on screen and carried no text at all, and every ATS that parsed it
// saw nothing (see CLAUDE.md, "PDF must have a real text layer"). The
// generators were rewritten to draw real text, but nothing verified the
// output on every download. Now each PDF route extracts the text back out of
// the bytes it just built (unpdf, the same parser the upload path uses) and
// refuses to send the file when the extraction does not carry the document:
// the candidate's name and email when the profile supplied them, and enough
// words — at least MIN_WORDS, or 80% of the source text for a short document.
//
// Import-free: the rules are unit-tested; the routes supply the extraction.

export const MIN_WORDS = 150;

export type PdfTextExpectation = {
  name?: string;
  email?: string;
  // Words in the text the PDF was built from, so a genuinely short document
  // (a two-line cover letter in testing) is judged against itself.
  sourceWords: number;
};

export type PdfTextCheck = { ok: boolean; words: number; problems: string[] };

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Extraction folds spacing and may break a line anywhere; compare on a
// whitespace-free, case-folded form so "Test  Candidate" still matches.
function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

// The text layer as a parser sees it: unpdf (already the upload parser's
// engine), all pages merged. Dynamic import so this module stays import-free
// at load for the unit tests.
export async function extractPdfText(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js transfers the buffer it is given to its worker and leaves the
  // caller's array detached, so it reads a copy: the route still has to send
  // the original bytes after the check.
  // (.slice() copies; new Uint8Array(arrayBuffer) alone would only be a view.)
  const doc = await getDocumentProxy(new Uint8Array(bytes).slice());
  const out = await extractText(doc, { mergePages: true });
  return out.text;
}

export function checkPdfTextLayer(extracted: string, expect: PdfTextExpectation): PdfTextCheck {
  const problems: string[] = [];
  const words = countWords(extracted);
  const required = Math.min(MIN_WORDS, Math.floor(expect.sourceWords * 0.8));
  if (words < required) problems.push(`only ${words} words extracted (needed ${required})`);
  const hay = squash(extracted);
  const name = (expect.name ?? "").trim();
  if (name && !hay.includes(squash(name))) problems.push("the candidate's name is missing from the text layer");
  const email = (expect.email ?? "").trim();
  if (email && !hay.includes(squash(email))) problems.push("the email address is missing from the text layer");
  return { ok: problems.length === 0, words, problems };
}
