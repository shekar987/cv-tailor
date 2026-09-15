// Stage 4 — the interview prep pack as a real-text PDF (jsPDF via the shared
// pdfText engine; never rasterized — see CLAUDE.md). Traced status is written
// as plain "[traced]" / "[not traced]" text rather than a ✓ glyph, which the
// embedded NotoSans face lacks (fixGlyphs would silently drop it).

import { jsPDF } from "jspdf";
import { PdfCursor, parseWords, drawWrapped, drawLine, drawBullet, registerFonts, hexToRgb, type Rgb } from "@/lib/pdfText";
import type { PrepPack, PrepQuestion } from "@/lib/prepPack";

const MARGIN_PT = 56;
const BODY = 10.5;
const BODY_LH = BODY * 1.3;
const SMALL = 9.5;
const SMALL_LH = SMALL * 1.3;
const NAVY: Rgb = hexToRgb("#1F3A5F");
const MUTED: Rgb = [110, 110, 118];
const AMBER: Rgb = hexToRgb("#8A5A12");

const CATEGORY_LABEL: Record<PrepQuestion["category"], string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  role: "Role & motivation",
  company: "Company",
  gap: "Honest gap",
};

function heading(doc: jsPDF, cursor: PdfCursor, text: string): void {
  cursor.ensureRoom(BODY_LH * 3);
  cursor.advance(8);
  drawLine(doc, cursor, text.toUpperCase(), 11, 14, { bold: true, color: NAVY });
  cursor.advance(3);
}

function paragraph(doc: jsPDF, cursor: PdfCursor, text: string, opts: { size?: number; color?: Rgb; bold?: boolean } = {}): void {
  if (!text) return;
  const size = opts.size ?? BODY;
  drawWrapped(doc, cursor, parseWords(text, opts.bold ?? false), size, size * 1.3, { color: opts.color });
}

function bullets(doc: jsPDF, cursor: PdfCursor, items: string[], size = BODY, color?: Rgb): void {
  for (const item of items) {
    drawBullet(doc, cursor, parseWords(item), size, size * 1.3, { color });
  }
}

function question(doc: jsPDF, cursor: PdfCursor, q: PrepQuestion, index: number): void {
  cursor.ensureRoom(BODY_LH * 4);
  cursor.advance(6);
  drawLine(doc, cursor, `${index}. ${q.question}`, BODY, BODY_LH, { bold: true });
  paragraph(doc, cursor, `${CATEGORY_LABEL[q.category]}${q.whyTheyAsk ? ` · Why they ask: ${q.whyTheyAsk}` : ""}`, { size: SMALL, color: MUTED });
  cursor.advance(2);
  if (q.star) {
    for (const [label, text] of [
      ["Situation", q.star.situation],
      ["Task", q.star.task],
      ["Action", q.star.action],
      ["Result", q.star.result],
    ] as const) {
      if (text) paragraph(doc, cursor, `**${label}:** ${text}`);
    }
  }
  if (q.points.length) bullets(doc, cursor, q.points);
  if (q.evidence.length) {
    cursor.advance(2);
    bullets(
      doc,
      cursor,
      q.evidence.map((e) => `From your CV: "${e.text}" [${e.verified ? "traced" : "not traced"}]`),
      SMALL,
      MUTED
    );
  }
  if (q.unverifiedNumbers.length) {
    paragraph(doc, cursor, `Check these figures against your CV before using them: ${q.unverifiedNumbers.join(", ")}`, { size: SMALL, color: AMBER });
  }
}

export function buildPrepPdf(pack: PrepPack): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerFonts(doc);
  const cursor = new PdfCursor(doc, { top: MARGIN_PT, right: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT });

  const title = [pack.role, pack.company].filter(Boolean).join(" at ");
  drawLine(doc, cursor, `Interview prep${title ? ` — ${title}` : ""}`, 16, 20, { bold: true, color: NAVY });
  const generated = new Date(pack.generatedAt);
  const stamp = Number.isNaN(generated.getTime()) ? "" : generated.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  paragraph(
    doc,
    cursor,
    `${stamp ? `Generated ${stamp}. ` : ""}Every answer below is built only from your master CV. "[traced]" marks a citation found verbatim in it; "[not traced]" means check the line before you rely on it.`,
    { size: SMALL, color: MUTED }
  );

  if (pack.angle.headline || pack.angle.whyYou.length || pack.angle.honestGaps.length) {
    heading(doc, cursor, "Your angle");
    paragraph(doc, cursor, pack.angle.headline);
    if (pack.angle.whyYou.length) {
      cursor.advance(2);
      bullets(doc, cursor, pack.angle.whyYou);
    }
    if (pack.angle.honestGaps.length) {
      cursor.advance(4);
      paragraph(doc, cursor, "Honest gaps", { bold: true });
      bullets(doc, cursor, pack.angle.honestGaps.map((g) => `**${g.gap}** — ${g.howToAddress}`));
    }
  }

  heading(doc, cursor, "Likely questions");
  pack.questions.forEach((q, i) => question(doc, cursor, q, i + 1));

  if (pack.questionsToAsk.length) {
    heading(doc, cursor, "Questions to ask them");
    bullets(doc, cursor, pack.questionsToAsk);
  }

  if (pack.opener) {
    heading(doc, cursor, "30-second opener");
    paragraph(doc, cursor, pack.opener);
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
