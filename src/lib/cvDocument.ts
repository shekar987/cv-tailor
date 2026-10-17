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
import { linksText, displayUrl } from "./projectLinks.ts";
import { cleanTagline, type ExtraSection, type Profile } from "./profile.ts";
import { RENDER_OPTIONS, normalizeFormatStyle, type RenderOptions } from "./formatStyles/ids.ts";

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
  // The run's format style (lib/formatStyles ids): how the contact line is
  // drawn. Anything but "careerset" is UKJI.
  formatStyle?: unknown;
};

// One piece of the contact line: the text to print and the link behind it.
export type ContactPiece = { text: string; link: string | null };

export type CvDocument = {
  contact: CvContact;
  render: RenderOptions;
  // The contact line's pieces in order, as the style draws them.
  contactPieces: ContactPiece[];
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

// The contact line's pieces, in order, only the ones that exist. UKJI prints
// a link's label ("LinkedIn", "GitHub", "Portfolio") with the address behind
// it; CareerSet prints the address itself ("linkedin.com/in/jane"), still
// linked — a parser reading the document finds the details either way, and
// the owner's university tool could not find them behind the labels.
export function contactPieces(contact: CvContact, render: RenderOptions): ContactPiece[] {
  const addresses = render.contactLinks === "addresses";
  const out: ContactPiece[] = [];
  if (contact.location) out.push({ text: contact.location, link: null });
  if (contact.phone) out.push({ text: contact.phone, link: null });
  if (contact.email) out.push({ text: contact.email, link: `mailto:${contact.email}` });
  if (contact.linkedin) out.push({ text: addresses ? displayUrl(contact.linkedin) : "LinkedIn", link: contact.linkedin });
  if (contact.github) out.push({ text: addresses ? displayUrl(contact.github) : "GitHub", link: contact.github });
  if (contact.website) out.push({ text: addresses ? displayUrl(contact.website) : "Portfolio", link: contact.website });
  return out;
}

// The contact line as text, for the line arithmetic (lib/quality agrees).
export function contactRowText(pieces: ContactPiece[], render: RenderOptions): string {
  return pieces.map((p) => p.text).join(render.contactSeparator);
}

// How many lines the contact row takes in the layout maths: one, as always,
// with labels; printed addresses can wrap, so they are counted.
export function contactRowLines(pieces: ContactPiece[], render: RenderOptions): number {
  if (pieces.length === 0) return 0;
  return render.contactLinks === "addresses" ? Math.max(1, wrappedLines(contactRowText(pieces, render))) : 1;
}

export function prepareCvDocument(input: CvDocumentInput): CvDocument {
  const { profile, summary, skills, experience, projects, projectsMeta, targetPages } = input;
  const render = RENDER_OPTIONS[normalizeFormatStyle(input.formatStyle)];

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
  const pieces = contactPieces(contact, render);

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

  const contactLines = 1 + (contact.tagline ? 1 : 0) + contactRowLines(pieces, render);
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

  return { contact, render, contactPieces: pieces, education, certs, rightToWork, extraSections, density };
}
