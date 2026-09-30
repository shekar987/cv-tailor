// Server-side CV PDF generator. Mirrors src/app/api/download/route.ts
// function-for-function (same input shape, same density/section-order
// logic) but draws real jsPDF text instead of building docx Paragraphs — see
// src/lib/pdfText.ts for why. This is what replaced the old html2canvas
// rasterization pipeline that produced image-only, ATS-invisible PDFs.

import { jsPDF } from "jspdf";
import { normalizeProfile } from "@/lib/profile";
import { prepareCvDocument } from "@/lib/cvDocument";
import { type Density } from "@/lib/cvDensity";
import { resolveSectionOrder, type SectionId } from "@/lib/sectionOrder";
import { PdfCursor, parseWords, drawWrapped, drawBullet, drawHeaderLine, hexToRgb, registerFonts, FONT, type Word } from "@/lib/pdfText";
import { SECTION_HEADING_LINE_RE } from "@/lib/sections";
import { stripBoldMarkers } from "@/lib/markdownText";
import { splitTrailingDate } from "@/lib/projectDate";
import { linkParts, type LinkPart } from "@/lib/projectLinks";

const NAVY = hexToRgb("1F3864");
const GREY = hexToRgb("595959");
const LINK = hexToRgb("0563C1");

const pt = (twips: number) => twips / 20;
const lineOf = (sizePt: number) => sizePt * 1.15;

function drawSectionHeading(doc: jsPDF, cursor: PdfCursor, text: string, d: Density) {
  cursor.advance(pt(d.sectionBefore));
  cursor.ensureRoom(lineOf(12));
  doc.setFont(FONT, "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(text.toUpperCase(), cursor.marginLeft, cursor.y);
  const ruleY = cursor.y + 2;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.75);
  doc.line(cursor.marginLeft, ruleY, cursor.marginLeft + cursor.contentWidth, ruleY);
  doc.setTextColor(0, 0, 0);
  cursor.advance(lineOf(12));
  cursor.advance(pt(d.sectionAfter));
}

// Mirrors textToParagraphs() in the docx route: plain body lines, @@JOB@@
// headers, bullets, and (in "skills" mode) bold-label-before-colon lines.
function drawTextBlock(doc: jsPDF, cursor: PdfCursor, text: string, mode: "plain" | "skills", d: Density) {
  if (!text) return;
  const lines = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .filter((l) => !SECTION_HEADING_LINE_RE.test(l.trim()));

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (trimmed.startsWith("@@JOB@@")) {
      const parts = trimmed.replace("@@JOB@@", "").split("@@");
      const role = parts[0] || "";
      const date = parts[1] || "";
      cursor.advance(pt(d.jobBefore));
      drawHeaderLine(doc, cursor, role, date, 10.5, lineOf(10.5));
      cursor.advance(pt(d.tightAfter));
      continue;
    }

    const isBullet = trimmed.startsWith("•") || trimmed.startsWith("-");
    const clean = isBullet ? trimmed.replace(/^[•\-]\s*/, "") : trimmed;

    // Markers flattened first — the label gets its own bold, so a
    // model-emitted "**Functional Competencies:**" must not leak asterisks.
    const flatSkills = mode === "skills" && !isBullet ? stripBoldMarkers(clean) : clean;
    if (mode === "skills" && !isBullet && flatSkills.includes(":")) {
      const idx = flatSkills.indexOf(":");
      const label = flatSkills.slice(0, idx + 1);
      const rest = flatSkills.slice(idx + 1).replace(/^\s+/, "");
      // The space is embedded IN the label's own text run (not left for the
      // renderer to infer from the gap between two separate draw calls) —
      // some PDF text extractors don't reconstruct a space across a run
      // boundary reliably, especially at a bold→normal transition.
      const restWords = parseWords(rest);
      if (restWords.length > 0) restWords[0].glued = true;
      const words: Word[] = [{ text: label + " ", bold: true }, ...restWords];
      drawWrapped(doc, cursor, words, 10.5, lineOf(10.5));
      cursor.advance(pt(d.bulletAfter));
      continue;
    }

    // Matches AlignmentType.JUSTIFIED in the docx route's equivalent default
    // branch (textToParagraphs) — every plain body line and bullet here
    // except the skills "Label:" line above, which docx also leaves LEFT.
    const words = parseWords(clean);
    if (isBullet) {
      drawBullet(doc, cursor, words, 10.5, lineOf(10.5), { align: "justify" });
    } else {
      drawWrapped(doc, cursor, words, 10.5, lineOf(10.5), { align: "justify" });
    }
    cursor.advance(pt(d.bulletAfter));
  }
}

// Mirrors buildProjects()'s own emptiness check in the docx route — jsPDF
// draws immediately (no deferred paragraph list to inspect the length of
// afterward), so whether the "Projects" heading should appear at all has to
// be decided BEFORE any drawing starts.
function projectsHaveContent(projectsMeta: any[], tailoredBullets: any): boolean {
  if (!Array.isArray(projectsMeta)) return false;
  return projectsMeta.some((meta, idx) => {
    const tailored = tailoredBullets?.[String(idx)];
    const bullets = Array.isArray(tailored) && tailored.length > 0 ? tailored : Array.isArray(meta?.originalBullets) ? meta.originalBullets : [];
    return !!meta?.name || bullets.length > 0;
  });
}

// Mirrors buildProjects() in the docx route.
function drawProjects(doc: jsPDF, cursor: PdfCursor, projectsMeta: any[], tailoredBullets: any, d: Density): void {
  if (!Array.isArray(projectsMeta) || projectsMeta.length === 0) return;

  for (let idx = 0; idx < projectsMeta.length; idx++) {
    const meta = projectsMeta[idx] || {};
    const tailored = tailoredBullets?.[String(idx)];
    const bullets: string[] =
      Array.isArray(tailored) && tailored.length > 0
        ? tailored
        : Array.isArray(meta.originalBullets)
        ? meta.originalBullets
        : [];
    if (!meta.name && bullets.length === 0) continue;

    cursor.advance(pt(d.jobBefore));
    const { title, date } = splitTrailingDate(meta.name || "");
    drawHeaderLine(doc, cursor, title, date, 11, lineOf(11));
    cursor.advance(pt(d.tightAfter));

    if (meta.tech) {
      drawWrapped(doc, cursor, parseWords(meta.tech), 10.5, lineOf(10.5));
      cursor.advance(pt(d.tightAfter));
    }

    // Same rule as the preview and the .docx (lib/projectLinks linkParts).
    const links = (Array.isArray(meta.links) ? meta.links : []).map(linkParts).filter((x: LinkPart | null): x is LinkPart => x !== null);
    if (links.length > 0) {
      const linkWords: Word[] = [];
      links.forEach((l: LinkPart, i: number) => {
        if (i > 0) linkWords.push({ text: "|" });
        // Space embedded in the label's own run, same reasoning as the
        // skills label above — a bold/colored run boundary isn't a
        // reliable place to rely on inferred spacing during extraction.
        if (l.label) linkWords.push({ text: l.label + ": " });
        linkWords.push({ text: l.display, link: l.href, glued: !!l.label });
      });
      drawWrapped(doc, cursor, linkWords, 10.5, lineOf(10.5), { linkColor: LINK });
      cursor.advance(pt(d.tightAfter));
    }

    for (const b of bullets) {
      const words = parseWords(b.replace(/^[-•]\s*/, ""));
      // Matches AlignmentType.JUSTIFIED on this same bullet loop in
      // buildProjects() in the docx route.
      drawBullet(doc, cursor, words, 10.5, lineOf(10.5), { align: "justify" });
      cursor.advance(pt(d.bulletAfter));
    }
  }
}

function drawEducation(doc: jsPDF, cursor: PdfCursor, education: any[], d: Density) {
  if (education.length === 0) return;
  drawSectionHeading(doc, cursor, "Education", d);
  for (const e of education) {
    cursor.advance(pt(d.tightAfter));
    // The date bold at the header's size, like experience and project dates
    // (the .docx builder's education section matches).
    drawHeaderLine(doc, cursor, e.head || "", e.date || "", 11, lineOf(11));
    cursor.advance(pt(d.tightAfter));

    if (e.school) {
      drawWrapped(doc, cursor, parseWords(e.school), 10.5, lineOf(10.5));
      cursor.advance(pt(d.tightAfter));
    }
    // e.note can hold multiple bullets, one per line — draw one bullet per
    // line, matching the docx route's education section builder (also
    // matches its AlignmentType.JUSTIFIED there).
    if (e.note && String(e.note).trim()) {
      for (const n of String(e.note).split("\n")) {
        if (!n.trim()) continue;
        drawBullet(doc, cursor, parseWords(n.trim()), 10, lineOf(10), { align: "justify" });
        cursor.advance(pt(d.bulletAfter));
      }
    }
  }
}

function drawBulletList(doc: jsPDF, cursor: PdfCursor, title: string, items: string[], d: Density) {
  if (items.length === 0) return;
  drawSectionHeading(doc, cursor, title, d);
  for (const item of items) {
    // parseWords so **bold** in stored profile content (certs, right to
    // work, extras) renders as bold — matching the docx route's buildRuns.
    drawBullet(doc, cursor, parseWords(item), 10.5, lineOf(10.5));
    cursor.advance(pt(d.bulletAfter));
  }
}

export type CvPdfPayload = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: Record<string, string[]>;
  projectsMeta?: any[];
  profile?: any;
  sectionOrder?: unknown;
  // 1 for a candidate with under three years (lib/onePage), 2 otherwise.
  targetPages?: number;
};

export function buildCvPdf(payload: CvPdfPayload): Uint8Array {
  return buildCvPdfWithPages(payload).bytes;
}

// The bytes and the real page count — what the tailor route measures the
// finished CV with (lib/onePage fitToRealPages): the download's own layout,
// not the estimate.
export function buildCvPdfWithPages(payload: CvPdfPayload): { bytes: Uint8Array; pages: number } {
  const { summary = "", skills = "", experience = "", projects = {}, projectsMeta = [], profile, sectionOrder, targetPages = 2 } = payload;

  // One pass shared with the docx route (lib/cvDocument): the contact pieces,
  // the profile's lists and the density for the target page count. The
  // profile is normalised here too, so a missing field renders blank —
  // never owner data.
  const { contact, education, certs, rightToWork, extraSections, density } = prepareCvDocument({
    profile: normalizeProfile(profile),
    summary, skills, experience,
    projects: projects as Record<string, unknown>,
    projectsMeta,
    targetPages: targetPages === 1 ? 1 : 2,
  });

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerFonts(doc);
  const margin = pt(density.margin);
  const cursor = new PdfCursor(doc, { top: margin, right: margin, bottom: margin, left: margin });

  // Contact header — only the parts that exist, matching the docx route.
  cursor.ensureRoom(lineOf(20));
  doc.setFont(FONT, "bold");
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  const nameWidth = doc.getTextWidth(contact.name);
  doc.text(contact.name, cursor.marginLeft + (cursor.contentWidth - nameWidth) / 2, cursor.y);
  doc.setTextColor(0, 0, 0);
  cursor.advance(lineOf(20));
  cursor.advance(2);

  if (contact.tagline) {
    // Real words, so a long headline wraps between them: as one `Word` it
    // was split character by character ("produ-ction", 30 Sep).
    drawWrapped(doc, cursor, parseWords(contact.tagline), 10, lineOf(10), { color: GREY, align: "center" });
    cursor.advance(2);
  }
  if (contact.hasRow) {
    // One line: location · phone · email (mailto) · LinkedIn · GitHub — only
    // the pieces that exist, each separated by "·", never a dangling
    // separator for a missing piece.
    const contactWords: Word[] = [];
    const addPiece = (piece: Word) => {
      if (contactWords.length > 0) contactWords.push({ text: "·" });
      contactWords.push(piece);
    };
    if (contact.location) addPiece({ text: contact.location });
    if (contact.phone) addPiece({ text: contact.phone });
    if (contact.email) addPiece({ text: contact.email, link: "mailto:" + contact.email });
    if (contact.linkedin) addPiece({ text: "LinkedIn", link: contact.linkedin });
    if (contact.github) addPiece({ text: "GitHub", link: contact.github });
    if (contact.website) addPiece({ text: "Portfolio", link: contact.website });
    drawWrapped(doc, cursor, contactWords, 10, lineOf(10), { align: "center", linkColor: LINK });
    cursor.advance(2);
  }

  // Tailored sections in the user's saved order — same sectionBuilders shape
  // as the docx route, just drawing instead of building Paragraphs.
  const sectionBuilders: Record<SectionId, () => void> = {
    summary: () => { if (summary) { drawSectionHeading(doc, cursor, "Professional Summary", density); drawTextBlock(doc, cursor, summary, "plain", density); } },
    skills: () => { if (skills) { drawSectionHeading(doc, cursor, "Skills", density); drawTextBlock(doc, cursor, skills, "skills", density); } },
    experience: () => { if (experience) { drawSectionHeading(doc, cursor, "Experience", density); drawTextBlock(doc, cursor, experience, "plain", density); } },
    projects: () => {
      if (projectsHaveContent(projectsMeta, projects)) {
        drawSectionHeading(doc, cursor, "Projects", density);
        drawProjects(doc, cursor, projectsMeta, projects, density);
      }
    },
    education: () => drawEducation(doc, cursor, education, density),
  };

  for (const sectionId of resolveSectionOrder(sectionOrder)) {
    sectionBuilders[sectionId]();
  }

  drawBulletList(doc, cursor, "Certifications", certs, density);
  drawBulletList(doc, cursor, "Right to Work", rightToWork, density);
  for (const sec of extraSections) {
    drawBulletList(doc, cursor, sec.title, sec.bullets, density);
  }

  return { bytes: new Uint8Array(doc.output("arraybuffer")), pages: doc.getNumberOfPages() };
}
