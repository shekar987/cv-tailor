// What both CV builders work out before drawing anything: the contact header
// pieces, the profile's lists, and the spacing (lib/cvDensity) chosen from how
// much text there is for the target page count.
//
// The .docx route and lib/buildCvPdf used to carry this as two copies, ~45
// lines each, that had to stay in lockstep by hand — CLAUDE.md asks the PDF
// to mirror the docx function for function, and this was the piece most
// likely to drift. One pass, so the Word and PDF files of the same CV can
// never measure it differently.
//
// Import-free except for its siblings (relative .ts paths), so tests/ can run
// it under node:test.
import { chooseDensity, wrappedLines, type Density } from "./cvDensity.ts";
import { filterExtraSections } from "./sections.ts";
import { linksText } from "./projectLinks.ts";
import { cleanTagline, type ExtraSection, type Profile } from "./profile.ts";

export type CvContact = {
  name: string;
  tagline: string;
  location: string;
  phone: string;
  email: string;
  linkedin: string;
  github: string;
  website: string;
  /** Whether the contact line under the name has anything to show. */
  hasRow: boolean;
};

export type CvEducationEntry = { head: string; date: string; school: string; note: string };

export type CvDocumentInput = {
  /** Already normalised (lib/profile normalizeProfile) — missing fields are "". */
  profile: Profile;
  summary: string;
  skills: string;
  experience: string;
  /** The tailored project bullets, keyed by project index. */
  projects: Record<string, unknown>;
  projectsMeta: unknown[];
  targetPages: 1 | 2;
};

export type CvDocument = {
  contact: CvContact;
  education: CvEducationEntry[];
  certs: string[];
  rightToWork: string[];
  extraSections: ExtraSection[];
  density: Density;
};

/** A stored address as a link target: "github.com/x" → "https://github.com/x". */
export function ensureHttps(address: string): string {
  return address.startsWith("http") ? address : "https://" + address;
}

type ProjectMeta = { name?: unknown; tech?: unknown; links?: unknown } | null | undefined;

export function prepareCvDocument(input: CvDocumentInput): CvDocument {
  const { profile, summary, skills, experience, projects, projectsMeta, targetPages } = input;

  const email = profile.email;
  const linkedin = profile.linkedin ? ensureHttps(profile.linkedin) : "";
  const github = profile.github ? ensureHttps(profile.github) : "";
  const website = profile.website ? ensureHttps(profile.website) : "";
  const contact: CvContact = {
    name: profile.name,
    tagline: cleanTagline(profile.tagline),
    location: profile.location,
    phone: profile.phone,
    email,
    linkedin,
    github,
    website,
    hasRow: !!(profile.location || profile.phone || email || linkedin || github || website),
  };

  const education: CvEducationEntry[] = profile.education.map((e) => ({
    head: e.degree,
    date: e.dates,
    school: e.institution,
    note: e.note,
  }));
  const certs = profile.certifications;
  const rightToWork = profile.rightToWork;
  const extraSections = filterExtraSections(profile.extraSections);

  // Size the content before laying it out, so the spacing can be chosen to
  // fill the target pages rather than either cramming or leaving the last
  // page half empty.
  const projectText = Object.values(projects)
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .join("\n");
  const projectMetaText = projectsMeta
    .map((m) => {
      const meta = m as ProjectMeta;
      return [meta?.name, meta?.tech, linksText(meta?.links)].filter(Boolean).join("\n");
    })
    .join("\n");
  const educationText = education.map((e) => [e.head, e.school, e.note].filter(Boolean).join("\n")).join("\n");
  const extrasText = extraSections.map((s) => s.bullets.join("\n")).join("\n");
  const bodyText = [
    summary, skills, experience, projectText, projectMetaText,
    educationText, certs.join("\n"), rightToWork.join("\n"), extrasText,
  ].filter(Boolean).join("\n");

  const contactLines = 1 + (contact.tagline ? 1 : 0) + (contact.hasRow ? 1 : 0);
  const headingCount =
    (summary ? 1 : 0) + (skills ? 1 : 0) + (experience ? 1 : 0) +
    (education.length > 0 ? 1 : 0) + (certs.length > 0 ? 1 : 0) +
    (rightToWork.length > 0 ? 1 : 0) + extraSections.length +
    (projectMetaText ? 1 : 0);

  const density = chooseDensity({
    lines: wrappedLines(bodyText) + contactLines,
    paragraphs: bodyText.split("\n").filter((l) => l.trim()).length + contactLines,
    headings: headingCount,
  }, targetPages);

  return { contact, education, certs, rightToWork, extraSections, density };
}
