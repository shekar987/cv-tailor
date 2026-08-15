import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { filterExtraSections } from "@/lib/sections";
import { chooseDensity, wrappedLines, PAGE_HEIGHT, type Density } from "@/lib/cvDensity";
import { resolveSectionOrder, type SectionId } from "@/lib/sectionOrder";
import { splitTrailingDate } from "@/lib/projectDate";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  LevelFormat,
} from "docx";

const NAVY = "1F3864";
const GREY = "595959";
const LINK = "0563C1";
const DATE_TAB_POSITION = 9026;

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
      estimatedWidthTwips(leftText, leftSize) + gap + estimatedWidthTwips(date, dateSize) > DATE_TAB_POSITION;
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
      tabStops: [{ type: "right" as any, position: DATE_TAB_POSITION }],
      children,
    }),
  ];
}

// Build runs from a line: turns **bold** into bold and bare URLs into clickable links.
function buildRuns(text: string, opts: { size?: number; bold?: boolean } = {}) {
  const size = opts.size ?? 21;
  const baseBold = opts.bold ?? false;
  const children: (TextRun | ExternalHyperlink)[] = [];

  const tokens = text.split(/(\s+)/);

  for (const token of tokens) {
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
          children: [new TextRun({ text: token, size, color: LINK, underline: {}, font: "Calibri" })],
        })
      );
    } else {
      const boldParts = token.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
      for (const part of boldParts) {
        const isBold = part.startsWith("**") && part.endsWith("**");
        children.push(
          new TextRun({
            text: isBold ? part.slice(2, -2) : part,
            bold: isBold || baseBold,
            size,
            font: "Calibri",
          })
        );
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
    .filter((line) => !/^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE)\s*$/i.test(line.trim()))
    .flatMap((line): Paragraph[] => {
      const trimmed = line.trim();
      // Job header line: "@@JOB@@role@@date" → bold role left, bold date right
      if (trimmed.startsWith("@@JOB@@")) {
        const parts = trimmed.replace("@@JOB@@", "").split("@@");
        const role = parts[0] || "";
        const date = parts[1] || "";
        return datedHeaderParagraph(role, date, { spacingBefore: d.jobBefore, spacingAfter: d.tightAfter });
      }

      const isBullet = trimmed.startsWith("•") || trimmed.startsWith("-");
      const clean = isBullet ? trimmed.replace(/^[•\-]\s*/, "") : trimmed;

      // Skills: bold only the label before the first colon
      if (mode === "skills" && !isBullet && clean.includes(":")) {
        const idx = clean.indexOf(":");
        const label = clean.slice(0, idx + 1);
        const rest = clean.slice(idx + 1);
        return [new Paragraph({
          spacing: { after: d.bulletAfter },
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: label, bold: true, size: 21, font: "Calibri" }),
            ...buildRuns(rest, { size: 21 }),
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

  projectsMeta.forEach((meta, idx) => {
    const tailored = tailoredBullets?.[String(idx)];
    const bullets: string[] = (Array.isArray(tailored) && tailored.length > 0)
      ? tailored
      : (Array.isArray(meta.originalBullets) ? meta.originalBullets : []);

    if (!meta.name && bullets.length === 0) return;

    // Title (bold), with any trailing date ("Project Name | 2026") split off
    // and right-aligned the same way Experience/Education dates are.
    const { title: projectTitle, date: projectDate } = splitTrailingDate(meta.name || "");
    out.push(...datedHeaderParagraph(projectTitle, projectDate, {
      spacingBefore: d.jobBefore,
      spacingAfter: d.tightAfter,
      leftSize: 22,
      dateSize: 22,
    }));
    // Tech (same style as body)
    if (meta.tech) {
      out.push(new Paragraph({
        spacing: { after: d.tightAfter },
        children: [new TextRun({ text: meta.tech, size: 21, font: "Calibri" })],
      }));
    }
    // Links (clickable)
    if (Array.isArray(meta.links) && meta.links.length > 0) {
      const linkRuns: (TextRun | ExternalHyperlink)[] = [];
      meta.links.forEach((l: any, i: number) => {
        if (i > 0) linkRuns.push(new TextRun({ text: "   |   ", size: 21, font: "Calibri" }));
        // label = category prefix ("Code:", "Live"); display = clickable text.
        // The extractor sometimes sets both to the same value (e.g. "GitHub"),
        // which rendered as "GitHubGitHub". Show the label only when it adds
        // information, and separate it from the link with ": ".
        const label = (l.label || "").trim().replace(/:\s*$/, "");
        const rawText = (l.text || l.url || "").trim();
        const display = rawText.replace(/^https?:\/\//i, "");
        const url = l.url && l.url.startsWith("http") ? l.url : "https://" + (l.url || rawText);
        const showLabel = label && label.toLowerCase() !== display.toLowerCase() && label.toLowerCase() !== rawText.toLowerCase();
        if (showLabel) linkRuns.push(new TextRun({ text: label + ": ", size: 21, font: "Calibri" }));
        linkRuns.push(new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: display, size: 21, color: LINK, underline: {}, font: "Calibri" })],
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
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { summary, skills, experience, projects, projectsMeta, companyName, roleTitle, profile, sectionOrder } = await req.json();
// Always use profile data exclusively. Missing fields render blank — never fall back to owner data.
const contactName = profile?.name || "";
// A professional headline should never contain contact/social URLs. When the
// extractor mis-files the CV's contact line into the tagline, the GitHub/LinkedIn
// URL renders here AND again as the link label below — the "GitHub twice" bug.
// Strip URL/social forms only (bare words like "GitHub Actions" are preserved).
const cleanTagline = (t: string): string =>
  (t || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?(?:linkedin|github)\.com\/?\S*/gi, " ")
    .replace(/\b(?:LinkedIn|GitHub)\s*:/gi, " ")
    .replace(/^\s*[|•·,\-–—]+\s*|\s*[|•·,\-–—]+\s*$/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
const contactTagline = cleanTagline(profile?.tagline ?? "");
const contactEmail = String(profile?.email || "").trim();
const contactLinkedin = profile?.linkedin
  ? (profile.linkedin.startsWith("http") ? profile.linkedin : "https://" + profile.linkedin)
  : "";
const contactGithub = profile?.github
  ? (profile.github.startsWith("http") ? profile.github : "https://" + profile.github)
  : "";
const education = (profile?.education || []).map((e: any) => ({
  head: e.degree || "",
  date: e.dates || "",
  school: e.institution || "",
  note: e.note,
}));
const certs = profile?.certifications || [];
const rightToWork = profile?.rightToWork || [];
const extraSections = filterExtraSections(profile?.extraSections);

    // Build a safe filename: FirstName_CompanyName_RoleName_CV.docx
    const firstName = (profile?.name || "").trim().split(/\s+/).slice(0, 2).join("_") || "User";
    const clean = (s: string) =>
      (s || "")
        .replace(/[^a-zA-Z0-9]+/g, "_") // non-alphanumeric → underscore
        .replace(/^_+|_+$/g, "")        // trim leading/trailing underscores
        .slice(0, 40);                  // keep it reasonable
    const parts = [firstName, clean(companyName), clean(roleTitle), "CV"].filter(Boolean);
    const filename = parts.join("_") + ".docx";

    // Size the content before laying it out, so the spacing can be chosen to
    // fill two pages rather than either cramming or leaving page 2 half empty.
    const projectText = Object.values((projects || {}) as Record<string, unknown>)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .join("\n");
    const projectMetaText = (Array.isArray(projectsMeta) ? projectsMeta : [])
      .map((m: any) => [m?.name, m?.tech].filter(Boolean).join("\n"))
      .join("\n");
    const educationText = education.map((e: any) => [e.head, e.school, e.note].filter(Boolean).join("\n")).join("\n");
    const extrasText = extraSections.map((s) => s.bullets.join("\n")).join("\n");

    const bodyText = [
      summary, skills, experience, projectText, projectMetaText,
      educationText, certs.join("\n"), rightToWork.join("\n"), extrasText,
    ].filter(Boolean).join("\n");

    const hasContactRow = !!(profile?.location || profile?.phone || contactEmail || contactLinkedin || contactGithub);
    const contactLines = 1 + (contactTagline ? 1 : 0) + (hasContactRow ? 1 : 0);
    const headingCount =
      (summary ? 1 : 0) + (skills ? 1 : 0) + (experience ? 1 : 0) +
      (education.length > 0 ? 1 : 0) + (certs.length > 0 ? 1 : 0) +
      (rightToWork.length > 0 ? 1 : 0) + extraSections.length +
      (projectMetaText ? 1 : 0);

    const density = chooseDensity({
      lines: wrappedLines(bodyText) + contactLines,
      paragraphs: bodyText.split("\n").filter((l) => l.trim()).length + contactLines,
      headings: headingCount,
    });

    const children: Paragraph[] = [];

    // Contact header — render only the parts that exist, so empty fields don't
    // leave blank centered lines (spacing bug) or broken empty hyperlinks.
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: contactName, bold: true, size: 40, color: NAVY, font: "Calibri" })] }));
    if (contactTagline) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
        children: [new TextRun({ text: contactTagline, size: 20, color: GREY, font: "Calibri" })] }));
    }
    if (hasContactRow) {
      // One line: location · phone · email (mailto) · LinkedIn · GitHub —
      // only the pieces that exist, each separated by " · ", never a
      // dangling separator for a missing piece. Email gets its own mailto:
      // link built explicitly here — it does NOT go through the S1
      // http/https-only sanitisation below (that gate is for arbitrary
      // profile/link URLs; mailto: is a fixed scheme we construct ourselves
      // from a controlled prefix, not user-suppliable).
      const contactRuns: (TextRun | ExternalHyperlink)[] = [];
      const addContactRun = (run: TextRun | ExternalHyperlink) => {
        if (contactRuns.length > 0) contactRuns.push(new TextRun({ text: " · ", size: 20, font: "Calibri" }));
        contactRuns.push(run);
      };
      if (profile?.location) addContactRun(new TextRun({ text: profile.location, size: 20, font: "Calibri" }));
      if (profile?.phone) addContactRun(new TextRun({ text: profile.phone, size: 20, font: "Calibri" }));
      if (contactEmail) {
        addContactRun(new ExternalHyperlink({
          link: `mailto:${contactEmail}`,
          children: [new TextRun({ text: contactEmail, size: 20, color: LINK, underline: {}, font: "Calibri" })],
        }));
      }
      if (contactLinkedin) {
        addContactRun(new ExternalHyperlink({ link: contactLinkedin, children: [new TextRun({ text: "LinkedIn", size: 20, color: LINK, underline: {}, font: "Calibri" })] }));
      }
      if (contactGithub) {
        addContactRun(new ExternalHyperlink({ link: contactGithub, children: [new TextRun({ text: "GitHub", size: 20, color: LINK, underline: {}, font: "Calibri" })] }));
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
        const projectParas = buildProjects(projectsMeta || [], projects || {}, density);
        return projectParas.length > 0 ? [sectionHeading("Projects", density), ...projectParas] : [];
      },

      education: () => {
        if (education.length === 0) return [];
        const out: Paragraph[] = [sectionHeading("Education", density)];
        for (const e of education) {
          out.push(...datedHeaderParagraph(e.head, e.date, {
            spacingBefore: density.tightAfter,
            spacingAfter: density.tightAfter,
            leftSize: 22,
            dateSize: 20,
            dateColor: GREY,
            dateBold: false,
          }));
          out.push(new Paragraph({ spacing: { after: density.tightAfter }, children: [new TextRun({ text: e.school, size: 21, font: "Calibri" })] }));
          // e.note can hold multiple bullets, one per line — a paragraph per
          // line, not one paragraph for the whole blob.
          if (e.note?.trim()) {
            for (const n of e.note.split("\n")) {
              if (!n.trim()) continue;
              out.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: n.trim(), size: 20, font: "Calibri" })] }));
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
      children.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, children: [new TextRun({ text: c, size: 21, font: "Calibri" })] }));
    }
  }

    // Right to Work
    if (rightToWork.length > 0) {
    children.push(sectionHeading("Right to Work", density));
    for (const r of rightToWork) {
      children.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, children: [new TextRun({ text: r, size: 21, font: "Calibri" })] }));
    }
  }

    // Pass-through sections (e.g. Recognitions, Awards) — verbatim, never tailored
    for (const sec of extraSections) {
      children.push(sectionHeading(sec.title, density));
      for (const b of sec.bullets) {
        children.push(new Paragraph({ spacing: { after: density.bulletAfter }, numbering: { reference: "default-bullet", level: 0 }, children: [new TextRun({ text: b, size: 21, font: "Calibri" })] }));
      }
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
      numbering: { config: [{ reference: "default-bullet", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } } } }] }] },
      sections: [{ properties: { page: { size: { width: 11906, height: PAGE_HEIGHT }, margin: { top: density.margin, right: density.margin, bottom: density.margin, left: density.margin } } }, children }],
    });

    const buffer = await Packer.toBuffer(doc);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Download error:", error instanceof Error ? error.message : "Unknown error");
    return new Response(JSON.stringify({ error: "Failed to generate document" }), { status: 500 });
  }
}