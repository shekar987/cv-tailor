import { NextRequest } from "next/server";
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


function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 3 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24, color: NAVY, font: "Calibri" })],
  });
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
function textToParagraphs(text: string, mode: "plain" | "skills" = "plain"): Paragraph[] {
  if (!text) return [];
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !/^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE)\s*$/i.test(line.trim()))
    .map((line) => {
      const trimmed = line.trim();
      // Job header line: "@@JOB@@role@@date" → bold role left, bold date right
      if (trimmed.startsWith("@@JOB@@")) {
        const parts = trimmed.replace("@@JOB@@", "").split("@@");
        const role = parts[0] || "";
        const date = parts[1] || "";
        return new Paragraph({
          spacing: { before: 140, after: 40 },
          tabStops: [{ type: "right" as any, position: 9026 }],
          children: [
            new TextRun({ text: role, bold: true, size: 21, font: "Calibri" }),
            new TextRun({ text: "\t" + date, bold: true, size: 21, font: "Calibri" }),
          ],
        });
      }
      
      const isBullet = trimmed.startsWith("•") || trimmed.startsWith("-");
      const clean = isBullet ? trimmed.replace(/^[•\-]\s*/, "") : trimmed;

      // Skills: bold only the label before the first colon
      if (mode === "skills" && !isBullet && clean.includes(":")) {
        const idx = clean.indexOf(":");
        const label = clean.slice(0, idx + 1);
        const rest = clean.slice(idx + 1);
        return new Paragraph({
          spacing: { after: 80 },
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: label, bold: true, size: 21, font: "Calibri" }),
            ...buildRuns(rest, { size: 21 }),
          ],
        });
      }

      return new Paragraph({
        spacing: { after: 80 },
        alignment: AlignmentType.JUSTIFIED,
        ...(isBullet ? { numbering: { reference: "default-bullet", level: 0 } } : {}),
        children: buildRuns(clean, { size: 21 }),
      });
    });
}

// Projects: fixed name/tech/links from PROJECTS_META + tailored bullets from the chain (object form).
type ProjectsPayload = Record<string, unknown>;

// Build projects from the user's project metadata + tailored bullets (keyed by index).
function buildProjects(projectsMeta: any[], tailoredBullets: any): Paragraph[] {
  const out: Paragraph[] = [];
  if (!Array.isArray(projectsMeta) || projectsMeta.length === 0) return out;

  projectsMeta.forEach((meta, idx) => {
    const tailored = tailoredBullets?.[String(idx)];
    const bullets: string[] = (Array.isArray(tailored) && tailored.length > 0)
      ? tailored
      : (Array.isArray(meta.originalBullets) ? meta.originalBullets : []);

    if (!meta.name && bullets.length === 0) return;

    // Title (bold)
    out.push(new Paragraph({
      spacing: { before: 160, after: 20 },
      children: [new TextRun({ text: meta.name || "", bold: true, size: 22, font: "Calibri" })],
    }));
    // Tech (same style as body)
    if (meta.tech) {
      out.push(new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: meta.tech, size: 21, font: "Calibri" })],
      }));
    }
    // Links (clickable)
    if (Array.isArray(meta.links) && meta.links.length > 0) {
      const linkRuns: (TextRun | ExternalHyperlink)[] = [];
      meta.links.forEach((l: any, i: number) => {
        if (i > 0) linkRuns.push(new TextRun({ text: "   |   ", size: 21, font: "Calibri" }));
        if (l.label) linkRuns.push(new TextRun({ text: l.label, size: 21, font: "Calibri" }));
        const url = l.url && l.url.startsWith("http") ? l.url : "https://" + (l.url || "");
        linkRuns.push(new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: l.text || l.url || "", size: 21, color: LINK, underline: {}, font: "Calibri" })],
        }));
      });
      out.push(new Paragraph({ spacing: { after: 60 }, children: linkRuns }));
    }
    // Bullets
    for (const b of bullets) {
      out.push(new Paragraph({
        spacing: { after: 80 },
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
const { summary, skills, experience, projects, projectsMeta, companyName, roleTitle, profile } = await req.json();
// Always use profile data exclusively. Missing fields render blank — never fall back to owner data.
const contactName = profile?.name || "";
const contactTagline = profile?.tagline ?? "";
const contactLine = [profile?.location, profile?.phone, profile?.email].filter(Boolean).join(" | ");
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

    // Build a safe filename: FirstName_CompanyName_RoleName_CV.docx
    const firstName = (profile?.name || "").trim().split(/\s+/).slice(0, 2).join("_") || "User";
    const clean = (s: string) =>
      (s || "")
        .replace(/[^a-zA-Z0-9]+/g, "_") // non-alphanumeric → underscore
        .replace(/^_+|_+$/g, "")        // trim leading/trailing underscores
        .slice(0, 40);                  // keep it reasonable
    const parts = [firstName, clean(companyName), clean(roleTitle), "CV"].filter(Boolean);
    const filename = parts.join("_") + ".docx";
    const children: Paragraph[] = [];

    // Contact header
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: contactName, bold: true, size: 40, color: NAVY, font: "Calibri" })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: contactTagline, size: 20, color: GREY, font: "Calibri" })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: contactLine, size: 20, font: "Calibri" })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [
        new ExternalHyperlink({ link: contactLinkedin, children: [new TextRun({ text: "LinkedIn", size: 20, color: LINK, underline: {}, font: "Calibri" })] }),
        new TextRun({ text: "  |  ", size: 20, font: "Calibri" }),
        new ExternalHyperlink({ link: contactGithub, children: [new TextRun({ text: "GitHub", size: 20, color: LINK, underline: {}, font: "Calibri" })] }),
      ] }));

    // Tailored sections
    if (summary) { children.push(sectionHeading("Professional Summary")); children.push(...textToParagraphs(summary, "plain")); }
    if (skills) { children.push(sectionHeading("Skills")); children.push(...textToParagraphs(skills, "skills")); }
    if (experience) { children.push(sectionHeading("Experience")); children.push(...textToParagraphs(experience, "plain")); }
    const projectParas = buildProjects(projectsMeta || [], projects || {});
    if (projectParas.length > 0) {
      children.push(sectionHeading("Projects"));
      children.push(...projectParas);
    }
    // Education 
    if (education.length > 0) {
    children.push(sectionHeading("Education"));
     for (const e of education){
      children.push(new Paragraph({ spacing: { before: 60, after: 20 }, tabStops: [{ type: "right" as any, position: 9026 }],
        children: [ new TextRun({ text: e.head, bold: true, size: 22, font: "Calibri" }), new TextRun({ text: e.date ? "\t" + e.date : "", size: 20, color: GREY, font: "Calibri" }) ] }));
      children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: e.school, size: 21, font: "Calibri" })] }));
      if (e.note?.trim()) {
        children.push(new Paragraph({ spacing: { after: 60 }, numbering: { reference: "default-bullet", level: 0 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: e.note, size: 20, font: "Calibri" })] }));
      }
    }
  }

    // Certifications 
    if (certs.length > 0) {
    children.push(sectionHeading("Certifications"));
    for (const c of certs) {
      children.push(new Paragraph({ spacing: { after: 40 }, numbering: { reference: "default-bullet", level: 0 }, children: [new TextRun({ text: c, size: 21, font: "Calibri" })] }));
    }
  }

    // Right to Work 
    if (rightToWork.length > 0) {
    children.push(sectionHeading("Right to Work"));
    for (const r of rightToWork) {
      children.push(new Paragraph({ spacing: { after: 40 }, numbering: { reference: "default-bullet", level: 0 }, children: [new TextRun({ text: r, size: 21, font: "Calibri" })] }));
    }
  }

    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
      numbering: { config: [{ reference: "default-bullet", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } } } }] }] },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }],
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
    console.error("Download error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate document" }), { status: 500 });
  }
}