// The extracted-profile shape, and the coercion that guarantees it.
//
// The profile is produced by a model (/api/extract-profile), stored as JSON,
// and later read by the download routes as `profile.education.map(...)` and
// friends. A model that returns `"education": {}` or `"certifications":
// "None"` would otherwise crash every download for that user. Normalising
// at the boundary — on extraction and again when a document is built — makes
// every field the type the renderers assume. Project positions are preserved
// (never filtered) because tailored bullets are keyed by project index.

export type Education = { degree: string; dates: string; institution: string; note: string };
export type ProjectLink = { label: string; url: string; text: string };
export type CvProject = { name: string; tech: string; links: ProjectLink[]; originalBullets: string[] };
export type ExtraSection = { title: string; bullets: string[] };
export type Profile = {
  name: string; tagline: string; location: string; phone: string;
  email: string; linkedin: string; github: string; website: string;
  education: Education[]; certifications: string[];
  projects: CvProject[]; rightToWork: string[];
  // Pass-through sections not covered by the named fields (e.g. RECOGNITIONS,
  // AWARDS, PUBLICATIONS). Never tailored — rendered verbatim after Right to Work.
  extraSections?: ExtraSection[];
};

// A professional headline never carries contact/social URLs. When the extractor
// mis-files the CV's contact line into the tagline, the GitHub/LinkedIn URL
// would render as the headline AND again as the link under it — the "GitHub
// twice" bug. Strips URL/social forms only: bare words like "GitHub Actions"
// stay. One function for the preview, the .docx and the PDF (each used to
// carry its own copy).
export function cleanTagline(tagline: string): string {
  let t = (tagline || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?(?:linkedin|github)\.com\/?\S*/gi, " ")
    .replace(/\b(?:LinkedIn|GitHub)\s*:/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Separators left at either edge once the URLs are gone ("Engineer | | ").
  // Until stable: one pass left "Backend Engineer |" behind a second bar.
  for (;;) {
    const next = t.replace(/^[|•·,\-–—]+\s*|\s*[|•·,\-–—]+$/g, "").trim();
    if (next === t) return t;
    t = next;
  }
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max = 500): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function strList(value: unknown, maxItems: number, maxEach: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v, maxEach)).filter(Boolean).slice(0, maxItems);
}

// A certification's vendor names and titles as the vendors write them —
// extraction returned "Aws Certified Ai practitioner" and "Cloud Computing-
// NPTEL" (30 Sep audit). A small allow-list, never a guess: only the names
// listed change case, "Practitioner"/"Associate"/"Professional" only after a
// vendor's own qualifier, and a trailing "- Provider" becomes "(Provider)".
const CERT_NAMES: [RegExp, string][] = [
  [/\baws\b/gi, "AWS"],
  [/\bgcp\b/gi, "GCP"],
  [/\bnptel\b/gi, "NPTEL"],
  [/\bibm\b/gi, "IBM"],
  [/\bcomptia\b/gi, "CompTIA"],
  [/\bazure\b/gi, "Azure"],
  [/\bmicrosoft\b/gi, "Microsoft"],
  [/\bgoogle\b/gi, "Google"],
  [/\bcisco\b/gi, "Cisco"],
  [/\bcoursera\b/gi, "Coursera"],
  [/\budemy\b/gi, "Udemy"],
  [/\bedx\b/gi, "edX"],
  [/\bhackerrank\b/gi, "HackerRank"],
  [/\bleetcode\b/gi, "LeetCode"],
];
const CERT_TITLES: [RegExp, string][] = [
  [/\b(ai|cloud|machine learning|data engineer|developer|solutions architect|sysops administrator|devops engineer)\s+(practitioner|associate|professional|specialty)\b/gi, "$1 $2"],
];
const CERT_PROVIDER_TAIL = /\s*[-–—|]\s*\(?(nptel|coursera|udemy|edx|ibm|google|microsoft|aws|linkedin learning)\)?\s*$/i;
const TITLE_WORDS: Record<string, string> = { ai: "AI", cloud: "Cloud", "machine learning": "Machine Learning", "data engineer": "Data Engineer", developer: "Developer", "solutions architect": "Solutions Architect", "sysops administrator": "SysOps Administrator", "devops engineer": "DevOps Engineer", practitioner: "Practitioner", associate: "Associate", professional: "Professional", specialty: "Specialty" };
export function normalizeCertification(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  for (const [re, to] of CERT_NAMES) s = s.replace(re, to);
  for (const [re] of CERT_TITLES) s = s.replace(re, (_m, a: string, b: string) => `${TITLE_WORDS[a.toLowerCase()] ?? a} ${TITLE_WORDS[b.toLowerCase()] ?? b}`);
  s = s.replace(/\bcertified\b/gi, "Certified");
  s = s.replace(CERT_PROVIDER_TAIL, (_m, provider: string) => {
    let p = provider;
    for (const [re, to] of CERT_NAMES) p = p.replace(re, to);
    if (/^linkedin learning$/i.test(p)) p = "LinkedIn Learning";
    return ` (${p})`;
  });
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeProfile(input: unknown): Profile {
  const p = obj(input);

  const education: Education[] = Array.isArray(p.education)
    ? p.education
        .map((e) => {
          const o = obj(e);
          return { degree: str(o.degree, 300), dates: str(o.dates, 100), institution: str(o.institution, 300), note: str(o.note, 2000) };
        })
        .filter((e) => e.degree || e.institution)
        .slice(0, 20)
    : [];

  const projects: CvProject[] = Array.isArray(p.projects)
    ? p.projects.slice(0, 20).map((pr) => {
        const o = obj(pr);
        const links: ProjectLink[] = Array.isArray(o.links)
          ? o.links
              .map((l) => {
                const lo = obj(l);
                return { label: str(lo.label, 60), url: str(lo.url, 500), text: str(lo.text, 200) };
              })
              .filter((l) => l.url || l.text)
              .slice(0, 6)
          : [];
        return { name: str(o.name, 300), tech: str(o.tech, 500), links, originalBullets: strList(o.originalBullets, 12, 600) };
      })
    : [];

  const extraSections: ExtraSection[] = Array.isArray(p.extraSections)
    ? p.extraSections
        .map((s) => {
          const o = obj(s);
          return { title: str(o.title, 100), bullets: strList(o.bullets, 30, 600) };
        })
        .filter((s) => s.title && s.bullets.length > 0)
        .slice(0, 10)
    : [];

  return {
    name: str(p.name, 200),
    tagline: str(p.tagline, 300),
    location: str(p.location, 200),
    phone: str(p.phone, 60),
    email: str(p.email, 200),
    linkedin: str(p.linkedin, 300),
    github: str(p.github, 300),
    website: str(p.website, 300),
    education,
    certifications: strList(p.certifications, 30, 300).map(normalizeCertification),
    projects,
    rightToWork: strList(p.rightToWork, 10, 300),
    extraSections,
  };
}
