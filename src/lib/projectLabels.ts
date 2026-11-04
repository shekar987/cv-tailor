// A project's own label on its CV heading (4 Nov 2026, Chunk 12), read from the
// user's own CV and never written into code: "RideX" printed without "personal
// portfolio project modelled on a real-world brief" reads as paid work. The label is
// the first segment of the line under the project's heading when it says what kind of
// project it is. Tests in tests/projectLabels; runs under node:test and in the browser.
//
// The same reading sits on the unmerged PR #10 (lib/autoFix): whichever merges second
// keeps this module and drops the copy.
import { projectKey } from "./projectLinks.ts";
import { splitTrailingDate } from "./projectDate.ts";

const PROJECTS_HEADING = /^(?:(?:personal|selected|key|side)\s+)?projects\s*:?$|^portfolio\s*:?$/i;
const OTHER_HEADING = /^(?:(?:professional\s+)?summary|profile|objective|about(?:\s+me)?|(?:technical|core|key\s+)?\s*(?:skills|competencies|technologies)|(?:work|professional|relevant)?\s*experience|employment(?:\s+history)?|education|qualifications|certifications?|awards|publications|languages|interests|volunteering|references|right\s+to\s+work)\s*:?$/i;
const BULLET = /^\s*[•\-*·▪◦–]\s*/;
const LINK_LINE = /^(?:github|gitlab|linkedin|portfolio|website|live|demo|url|links?)\b[^:]*:/i;
const MAX_LABEL_WORDS = 14;
// "Personal portfolio project" says what kind it is; "Beta Project" is a title.
const LABEL_SHAPED = /^(?:personal|portfolio|side|solo|university|academic|group|team|open[- ]source|freelance|client|final[- ]year|research|dissertation|hackathon)\b.*\bproject\b/i;
const BRACKETED_DATE = /\s*\(((?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}(?:\s*(?:[–—-]|to)\s*(?:(?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present))?)\)\s*$/i;

// The lines of the projects section, raw: a short title like "Delta Tool" must stay a
// line here, where the registry seed's section reader takes it for a heading. A pool
// has no heading, so every line of it is a project's.
function projectLines(source: string): string[] {
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => PROJECTS_HEADING.test(l));
  if (start < 0) return lines;
  const end = lines.findIndex((l, i) => i > start && OTHER_HEADING.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** Each project's label, keyed as lib/projectLinks keys a project, so a pool's longer title is the same project. */
export function projectLabels(...sources: (string | null | undefined)[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const source of sources) {
    const lines = projectLines(source ?? "");
    for (let i = 1; i < lines.length; i++) {
      const segment = lines[i].split("|")[0].trim();
      const prior = lines[i - 1];
      if (BULLET.test(lines[i]) || BULLET.test(prior) || !LABEL_SHAPED.test(segment) || segment.split(/\s+/).length > MAX_LABEL_WORDS) continue;
      // A project's own heading is not a label: it has a date, and the line above it
      // has already said its tech or its links.
      if (splitTrailingDate(lines[i]).date || /\btech(?:nologies)?\s*:/i.test(prior) || LINK_LINE.test(prior)) continue;
      const key = projectKey(prior);
      if (!key || labels.has(key)) continue;
      labels.set(key, /^[A-Z][A-Z]/.test(segment) ? segment : segment.charAt(0).toLowerCase() + segment.slice(1));
    }
  }
  return labels;
}

/** "RideX — Ride-Hailing Platform | 2025" with its label in brackets; unchanged when the CV gives none. */
export function labelProjectName(name: string, labels: Map<string, string>): string {
  const [head, ...rest] = name.split(" | ");
  const split = rest.length > 0 ? { title: head, date: "" } : splitTrailingDate(head);
  const dated = split.date ? null : BRACKETED_DATE.exec(split.title);
  const title = dated ? split.title.slice(0, dated.index).trim() : split.title;
  const date = split.date || dated?.[1] || "";
  const label = labels.get(projectKey(title));
  if (!label || title.toLowerCase().includes(label.toLowerCase())) return name;
  const bare = title.replace(/\s*\([^()]*\bproject\b[^()]*\)/i, "").trim();
  return [`${bare} (${label})`, ...(date ? [date] : []), ...rest].join(" | ");
}

/**
 * A heading's title and its bracketed label, for the two builders: the label prints on
 * its own line under the heading, so a long one never pushes the date off the first row.
 */
export function splitProjectLabel(title: string): { head: string; label: string } {
  const m = /^(.*\S)\s*(\([^()]*\bproject\b[^()]*\))\s*$/i.exec(title);
  return m ? { head: m[1], label: m[2] } : { head: title, label: "" };
}

/** The same projects with their labels on; the same array when nothing changed. */
export function withProjectLabels<P extends { name?: unknown }>(projects: P[], labels: Map<string, string>): P[] {
  if (labels.size === 0) return projects;
  let changed = false;
  const out = projects.map((p) => {
    if (typeof p?.name !== "string") return p;
    const name = labelProjectName(p.name, labels);
    if (name === p.name) return p;
    changed = true;
    return { ...p, name };
  });
  return changed ? out : projects;
}
