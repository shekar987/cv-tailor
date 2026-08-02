// Server-side cover letter PDF generator. Mirrors
// src/app/api/download-cover/route.ts: each non-empty line becomes a
// paragraph, **bold** markers become bold runs. Draws real jsPDF text — see
// src/lib/pdfText.ts for why this replaced the old html2canvas rasterizer.

import { jsPDF } from "jspdf";
import { PdfCursor, parseWords, drawWrapped } from "@/lib/pdfText";

const MARGIN_PT = 1440 / 20; // 1 inch, matching the docx section's margins
const SIZE = 11; // docx size 22 half-points = 11pt
const LINE_HEIGHT = SIZE * 1.2;
const PARA_GAP = 120 / 20; // docx spacing.after 120 twips = 6pt

export function buildCoverLetterPdf(coverLetter: string): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const cursor = new PdfCursor(doc, { top: MARGIN_PT, right: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT });

  const lines = (coverLetter || "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const words = parseWords(line);
    drawWrapped(doc, cursor, words, SIZE, LINE_HEIGHT);
    cursor.advance(PARA_GAP);
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
