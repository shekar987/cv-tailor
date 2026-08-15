// Server-side CV PDF generator. Mirrors src/app/api/download/route.ts
// function-for-function (same input shape, same density/section-order
// logic) but draws real jsPDF text instead of building docx Paragraphs — see
// src/lib/pdfText.ts for why. This is what replaced the old html2canvas
// rasterization pipeline that produced image-only, ATS-invisible PDFs.

import { jsPDF } from "jspdf";
import { filterExtraSections } from "@/lib/sections";
import { chooseDensity, wrappedLines, type Density } from "@/lib/cvDensity";
import { resolveSectionOrder, type SectionId } from "@/lib/sectionOrder";
import { PdfCursor, parseWords, drawWrapped, drawBullet, drawHeaderLine, hexToRgb, registerFonts, FONT, type Word } from "@/lib/pdfText";
import { splitTrailingDate } from "@/lib/projectDate";

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
    .filter((l) => !/^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE)\s*$/i.test(l.trim()));

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

    if (mode === "skills" && !isBullet && clean.includes(":")) {
      const idx = clean.indexOf(":");
      const label = clean.slice(0, idx + 1);
      const rest = clean.slice(idx + 1).replace(/^\s+/, "");
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
      drawWrapped(doc, cursor, [{ text: meta.tech }], 10.5, lineOf(10.5));
      cursor.advance(pt(d.tightAfter));
    }

    if (Array.isArray(meta.links) && meta.links.length > 0) {
      const linkWords: Word[] = [];
      meta.links.forEach((l: any, i: number) => {
        if (i > 0) linkWords.push({ text: "|" });
        const label = (l.label || "").trim().replace(/:\s*$/, "");
        const rawText = (l.text || l.url || "").trim();
        const display = rawText.replace(/^https?:\/\//i, "");
        const url = l.url && l.url.startsWith("http") ? l.url : "https://" + (l.url || rawText);
        const showLabel = !!label && label.toLowerCase() !== display.toLowerCase() && label.toLowerCase() !== rawText.toLowerCase();
        // Space embedded in the label's own run, same reasoning as the
        // skills label above — a bold/colored run boundary isn't a
        // reliable place to rely on inferred spacing during extraction.
        if (showLabel) linkWords.push({ text: label + ": " });
        linkWords.push({ text: display, link: url, glued: showLabel });
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
    drawHeaderLine(doc, cursor, e.head || "", e.date || "", 11, lineOf(11), {
      rightColor: GREY,
      rightBold: false,
      rightSize: 10,
    });
    cursor.advance(pt(d.tightAfter));

    if (e.school) {
      drawWrapped(doc, cursor, [{ text: e.school }], 10.5, lineOf(10.5));
      cursor.advance(pt(d.tightAfter));
    }
    // e.note can hold multiple bullets, one per line — draw one bullet per
    // line, matching the docx route's education section builder (also
    // matches its AlignmentType.JUSTIFIED there).
    if (e.note && String(e.note).trim()) {
      for (const n of String(e.note).split("\n")) {
        if (!n.trim()) continue;
        drawBullet(doc, cursor, [{ text: n.trim() }], 10, lineOf(10), { align: "justify" });
        cursor.advance(pt(d.bulletAfter));
      }
    }
  }
}

function drawBulletList(doc: jsPDF, cursor: PdfCursor, title: string, items: string[], d: Density) {
  if (items.length === 0) return;
  drawSectionHeading(doc, cursor, title, d);
  for (const item of items) {
    drawBullet(doc, cursor, [{ text: item }], 10.5, lineOf(10.5));
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
};

export function buildCvPdf(payload: CvPdfPayload): Uint8Array {
  const { summary = "", skills = "", experience = "", projects = {}, projectsMeta = [], profile, sectionOrder } = payload;

  // Same fallback/cleanup rules as the docx route — missing fields render
  // blank, never fall back to owner data.
  const contactName = profile?.name || "";
  const cleanTagline = (t: string): string =>
    (t || "")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\b(?:www\.)?(?:linkedin|github)\.com\/?\S*/gi, " ")
      .replace(/\b(?:LinkedIn|GitHub)\s*:/gi, " ")
      .replace(/^\s*[|•·,\-–—]+\s*|\s*[|•·,\-–—]+\s*$/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  const contactTagline = cleanTagline(profile?.tagline ?? "");
  const contactEmail = (profile?.email || "").trim();
  const contactLinkedin = profile?.linkedin ? (profile.linkedin.startsWith("http") ? profile.linkedin : "https://" + profile.linkedin) : "";
  const contactGithub = profile?.github ? (profile.github.startsWith("http") ? profile.github : "https://" + profile.github) : "";
  const education = (profile?.education || []).map((e: any) => ({
    head: e.degree || "",
    date: e.dates || "",
    school: e.institution || "",
    note: e.note,
  }));
  const certs: string[] = profile?.certifications || [];
  const rightToWork: string[] = profile?.rightToWork || [];
  const extraSections = filterExtraSections(profile?.extraSections);

  // Same density calculation as the docx route, from the same library.
  const projectText = Object.values(projects as Record<string, unknown>)
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .join("\n");
  const projectMetaText = (Array.isArray(projectsMeta) ? projectsMeta : [])
    .map((m: any) => [m?.name, m?.tech].filter(Boolean).join("\n"))
    .join("\n");
  const educationText = education.map((e: any) => [e.head, e.school, e.note].filter(Boolean).join("\n")).join("\n");
  const extrasText = extraSections.map((s) => s.bullets.join("\n")).join("\n");
  const bodyText = [summary, skills, experience, projectText, projectMetaText, educationText, certs.join("\n"), rightToWork.join("\n"), extrasText]
    .filter(Boolean)
    .join("\n");
  const hasContactRow = !!(profile?.location || profile?.phone || contactEmail || contactLinkedin || contactGithub);
  const contactLines = 1 + (contactTagline ? 1 : 0) + (hasContactRow ? 1 : 0);
  const headingCount =
    (summary ? 1 : 0) + (skills ? 1 : 0) + (experience ? 1 : 0) +
    (education.length > 0 ? 1 : 0) + (certs.length > 0 ? 1 : 0) +
    (rightToWork.length > 0 ? 1 : 0) + extraSections.length + (projectMetaText ? 1 : 0);
  const density = chooseDensity({
    lines: wrappedLines(bodyText) + contactLines,
    paragraphs: bodyText.split("\n").filter((l) => l.trim()).length + contactLines,
    headings: headingCount,
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
  const nameWidth = doc.getTextWidth(contactName);
  doc.text(contactName, cursor.marginLeft + (cursor.contentWidth - nameWidth) / 2, cursor.y);
  doc.setTextColor(0, 0, 0);
  cursor.advance(lineOf(20));
  cursor.advance(2);

  if (contactTagline) {
    drawWrapped(doc, cursor, [{ text: contactTagline }], 10, lineOf(10), { color: GREY, align: "center" });
    cursor.advance(2);
  }
  if (hasContactRow) {
    // One line: location · phone · email (mailto) · LinkedIn · GitHub — only
    // the pieces that exist, each separated by "·", never a dangling
    // separator for a missing piece.
    const contactWords: Word[] = [];
    const addPiece = (piece: Word) => {
      if (contactWords.length > 0) contactWords.push({ text: "·" });
      contactWords.push(piece);
    };
    if (profile?.location) addPiece({ text: profile.location });
    if (profile?.phone) addPiece({ text: profile.phone });
    if (contactEmail) addPiece({ text: contactEmail, link: "mailto:" + contactEmail });
    if (contactLinkedin) addPiece({ text: "LinkedIn", link: contactLinkedin });
    if (contactGithub) addPiece({ text: "GitHub", link: contactGithub });
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

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
