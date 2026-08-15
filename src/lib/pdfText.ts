// Shared text-layout primitives for the server-side PDF generators
// (buildCvPdf.ts, buildCoverLetterPdf.ts). jsPDF has no built-in way to wrap
// a line that mixes bold/plain/link runs, so this provides that.
//
// This exists because the PREVIOUS PDF pipeline (src/lib/docxToPdf.ts,
// removed) rendered the document to a <canvas> and dropped a JPEG into the
// PDF — no text layer at all, invisible to every ATS. Every helper here
// draws real jsPDF text (doc.text(...)), which is real, selectable,
// extractable text in the output file.

import type { jsPDF } from "jspdf";
import fs from "node:fs";
import path from "node:path";

export type Word = { text: string; bold?: boolean; link?: string; glued?: boolean };

// Mirrors buildRuns() in api/download/route.ts: splits on whitespace first
// (so **bold** only ever bolds a single word, matching the Word output
// exactly), detects bare URLs as links, and marks a word `glued` when it had
// no whitespace before it in the source (e.g. "**bold**text" with no space)
// so the layout engine doesn't insert a false space there.
export function parseWords(text: string, baseBold = false): Word[] {
  const tokens = text.split(/(\s+)/);
  const words: Word[] = [];
  let glueNext = false;

  for (const token of tokens) {
    if (token === "") continue;
    if (/^\s+$/.test(token)) {
      glueNext = false;
      continue;
    }

    const looksLikeUrl =
      /^https?:\/\//i.test(token) ||
      /^[a-z0-9-]+\.(vercel\.app|com|io|dev|org|net)(\/\S*)?$/i.test(token);

    if (looksLikeUrl) {
      const href = token.startsWith("http") ? token : "https://" + token;
      words.push({ text: token, bold: baseBold, link: href, glued: glueNext });
      glueNext = true;
      continue;
    }

    const boldParts = token.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    for (const part of boldParts) {
      const isBold = part.startsWith("**") && part.endsWith("**");
      words.push({
        text: isBold ? part.slice(2, -2) : part,
        bold: isBold || baseBold,
        glued: glueNext,
      });
      glueNext = true;
    }
  }
  return words;
}

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Tracks the vertical write position and hands out page breaks. `ensureRoom`
// is the pagination primitive every drawing helper below goes through — a
// block never starts if it can't fit, so a page never breaks mid-line.
export class PdfCursor {
  y: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginTop: number;
  readonly marginBottom: number;

  constructor(
    private doc: jsPDF,
    margins: { top: number; right: number; bottom: number; left: number }
  ) {
    this.pageWidth = doc.internal.pageSize.getWidth();
    this.pageHeight = doc.internal.pageSize.getHeight();
    this.marginTop = margins.top;
    this.marginRight = margins.right;
    this.marginBottom = margins.bottom;
    this.marginLeft = margins.left;
    this.y = margins.top;
  }

  get contentWidth(): number {
    return this.pageWidth - this.marginLeft - this.marginRight;
  }

  // Starts a new page if `height` wouldn't fit before the bottom margin.
  ensureRoom(height: number): void {
    if (this.y + height > this.pageHeight - this.marginBottom) {
      this.doc.addPage();
      this.y = this.marginTop;
    }
  }

  advance(height: number): void {
    this.y += height;
  }
}

// jsPDF's built-in "helvetica" is one of the 14 standard PDF fonts — WinAnsi
// encoded, so it silently drops or mangles anything outside Latin-1 (a name
// in Cyrillic, Greek, or CJK script would render as garbage, not an error).
// Noto Sans is embedded instead so real names in those scripts render
// correctly. It does NOT cover CJK or Arabic (separate Noto font families,
// and Arabic also needs contextual glyph shaping that jsPDF's plain
// doc.text() doesn't perform) — characters in those scripts are dropped
// rather than garbled, a known, documented remaining gap.
export const FONT = "NotoSans";

const FONTS_DIR = path.join(process.cwd(), "src", "lib", "fonts");
const FONT_REGULAR_B64 = fs.readFileSync(path.join(FONTS_DIR, "NotoSans-Regular.ttf")).toString("base64");
const FONT_BOLD_B64 = fs.readFileSync(path.join(FONTS_DIR, "NotoSans-Bold.ttf")).toString("base64");

// jsPDF's font registry lives on the document instance, not globally — call
// this once on every new jsPDF(), before any setFont/text call.
export function registerFonts(doc: jsPDF): void {
  doc.addFileToVFS("NotoSans-Regular.ttf", FONT_REGULAR_B64);
  doc.addFont("NotoSans-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", FONT_BOLD_B64);
  doc.addFont("NotoSans-Bold.ttf", FONT, "bold");
}

type DrawOpts = {
  color?: Rgb;
  linkColor?: Rgb;
  align?: "left" | "right" | "center" | "justify";
};

// A word wider than the available line width on its own (a long URL, a long
// unbroken token) would otherwise just be drawn past the right margin — the
// packing loop below only breaks BETWEEN words, never within one. This
// forces such a word into smaller glued fragments that each fit, as a last
// resort — normal words with natural spaces never reach this path.
function splitOversizedWord(doc: jsPDF, w: Word, size: number, maxWidth: number): Word[] {
  doc.setFont(FONT, w.bold ? "bold" : "normal");
  doc.setFontSize(size);
  if (w.text.length <= 1 || doc.getTextWidth(w.text) <= maxWidth) return [w];

  const chunks: Word[] = [];
  let current = "";
  let isFirstChunk = true;
  for (const ch of w.text) {
    const candidate = current + ch;
    if (current !== "" && doc.getTextWidth(candidate) > maxWidth) {
      chunks.push({ text: current, bold: w.bold, link: w.link, glued: isFirstChunk ? w.glued : true });
      isFirstChunk = false;
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push({ text: current, bold: w.bold, link: w.link, glued: isFirstChunk ? w.glued : true });
  return chunks;
}

// Packs `words` into lines no wider than `cursor.contentWidth`, drawing each
// line at the left margin (or a custom `x`/`maxWidth`) and advancing the
// cursor. Any word with a `link` is drawn in link color, underlined, and
// registered as a real clickable PDF link annotation via doc.link(...) —
// the actual API this project already used (previously only to fake
// clickability over a flat image; now used for its real purpose).
export function drawWrapped(
  doc: jsPDF,
  cursor: PdfCursor,
  rawWords: Word[],
  size: number,
  lineHeight: number,
  opts: DrawOpts = {},
  x = cursor.marginLeft,
  maxWidth = cursor.contentWidth
): void {
  if (rawWords.length === 0) return;
  const color = opts.color ?? [0, 0, 0];
  const linkColor = opts.linkColor ?? [5, 99, 193]; // #0563C1

  doc.setFont(FONT, "normal");
  doc.setFontSize(size);
  const spaceWidth = doc.getTextWidth(" ");

  const words = rawWords.flatMap((w) => splitOversizedWord(doc, w, size, maxWidth));

  function widthOf(w: Word): number {
    doc.setFont(FONT, w.bold ? "bold" : "normal");
    doc.setFontSize(size);
    return doc.getTextWidth(w.text);
  }

  const lines: Word[][] = [];
  let line: Word[] = [];
  let lineWidth = 0;

  for (const w of words) {
    const gap = line.length > 0 && !w.glued ? spaceWidth : 0;
    const wWidth = widthOf(w);
    if (line.length > 0 && lineWidth + gap + wWidth > maxWidth) {
      lines.push(line);
      line = [w];
      lineWidth = wWidth;
    } else {
      line.push(w);
      lineWidth += gap + wWidth;
    }
  }
  if (line.length > 0) lines.push(line);

  lines.forEach((ln, lineIndex) => {
    cursor.ensureRoom(lineHeight);
    const isLastLine = lineIndex === lines.length - 1;
    const gapCount = ln.reduce((n, w, i) => (i > 0 && !w.glued ? n + 1 : n), 0);

    // Total width of this line (using the normal fixed space width), for
    // right/center alignment and as the fallback when a line can't be
    // justified (its own paragraph's last line, or a single word with no
    // gap to stretch).
    let total = 0;
    ln.forEach((w, i) => {
      if (i > 0 && !w.glued) total += spaceWidth;
      total += widthOf(w);
    });

    // Justify: distribute the line's slack evenly across its inter-word
    // gaps instead of drawing it with the fixed space width, so the right
    // edge lands flush against maxWidth — matching the on-screen preview
    // and the Word download, which both justify this same text. A
    // paragraph's last line stays ragged (standard convention, and what
    // Word's own AlignmentType.JUSTIFIED does too); a line with no
    // stretchable gap (one word alone) can't be justified and falls back
    // to left-aligned.
    const justify = opts.align === "justify" && !isLastLine && gapCount > 0;
    const gapWidth = justify ? spaceWidth + (maxWidth - total) / gapCount : spaceWidth;

    let cx = x;
    if (opts.align === "right") cx = x + maxWidth - total;
    else if (opts.align === "center") cx = x + (maxWidth - total) / 2;

    ln.forEach((w, i) => {
      if (i > 0 && !w.glued) cx += gapWidth;
      doc.setFont(FONT, w.bold ? "bold" : "normal");
      doc.setFontSize(size);
      const [r, g, b] = w.link ? linkColor : color;
      doc.setTextColor(r, g, b);
      doc.text(w.text, cx, cursor.y);
      const wWidth = widthOf(w);
      if (w.link) {
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(0.5);
        doc.line(cx, cursor.y + 1.5, cx + wWidth, cursor.y + 1.5);
        // Link boxes are in the coordinate system's own units (pt here);
        // roughly the ascent/descent of the text so the clickable zone
        // matches what's visually drawn.
        doc.link(cx, cursor.y - size * 0.8, wWidth, size, { url: w.link });
      }
      cx += wWidth;
    });
    doc.setTextColor(0, 0, 0);
    cursor.advance(lineHeight);
  });
}

// A single-style line (no bold/link mixing needed) — contact info, plain
// centered text, etc. Thin wrapper around drawWrapped for the common case.
export function drawLine(
  doc: jsPDF,
  cursor: PdfCursor,
  text: string,
  size: number,
  lineHeight: number,
  opts: DrawOpts & { bold?: boolean } = {}
): void {
  drawWrapped(doc, cursor, [{ text, bold: opts.bold }], size, lineHeight, opts);
}

// Bold left text (role, project title, or degree) with a date right-aligned
// on the same line — the ONE mechanism used for Experience, Projects, and
// Education alike, so all three align in the same column down the page.
//
// If both pieces fit on one line, renders exactly as a single line (left
// text, date flush right) — the common case. If the left text is too long
// to share the line with the date, it wraps across multiple lines at full
// width via drawWrapped (so it can never run past the page edge, unlike a
// single unwrapped doc.text() call), and the date drops to its own
// right-aligned line immediately after.
export function drawHeaderLine(
  doc: jsPDF,
  cursor: PdfCursor,
  leftText: string,
  rightText: string,
  size: number,
  lineHeight: number,
  opts: { rightColor?: Rgb; rightBold?: boolean; rightSize?: number } = {}
): void {
  const rightSize = opts.rightSize ?? size;
  const rightColor = opts.rightColor ?? [0, 0, 0];
  const rightBold = opts.rightBold ?? true;

  doc.setFont(FONT, "bold");
  doc.setFontSize(size);
  const leftWidth = doc.getTextWidth(leftText);
  doc.setFont(FONT, rightBold ? "bold" : "normal");
  doc.setFontSize(rightSize);
  const rightWidth = rightText ? doc.getTextWidth(rightText) : 0;
  const gap = rightText ? 8 : 0;

  // Whether leftText alone (plus any date) actually fits is the ONLY thing
  // that decides the branch below — deliberately not short-circuited by
  // "no date" the way this used to read (`!rightText || ...`). That
  // shortcut meant any title without a date — e.g. splitTrailingDate()
  // finding no trailing date to extract, which happens for any title that
  // doesn't match its expected suffix format — always took the single-line
  // path below and got drawn via one raw, unwrapped doc.text() call with no
  // length limit at all, straight off the page edge for a long title. This
  // must stay correct for arbitrary user data, not just titles a test
  // happens to cover.
  const fitsOneLine = leftWidth + gap + rightWidth <= cursor.contentWidth;

  if (fitsOneLine) {
    cursor.ensureRoom(lineHeight);
    doc.setFont(FONT, "bold");
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
    doc.text(leftText, cursor.marginLeft, cursor.y);
    if (rightText) {
      doc.setFont(FONT, rightBold ? "bold" : "normal");
      doc.setFontSize(rightSize);
      const [r, g, b] = rightColor;
      doc.setTextColor(r, g, b);
      doc.text(rightText, cursor.marginLeft + cursor.contentWidth - rightWidth, cursor.y);
      doc.setTextColor(0, 0, 0);
    }
    cursor.advance(lineHeight);
    return;
  }

  // Doesn't fit on one line — wrap the left text at word boundaries, full
  // width (this alone guarantees leftText can never run past the page edge,
  // regardless of length or whether there's a date at all), then place the
  // date right-aligned on its own line right after, if there is one.
  drawWrapped(doc, cursor, parseWords(leftText, true), size, lineHeight);
  if (rightText) {
    cursor.ensureRoom(lineHeight);
    doc.setFont(FONT, rightBold ? "bold" : "normal");
    doc.setFontSize(rightSize);
    const [r, g, b] = rightColor;
    doc.setTextColor(r, g, b);
    doc.text(rightText, cursor.marginLeft + cursor.contentWidth - rightWidth, cursor.y);
    doc.setTextColor(0, 0, 0);
    cursor.advance(lineHeight);
  }
}

// A bullet point with a hanging indent — wrapped continuation lines align
// under the text, not under the bullet glyph.
export function drawBullet(
  doc: jsPDF,
  cursor: PdfCursor,
  words: Word[],
  size: number,
  lineHeight: number,
  opts: DrawOpts = {}
): void {
  const indent = 14;
  cursor.ensureRoom(lineHeight);
  doc.setFont(FONT, "normal");
  doc.setFontSize(size);
  doc.setTextColor(0, 0, 0);
  doc.text("•", cursor.marginLeft, cursor.y);
  drawWrapped(
    doc,
    cursor,
    words,
    size,
    lineHeight,
    opts,
    cursor.marginLeft + indent,
    cursor.contentWidth - indent
  );
}
