// The CV as a Word document — the builder behind /api/download, in a module of
// its own so tests/cvRoundTrip can build a .docx and read the text back out
// (the contact line printed "Gmail" for five days in Oct 2026 and nothing
// read a generated file's header). Mirrors lib/buildCvPdf function for
// function: both start from lib/cvDocument prepareCvDocument.
//
// Relative .ts imports only: node:test resolves no "@/" alias.
import { SECTION_HEADING_LINE_RE } from "./sections.ts";
import { PAGE_HEIGHT, type Density } from "./cvDensity.ts";
import { resolveSectionOrder, type SectionId } from "./sectionOrder.ts";
import { splitTrailingDate } from "./projectDate.ts";
import { normalizeProfile } from "./profile.ts";
import { prepareCvDocument } from "./cvDocument.ts";
import { parseBoldSegments, stripBoldMarkers } from "./markdownText.ts";
import { linkParts, type LinkPart } from "./projectLinks.ts";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  LevelFormat,
  TabStopType,
} from "docx";

const NAVY = "1F3864";
const GREY = "595959";
const LINK = "0563C1";
const PAGE_WIDTH = 11906; // A4, twips
// Where every date ends: the right edge of the text column, i.e. the page
// less both margins, which move with the density (lib/cvDensity). A fixed
// 9026 - right only for 1-inch margins - left every date 0.5 to 1 inch
// short of the justified text and the heading rules (found 29 Sep).
function textColumnWidth(d: Density): number {
  return PAGE_WIDTH - 2 * d.margin;
}

function sectionHeading(text: string, d: Density): Paragraph {
  return new Paragraph({
    spacing: { before: d.sectionBefore, after: d.sectionAfter },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 3 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24, color: NAVY, font: "Calibri" })],
  });
}

// Word has no way to measure text width while building the document, so
// "will this fit on one line" is estimated from character count rather than
// real font metrics: bold Calibri at 21 half-points (10.5pt) averages
// roughly 130 twips/char. Deliberately generous (over-estimates width) so a
// borderline title wraps a little earlier rather than risking the date
// overlapping it — the cost of guessing wrong here is a title that gets its
// own line slightly sooner than strictly necessary, not visual breakage.
const TWIPS_PER_CHAR_AT_21 = 130;
function estimatedWidthTwips(text: string, sizeHalfPoints: number): number {
  return text.length * TWIPS_PER_CHAR_AT_21 * (sizeHalfPoints / 21);
}

// Bold left text + date right-aligned — the ONE mechanism used for
// Experience, Projects, and Education alike, so all three align in the same
// column down the page. When the left text is short enough to share a line
// with the date, that's a single paragraph with a right tab stop. When it's
// estimated too long, the date drops to its own right-aligned paragraph
// below instead of flowing inline wherever the wrapped title happens to
// end — matching drawHeaderLine()'s fallback in src/lib/pdfText.ts, so Word
// and PDF behave the same way for a long role/project title/degree.
function datedHeaderParagraph(
  leftText: string,
  date: string,
  opts: {
    width: number;
    spacingBefore: number;
    spacingAfter: number;
    leftSize?: number;
    dateSize?: number;
    dateColor?: string;
    dateBold?: boolean;
  }
): Paragraph[] {
  const leftSize = opts.leftSize ?? 21;
  const dateSize = opts.dateSize ?? leftSize;
  const dateBold = opts.dateBold ?? true;

  if (date) {
    const gap = 200; // twips of breathing room between title and date
    const wouldOverlap =
      estimatedWidthTwips(leftText, leftSize) + gap + estimatedWidthTwips(date, dateSize) > opts.width;
    if (wouldOverlap) {
      return [
        new Paragraph({
          spacing: { before: opts.spacingBefore, after: 0 },
          children: [new TextRun({ text: leftText, bold: true, size: leftSize, font: "Calibri" })],
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 0, after: opts.spacingAfter },
          children: [new TextRun({ text: date, bold: dateBold, size: dateSize, color: opts.dateColor, font: "Calibri" })],
        }),
      ];
    }
  }

  const children: TextRun[] = [new TextRun({ text: leftText, bold: true, size: leftSize, font: "Calibri" })];
  if (date) {
    children.push(
      new TextRun({ text: "\t" + date, bold: dateBold, size: dateSize, color: opts.dateColor, font: "Calibri" })
    );
  }
  return [
    new Paragraph({
      spacing: { before: opts.spacingBefore, after: opts.spacingAfter },
      tabStops: [{ type: TabStopType.RIGHT, position: opts.width }],
      children,
    }),
  ];
}

// Build runs from a line: turns **bold** into bold and bare URLs into
// clickable links. Bold spans are parsed FIRST (lib/markdownText), before
// whitespace tokenization, so a multi-word "**cut lead time 40%**" bolds as
// one phrase instead of leaking literal asterisks — matching parseWords()
// in lib/pdfText.ts and renderInline() in CvPreview exactly.
function buildRuns(text: string, opts: { size?: number; bold?: boolean } = {}) {
  const size = opts.size ?? 21;
  const baseBold = opts.bold ?? false;
  const children: (TextRun | ExternalHyperlink)[] = [];

  for (const seg of parseBoldSegments(text)) {
    const segBold = seg.bold || baseBold;
    for (const token of seg.text.split(/(\s+)/)) {
      if (token === "") continue;
      if (token.trim() === "") {
        children.push(new TextRun({ text: token, size, font: "Calibri" }));
        continue;
      }
      const looksLikeUrl =
        /^https?:\/\//i.test(token) ||
        /^[a-z0-9-]+\.(vercel\.app|com|io|dev|org|net)(\/\S*)?$/i.test(token);

      if (looksLikeUrl) {
        const href = token.startsWith("http") ? token : "https://" + token;
        children.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ text: token, size, color: LINK, underline: {}, bold: segBold, font: "Calibri" })],
          })
        );
      } else {
        children.push(new TextRun({ text: token, bold: segBold, size, font: "Calibri" }));
      }
    }
  }
  return children;
}

// For summary / skills / experience (plain text blocks from the chain).
function textToParagraphs(text: string, mode: "plain" | "skills", d: Density): Paragraph[] {
  if (!text) return [];
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !SECTION_HEADING_LINE_RE.test(line.trim()))
    .flatMap((line): Paragraph[] => {
      const trimmed = line.trim();
      // Job header line: "@@JOB@@role@@date" → bold role left, bold date right
      if (trimmed.startsWith("@@JOB@@")) {
        const parts = trimmed.replace("@@JOB@@", "").split("@@");
        const role = parts[0] || "";
        const date = parts[1] || "";
        return datedHeaderParagraph(role, date, { width: textColumnWidth(d), spacingBefore: d.jobBefore, spacingAfter: d.tightAfter });
      }

      const isBullet = trimmed.startsWith("•") || trimmed.startsWith("-");
      const clean = isBullet ? trimmed.replace(/^[•\-]\s*/, "") : trimmed;

      // Skills: bold only the label before the first colon. Markers are
      // flattened first — the label gets its own bold, so a model-emitted
      // "**Functional Competencies:**" must not leak literal asterisks.
      const flatSkills = mode === "skills" && !isBullet ? stripBoldMarkers(clean) : clean;
      if (mode === "skills" && !isBullet && flatSkills.includes(":")) {
        const idx = flatSkills.indexOf(":");
        const label = flatSkills.slice(0, idx + 1);
        const rest = flatSkills.slice(idx + 1);
        return [new Paragraph({
          spacing: { after: d.bulletAfter },
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: label, bold: true, size: 21, font: "Calibri" }),
            new TextRun({ text: rest, size: 21, font: "Calibri" }),
          ],
        })];
      }

      return [new Paragraph({
        spacing: { after: d.bulletAfter },
        alignment: AlignmentType.JUSTIFIED,
        ...(isBullet ? { numbering: { reference: "default-bullet", level: 0 } } : {}),
        children: buildRuns(clean, { size: 21 }),
      })];
    });
}

// Projects: fixed name/tech/links from PROJECTS_META + tailored bullets from the chain (object form).
type ProjectsPayload = Record<string, unknown>;

// Build projects from the user's project metadata + tailored bullets (keyed by index).
function buildProjects(projectsMeta: any[], tailoredBullets: any, d: Density): Paragraph[] {
  const out: Paragraph[] = [];
  if (!Array.isArray(projectsMeta) || projectsMeta.length === 0) return out;

  projectsMeta.forEach((rawMeta, idx) => {
    const meta = rawMeta || {};
    const tailored = tailoredBullets?.[String(idx)];
    const bullets: string[] = (Array.isArray(tailored) && tailored.length > 0)
      ? tailored
      : (Array.isArray(meta.originalBullets) ? meta.originalBullets : []);

    if (!meta.name && bullets.length === 0) return;

    // Title (bold), with any trailing date ("Project Name | 2026") split off
    // and right-aligned the same way Experience/Education dates are.
    const { title: projectTitle, date: projectDate } = splitTrailingDate(meta.name || "");
    out.push(...datedHeaderParagraph(projectTitle, projectDate, {
      width: textColumnWidth(d),
      spacingBefore: d.jobBefore,
      spacingAfter: d.tightAfter,
      leftSize: 22,
      dateSize: 22,
    }));
    // Tech (same style as body)
    if (meta.tech) {
      out.push(new Paragraph({
        spacing: { after: d.tightAfter },
        children: buildRuns(meta.tech, { size: 21 }),
      }));
    }
    // Links (clickable): "Label: address" by lib/projectLinks linkParts, the
    // same rule as the preview and the PDF — a link that goes nowhere (the
    // extraction's {url: "GitHub"}) is dropped rather than drawn to https://GitHub.
    const links = (Array.isArray(meta.links) ? meta.links : []).map(linkParts).filter((x: LinkPart | null): x is LinkPart => x !== null);
    if (links.length > 0) {
      const linkRuns: (TextRun | ExternalHyperlink)[] = [];
      links.forEach((l: LinkPart, i: number) => {
        if (i > 0) linkRuns.push(new TextRun({ text: " | ", size: 21, font: "Calibri" }));
        if (l.label) linkRuns.push(new TextRun({ text: l.label + ": ", size: 21, font: "Calibri" }));
        linkRuns.push(new ExternalHyperlink({
          link: l.href,
          children: [new TextRun({ text: l.display, size: 21, color: LINK, underline: {}, font: "Calibri" })],
        }));
      });
      out.push(new Paragraph({ spacing: { after: d.tightAfter }, children: linkRuns }));
    }
    // Bullets
    for (const b of bullets) {
      out.push(new Paragraph({
        spacing: { after: d.bulletAfter },
        alignment: AlignmentType.JUSTIFIED,
        numbering: { reference: "default-bullet", level: 0 },
        children: buildRuns(b.replace(/^[-•]\s*/, ""), { size: 21 }),
      }));
    }
  });
  return out;
}

export type CvDocxPayload = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: Record<string, unknown>;
  projectsMeta?: unknown[];
  profile?: unknown;
  sectionOrder?: unknown;
  // 1 when the candidate chose one page (lib/onePage), 2 otherwise.
  targetPages?: number;
  // The run's format style (lib/formatStyles ids). Anything but "careerset" is UKJI.
  formatStyle?: unknown;
};

export async function buildCvDocx(payload: CvDocxPayload): Promise<Uint8Array> {
  const { summary = "", skills = "", experience = "", projects = {}, projectsMeta = [], sectionOrder } = payload;
  // Everything both builders work out before drawing — the contact pieces,
  // the profile's lists and the spacing for the target page count — comes
  // from one pass (lib/cvDocument), so the PDF of the same CV can never
  // measure it differently. Profile data is used exclusively: normalised
  // first, so a malformed stored profile (a model returning
  // `"education": {}`) renders blank instead of crashing the download, and
  // a missing field renders blank — never owner data.
  const { contact, render, contactPieces, education, certs, rightToWork, extraSections, density } = prepareCvDocument({
    profile: normalizeProfile(payload.profile),
    summary, skills, experience, projects, projectsMeta,
    targetPages: payload.targetPages === 1 ? 1 : 2,
    formatStyle: payload.formatStyle,
  });

  const children: Paragraph[] = [];

  // Contact header — render only the parts that exist, so empty fields don't
  // leave blank centered lines (spacing bug) or broken empty hyperlinks.
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
    children: [new TextRun({ text: contact.name, bold: true, size: 40, color: NAVY, font: "Calibri" })] }));
  if (contact.tagline) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: contact.tagline, size: 20, color: GREY, font: "Calibri" })] }));
  }
  if (contact.hasRow) {
    // One line of the pieces that exist (lib/cvDocument contactPieces — the
    // style decides whether a link prints its label or its address), each
    // separated by the style's separator, never a dangling one. Email's
    // mailto: link is built there from a controlled prefix — it does NOT go
    // through the S1 http/https-only sanitisation below (that gate is for
    // arbitrary profile/link URLs, not a fixed scheme we construct ourselves).
    const contactRuns: (TextRun | ExternalHyperlink)[] = [];
    for (const p of contactPieces) {
      if (contactRuns.length > 0) contactRuns.push(new TextRun({ text: render.contactSeparator, size: 20, font: "Calibri" }));
      contactRuns.push(
        p.link
          ? new ExternalHyperlink({ link: p.link, children: [new TextRun({ text: p.text, size: 20, color: LINK, underline: {}, font: "Calibri" })] })
          : new TextRun({ text: p.text, size: 20, font: "Calibri" })
      );
    }
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: contactRuns }));
  }

  // Tailored sections, emitted in the user's saved order. Each builder below
  // produces exactly the paragraphs it did before this feature — only the
  // sequence varies. resolveSectionOrder is total: null/malformed input gives
  // back the original hardcoded order, so an untouched user's .docx is
  // unchanged. Sections after this block (certifications, right to work,
  // pass-through extras) keep their fixed positions.
  const sectionBuilders: Record<SectionId, () => Paragraph[]> = {
    summary: () =>
      summary ? [sectionHeading("Professional Summary", density), ...textToParagraphs(summary, "plain", density)] : [],

    skills: () =>
      skills ? [sectionHeading("Skills", density), ...textToParagraphs(skills, "skills", density)] : [],

    experience: () =>
      experience ? [sectionHeading("Experience", density), ...textToParagraphs(experience, "plain", density)] : [],

    projects: () => {
      const projectParas = buildProjects(projectsMeta, projects, density);
      return projectParas.length > 0 ? [sectionHeading("Projects", density), ...projectParas] : [];
    },

    education: () => {
      if (education.length === 0) return [];
      const out: Paragraph[] = [sectionHeading("Education", density)];
      for (const e of education) {
        // The date bold at the header's size, like experience and project
        // dates (it was grey and a size smaller until 27 Sep).
        out.push(...datedHeaderParagraph(e.head, e.date, {
          width: textColumnWidth(density),
          spacingBefore: density.tightAfter,
          spacingAfter: density.tightAfter,
          leftSize: 22,
          dateSize: 22,
        }));
        out.push(new Paragraph({ spacing: { after: density.tightAfter }, children: [new TextRun({ text: e.school, size: 21, font: "Calibri" })] }));
        // e.note can hold multiple bullets, one per line — a paragraph per
        // line, not one paragraph for the whole blob.
        if (e.note.trim()) {
          for (const n of e.note.split("\n")) {
            if (!n.trim()) continue;
            out.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, alignment: AlignmentType.JUSTIFIED, children: buildRuns(n.trim(), { size: 20 }) }));
          }
        }
      }
      return out;
    },
  };

  for (const sectionId of resolveSectionOrder(sectionOrder)) {
    children.push(...sectionBuilders[sectionId]());
  }

  // Certifications
  if (certs.length > 0) {
    children.push(sectionHeading("Certifications", density));
    for (const c of certs) {
      children.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, children: buildRuns(c, { size: 21 }) }));
    }
  }

  // Right to Work
  if (rightToWork.length > 0) {
    children.push(sectionHeading("Right to Work", density));
    for (const r of rightToWork) {
      children.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, children: buildRuns(r, { size: 21 }) }));
    }
  }

  // Pass-through sections (e.g. Recognitions, Awards) — verbatim, never tailored
  for (const sec of extraSections) {
    children.push(sectionHeading(sec.title, density));
    for (const b of sec.bullets) {
      children.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, children: buildRuns(b, { size: 21 }) }));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    numbering: { config: [{ reference: "default-bullet", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } } } }] }] },
    sections: [{ properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: density.margin, right: density.margin, bottom: density.margin, left: density.margin } } }, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
