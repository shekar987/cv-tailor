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

const CONTACT = {
  name: "SOMA SHEKAR KEESARI",
  tagline: "MSc Computer Science, University of East London | 2+ YoE | Java & Spring Boot | Full Stack Engineer",
  line1: "London, UK | +44 7553 449836 | somashekarkeesari18@gmail.com",
  linkedin: "https://www.linkedin.com/in/shekar-keesari-4bbaa6234/",
  github: "https://github.com/shekar987",
};

const EDUCATION = [
  { head: "MSc Computer Science (Industrial Placement)", date: "Jan 2025 – Jan 2027", school: "University of East London", note: "AWS-accredited programme focused on Software Engineering, Cloud Computing, and AI applications." },
  { head: "BSc Computer Science, Distinction", date: "Jul 2019 – Jul 2023", school: "Keshav Memorial Institute of Technology, India", note: "Graduated with Distinction; coursework in Data Structures, OOP, Databases, and Software Engineering." },
];

const CERTS = [
  "AWS Certified Cloud Practitioner — Amazon Web Services",
  "Java Developer Certificate — CodSoft",
];

const RIGHT_TO_WORK = [
  "Full-time work authorised during MSc Industrial Placement.",
  "Eligible for the UK Graduate Route visa upon MSc completion in January 2027.",
];

const PROJECTS_META = [
  {
    key: "ridex",
    name: "RideX — Full-Stack Ride-Hailing Platform",
    tech: "React 19, Firebase, Stripe, Mapbox, Vercel",
    links: [
      { label: "Live: ", url: "https://uber-demo-omega.vercel.app", text: "uber-demo-omega.vercel.app" },
      { label: "Code: ", url: "https://github.com/shekar987/RideX-app", text: "github.com/shekar987/RideX-app" },
    ],
  },
  {
    key: "financial",
    name: "AI-Powered Financial Analysis System",
    tech: "Python, Anthropic Claude API, pandas",
    links: [
      { label: "Code: ", url: "https://github.com/shekar987/finsight-financial-chatbot", text: "github.com/shekar987/finsight-financial-chatbot" },
    ],
  },
];

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

function buildProjects(projectsData: ProjectsPayload): Paragraph[] {
  const out: Paragraph[] = [];
  for (const meta of PROJECTS_META) {
const raw = projectsData?.[meta.key];
    const bullets: string[] = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    if (bullets.length === 0) continue;

    // Title (bold, fixed)
    out.push(new Paragraph({
      spacing: { before: 160, after: 20 },
      children: [new TextRun({ text: meta.name, bold: true, size: 22, font: "Calibri" })],
    }));
    // Tech stack (same style as body)
    out.push(new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: meta.tech, size: 21, font: "Calibri" })],
    }));
    // Links (fixed, clickable)
    const linkRuns: (TextRun | ExternalHyperlink)[] = [];
    meta.links.forEach((l, i) => {
      if (i > 0) linkRuns.push(new TextRun({ text: "   |   ", size: 21, font: "Calibri" }));
      linkRuns.push(new TextRun({ text: l.label, size: 21, font: "Calibri" }));
      linkRuns.push(
        new ExternalHyperlink({
          link: l.url,
          children: [new TextRun({ text: l.text, size: 21, color: LINK, underline: {}, font: "Calibri" })],
        })
      );
    });
    out.push(new Paragraph({ spacing: { after: 60 }, children: linkRuns }));
    // Bullets (tailored, from chain)
    for (const b of bullets) {
      out.push(new Paragraph({
        spacing: { after: 80 },
        alignment: AlignmentType.JUSTIFIED,
        numbering: { reference: "default-bullet", level: 0 },
        children: buildRuns(b.replace(/^[-•]\s*/, ""), { size: 21 }),
      }));
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { summary, skills, experience, projects, companyName, roleTitle, profile } = await req.json();

// Use the user's profile if provided; fall back to hardcoded for safety
const contactName = profile?.name || CONTACT.name;
const contactTagline = profile?.tagline || CONTACT.tagline;
const contactLine = [profile?.location, profile?.phone, profile?.email].filter(Boolean).join(" | ") || CONTACT.line1;
const contactLinkedin = profile?.linkedin
  ? (profile.linkedin.startsWith("http") ? profile.linkedin : "https://" + profile.linkedin)
  : CONTACT.linkedin;
const contactGithub = profile?.github
  ? (profile.github.startsWith("http") ? profile.github : "https://" + profile.github)
  : CONTACT.github;
const education = (profile?.education && profile.education.length > 0)
  ? profile.education.map((e: any) => ({ head: e.degree, date: e.dates, school: e.institution, note: e.note }))
  : EDUCATION;
const certs = (profile?.certifications && profile.certifications.length > 0) ? profile.certifications : CERTS;
const rightToWork = (profile?.rightToWork && profile.rightToWork.length > 0) ? profile.rightToWork : RIGHT_TO_WORK;

    // Build a safe filename: FirstName_CompanyName_RoleName_CV.docx
    const firstName = "Soma_Shekar"; // first name (already underscore-joined) // from your master CV
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
    if (projects) { children.push(sectionHeading("Projects")); children.push(...buildProjects(projects)); }

    // Education 
    if (education.length > 0) {
    children.push(sectionHeading("Education"));
     for (const e of education){
      children.push(new Paragraph({ spacing: { before: 60, after: 20 }, tabStops: [{ type: "right" as any, position: 9026 }],
        children: [ new TextRun({ text: e.head, bold: true, size: 22, font: "Calibri" }), new TextRun({ text: "\t" + e.date, size: 20, color: GREY, font: "Calibri" }) ] }));
      children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: e.school, size: 21, font: "Calibri" })] }));
      children.push(new Paragraph({ spacing: { after: 60 }, numbering: { reference: "default-bullet", level: 0 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: e.note, size: 20, font: "Calibri" })] }));
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