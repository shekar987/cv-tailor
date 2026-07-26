// Server-side CV file parsing: PDF / DOCX / TXT -> plain text.
//
// The output feeds the SAME master-CV textarea the paste flow uses, so the
// tailoring chain downstream is unchanged. That chain detects sections by their
// heading lines (EXPERIENCE, SKILLS, ...) and by bullet structure, so the one
// thing this module must not do is collapse the document into a paragraph.
//
// Nothing here ever logs file bytes or extracted text.

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_CV_CHARS = 20_000; // matches the cap on the AI endpoints

export type CvFileKind = "pdf" | "docx" | "txt";

export type CvParseErrorCode =
  | "too_large"
  | "unsupported_type"
  | "too_long"
  | "no_text_layer"
  | "empty"
  | "unreadable"
  | "timeout";

export class CvParseError extends Error {
  code: CvParseErrorCode;

  constructor(message: string, code: CvParseErrorCode) {
    super(message);
    this.name = "CvParseError";
    this.code = code;
  }
}

// ── File type detection ──────────────────────────────────────────────────────
// Sniff the actual bytes rather than trusting the extension or the browser's
// Content-Type, both of which the client controls.

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
// Empty/spanned zip variants — valid archives, but never a real .docx payload.
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];

// A .docx is a zip whose payload includes word/document.xml. Checking for that
// marker keeps a renamed .xlsx or a random archive from reaching the parser.
function looksLikeDocx(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, ZIP_MAGIC)) return false;
  // The central directory holds the entry names; scan the raw bytes for the
  // marker rather than unzipping (which is the expensive, attackable part).
  const needle = "word/";
  const haystack = Buffer.from(
    bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 64 * 1024)
  ).toString("latin1");
  const tail = Buffer.from(
    bytes.buffer,
    bytes.byteOffset + Math.max(0, bytes.length - 64 * 1024),
    Math.min(bytes.length, 64 * 1024)
  ).toString("latin1");
  return haystack.includes(needle) || tail.includes(needle);
}

function isProbablyText(bytes: Uint8Array): boolean {
  // Reject anything with NUL bytes or a high proportion of control characters —
  // that is a binary file wearing a .txt extension.
  const sample = bytes.subarray(0, 4096);
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control++;
  }
  return control / Math.max(1, sample.length) < 0.1;
}

export function detectFileKind(bytes: Uint8Array, filename: string): CvFileKind {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (looksLikeDocx(bytes)) return "docx";

  if (startsWith(bytes, ZIP_EMPTY) || startsWith(bytes, ZIP_SPANNED) || startsWith(bytes, ZIP_MAGIC)) {
    throw new CvParseError(
      "That looks like a zip archive rather than a Word document. Upload a .docx, .pdf, or .txt file.",
      "unsupported_type"
    );
  }

  // .doc (the old OLE format) is a common mistake worth naming explicitly.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new CvParseError(
      "That's an old-style .doc file. Save it as .docx or PDF and try again.",
      "unsupported_type"
    );
  }

  if (/\.txt$/i.test(filename) && isProbablyText(bytes)) return "txt";
  if (isProbablyText(bytes)) return "txt";

  throw new CvParseError(
    "Unsupported file. Upload a PDF, Word (.docx), or plain text file.",
    "unsupported_type"
  );
}

// ── PDF ──────────────────────────────────────────────────────────────────────

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL: boolean;
};

// PDF text arrives as positioned fragments with no inherent line structure, so
// unpdf's extractText() would hand back run-together prose. Instead we group
// fragments into visual lines by their Y position (PDF origin is bottom-left,
// so higher Y is higher on the page) and rebuild the layout ourselves. This is
// what keeps "EXPERIENCE" on its own line for the section detector.
function itemsToLines(items: TextItem[]): string[] {
  const visible = items.filter((item) => item.str && item.str.trim() !== "");
  if (visible.length === 0) return [];

  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of visible) {
    // Tolerance scales with the type size so tight CV layouts and large headings
    // both group correctly; superscripts stay on their parent line.
    const tolerance = Math.max(2, (item.height || item.fontSize || 10) * 0.5);
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
      // Track the row's baseline as the mean, so drift doesn't accumulate.
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  rows.sort((a, b) => b.y - a.y); // top of page first

  return rows
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = "";
      let previousEnd: number | null = null;
      for (const item of row.items) {
        if (previousEnd !== null) {
          // A gap wider than a fraction of the type size is a real space; PDFs
          // frequently omit space glyphs between separately positioned runs.
          const gap = item.x - previousEnd;
          if (gap > (item.fontSize || 10) * 0.2) line += " ";
        }
        line += item.str;
        previousEnd = item.x + (item.width || 0);
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter((line) => line !== "");
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const { extractTextItems } = await import("unpdf");
  let pages: TextItem[][];
  try {
    const result = await extractTextItems(bytes);
    pages = result.items as unknown as TextItem[][];
  } catch {
    throw new CvParseError(
      "That PDF couldn't be read. It may be corrupted or password-protected.",
      "unreadable"
    );
  }

  const pageTexts = pages.map((items) => itemsToLines(items).join("\n"));
  return pageTexts.filter((page) => page.trim() !== "").join("\n\n");
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  try {
    // extractRawText emits "\n\n" after every paragraph, which preserves the
    // heading/bullet structure the tailoring chain looks for.
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length),
    });
    // That separator is uniform, not meaningful — every line, heading included,
    // arrives double-spaced, which is tiring to review in the textarea. Halving
    // runs of newlines restores normal spacing while keeping a genuinely empty
    // paragraph (which mammoth emits as "\n\n\n\n") as a single blank line.
    return result.value.replace(/\n{2}/g, "\n");
  } catch {
    throw new CvParseError(
      "That Word file couldn't be read. Try re-saving it as .docx, or paste the text instead.",
      "unreadable"
    );
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ") // non-breaking spaces confuse keyword matching
    // Mammoth emits a blank line after every paragraph; collapse the resulting
    // runs so the text reads normally without losing paragraph separation.
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
}

// A PDF that is a scanned image has no text layer: PDF.js returns almost
// nothing, or a handful of stray ligatures. Detect that rather than handing the
// user a blank textarea, and never attempt OCR.
function looksLikeScannedImage(text: string): boolean {
  const stripped = text.replace(/\s/g, "");
  if (stripped.length < 100) return true;
  // Real CVs are mostly letters. A page of extraction artefacts is not.
  const letters = (stripped.match(/[a-zA-Z]/g) || []).length;
  return letters / stripped.length < 0.5;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function parseCvFile(
  bytes: Uint8Array,
  filename: string
): Promise<{ text: string; kind: CvFileKind }> {
  if (bytes.length === 0) {
    throw new CvParseError("That file is empty.", "empty");
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new CvParseError("That file is larger than 5MB. Upload a smaller file.", "too_large");
  }

  const kind = detectFileKind(bytes, filename);

  let raw: string;
  if (kind === "pdf") {
    raw = await parsePdf(bytes);
  } else if (kind === "docx") {
    raw = await parseDocx(bytes);
  } else {
    raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("utf8");
  }

  const text = tidy(raw);

  if (kind === "pdf" && looksLikeScannedImage(text)) {
    throw new CvParseError(
      "This PDF appears to be a scanned image. Please paste your CV text instead.",
      "no_text_layer"
    );
  }

  if (text.length === 0) {
    throw new CvParseError(
      "No text could be read from that file. Please paste your CV text instead.",
      "empty"
    );
  }

  if (text.length > MAX_CV_CHARS) {
    throw new CvParseError(
      `That CV is ${text.length.toLocaleString()} characters — the limit is ${MAX_CV_CHARS.toLocaleString()}. Shorten it, or paste just the relevant sections.`,
      "too_long"
    );
  }

  return { text, kind };
}
