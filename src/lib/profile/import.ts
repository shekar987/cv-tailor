// The rule-based importer: a master CV (plain text) → a StructuredProfile, with
// NO model call. Everything it cannot confidently place goes into `unmapped[]`
// — never dropped, never guessed — for the owner to file by hand in the editor.
//
// Deterministic and import-free apart from the schema (relative, with the
// extension Node's test runner needs). `scripts/build-profile.ts` is the thin
// CLI around `buildStructuredProfile`.

import {
  normalizeStructuredProfile,
  type StructuredProfile,
  type ExperienceEntry,
  type ProjectFact,
  type SkillFact,
  type EducationFact,
  type CertificationFact,
  type SummaryFact,
  type Bullet,
  type Metric,
  type Direction,
  type SkillTier,
  type SkillEvidence,
  type Source,
} from "./schema.ts";

export type ImportResult = { profile: StructuredProfile; problems: string[] };

type SectionType = "summary" | "experience" | "projects" | "skills" | "education" | "certifications" | "other";
type RawLine = { line: number; text: string };

const HEADING_RE = /^\s*[A-Z][A-Z0-9 &/()'.-]{1,48}:?\s*$/;
const BULLET_RE = /^\s*[-•*▪●‣]\s+/;
const DATE_RANGE_RE = /(?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present|current|now)/i;
const TECH_LINE_RE = /^\s*(?:tech(?:nologies)?|tech\s*stack|tools|stack|built\s*with)\s*:/i;

function classifyHeading(h: string): SectionType {
  const t = h.toLowerCase().replace(/[^a-z ]/g, " ");
  if (/\b(summary|profile|about|objective)\b/.test(t)) return "summary";
  if (/\b(experience|employment|work history|career)\b/.test(t)) return "experience";
  if (/\bprojects?\b/.test(t)) return "projects";
  if (/\bskills?\b/.test(t) || /competenc/.test(t)) return "skills";
  if (/\beducation\b/.test(t)) return "education";
  if (/certif/.test(t) || /\bcerts\b/.test(t)) return "certifications";
  return "other";
}

function stripBullet(s: string): string {
  return s.replace(BULLET_RE, "").trim();
}

function splitItems(s: string): string[] {
  return s
    .split(/[,|•·;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ── Metrics ───────────────────────────────────────────────────────────────────

const FIGURE_RE = /(?<![\w.])([£$€])?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%|x|k|m|bn|ms)?/gi;
const DOWN_VERB = /\b(cut|cuts|cutting|reduc|decreas|lower|drop|slash|shrank|shrink|trimm?|minimi[sz])/i;
const UP_VERB = /\b(increas|improv|grew|grow|rais|boost|doubl|tripl|accelerat|sped up|speed up)/i;
const ACTION_VERB = /^(?:cut|built|made|ran|led|grew|won|set)$/i;
const STOP_AFTER = new Set([
  "through", "with", "by", "across", "in", "for", "to", "and", "on", "of", "using", "via", "from", "over", "while", "after",
]);

function directionOf(text: string): Direction {
  if (DOWN_VERB.test(text)) return "down";
  if (UP_VERB.test(text)) return "up";
  return "none";
}

function labelFor(text: string, matchIndex: number, matched: string): string {
  const before = text.slice(0, matchIndex);
  if (/\bby\s*$/i.test(before)) {
    const phrase = before.replace(/\s*\bby\s*$/i, "").trim();
    const words = phrase.split(/\s+/).filter(Boolean).slice(-3);
    // Drop a leading action verb ("Cut deployment time" → "deployment time",
    // "reducing query time" → "query time"), but keep a plain noun ("API").
    if (words.length > 1 && (ACTION_VERB.test(words[0]) || /(?:ed|ing)$/i.test(words[0]))) words.shift();
    return cleanLabel(words.join(" "));
  }
  const after = text.slice(matchIndex + matched.length).trim();
  const out: string[] = [];
  for (const w of after.split(/\s+/)) {
    const bare = w.replace(/[^\w]/g, "").toLowerCase();
    if (!bare || STOP_AFTER.has(bare)) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  return cleanLabel(out.join(" "));
}

function cleanLabel(s: string): string {
  return s.replace(/[.,;:]+$/g, "").replace(/\s+/g, " ").trim();
}

function metricsOf(text: string, bulletId: string, source: Source): Metric[] {
  const metrics: Metric[] = [];
  const dir = directionOf(text);
  FIGURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIGURE_RE.exec(text))) {
    const cur = m[1] || "";
    const digits = m[2];
    const tail = m[3] || "";
    // A bare four-digit year (no unit) is a date, not a metric.
    if (!tail && !cur && /^(?:19|20)\d{2}$/.test(digits)) continue;
    const value = `${cur}${digits}${tail}`;
    const unit = tail || cur;
    metrics.push({
      id: `${bulletId}m${metrics.length + 1}`,
      label: labelFor(text, m.index, m[0]),
      value,
      unit,
      direction: dir,
      source,
    });
  }
  return metrics;
}

function makeBullet(id: string, raw: RawLine, section: string): Bullet {
  const text = stripBullet(raw.text);
  const source: Source = { section, line: raw.line, text: raw.text.trim() };
  const firstWord = (text.match(/^([A-Za-z]+)/)?.[1] || "").toLowerCase();
  return {
    id,
    text,
    verbs: firstWord ? [firstWord] : [],
    tools: [], // filled once skills are known
    metrics: metricsOf(text, id, source),
    source,
  };
}

// ── Experience ────────────────────────────────────────────────────────────────

function parseExperience(lines: RawLine[], unmapped: string[]): { entries: ExperienceEntry[]; bulletLines: number } {
  const entries: ExperienceEntry[] = [];
  let current: ExperienceEntry | null = null;
  let bulletLines = 0;
  for (const raw of lines) {
    const line = raw.text.trim();
    if (!line) continue;
    if (BULLET_RE.test(raw.text)) {
      bulletLines++;
      if (!current) {
        unmapped.push(line);
        continue;
      }
      current.bullets.push(makeBullet(`${current.id}.${current.bullets.length + 1}`, raw, "experience"));
      continue;
    }
    if (DATE_RANGE_RE.test(line)) {
      current = newRole(entries.length + 1, line);
      entries.push(current);
      continue;
    }
    // A non-bullet, non-dated line inside EXPERIENCE (a stray note, or a role
    // header whose dates sit on their own line) is left for review rather than
    // guessed at.
    unmapped.push(line);
  }
  return { entries, bulletLines };
}

function newRole(index: number, header: string): ExperienceEntry {
  const parts = header.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const datesIdx = parts.findIndex((p) => DATE_RANGE_RE.test(p));
    const dates = datesIdx >= 0 ? parts[datesIdx] : "";
    const rest = parts.filter((_, i) => i !== datesIdx);
    return { id: `E${index}`, title: rest[0] || "", employer: rest[1] || "", location: rest[2] || "", dates, bullets: [] };
  }
  // No pipes: "Title — Employer   Dates" style. Pull the date range out.
  const dateMatch = header.match(DATE_RANGE_RE);
  const dates = dateMatch ? dateMatch[0] : "";
  const head = dates ? header.replace(dates, "").replace(/[–—-]\s*$/, "").trim() : header;
  const seg = head.split(/\s+[–—-]\s+|\s+at\s+|,\s+/);
  return { id: `E${index}`, title: (seg[0] || "").trim(), employer: (seg[1] || "").trim(), location: "", dates, bullets: [] };
}

// ── Projects ──────────────────────────────────────────────────────────────────

function parseProjects(lines: RawLine[], unmapped: string[]): { projects: ProjectFact[]; bulletLines: number } {
  const projects: ProjectFact[] = [];
  let current: ProjectFact | null = null;
  let bulletLines = 0;
  for (const raw of lines) {
    const line = raw.text.trim();
    if (!line) continue;
    if (BULLET_RE.test(raw.text)) {
      bulletLines++;
      if (!current) {
        unmapped.push(line);
        continue;
      }
      current.bullets.push(makeBullet(`${current.id}.${current.bullets.length + 1}`, raw, "projects"));
      continue;
    }
    if (TECH_LINE_RE.test(line)) {
      if (current) current.tools = splitItems(line.replace(/^[^:]*:/, ""));
      else unmapped.push(line);
      continue;
    }
    // A plain line starts a new project. Name and the bracketed label split.
    const { name, label } = splitNameLabel(line);
    current = { id: `P${projects.length + 1}`, name, label, bullets: [], tools: [] };
    projects.push(current);
  }
  return { projects, bulletLines };
}

function splitNameLabel(line: string): { name: string; label: string } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(line);
  if (m) return { name: m[1].trim(), label: m[2].trim() };
  return { name: line.trim(), label: "" };
}

// ── Skills ────────────────────────────────────────────────────────────────────

type RawSkill = { name: string; tier: SkillTier; learning: boolean };

function parseSkills(lines: RawLine[]): RawSkill[] {
  const out: RawSkill[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.text.trim();
    if (!line) continue;
    const m = /^([^:]{1,40}):\s*(.+)$/.exec(stripBullet(line));
    const labelWord = m ? m[1] : "";
    const items = m ? m[2] : stripBullet(line);
    const learning = /\b(learning|studying|currently)\b/i.test(labelWord);
    const tier: SkillTier = /functional|competenc|soft/i.test(labelWord) ? "functional" : "technical";
    for (const name of splitItems(items)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, tier, learning });
    }
  }
  return out;
}

function mentions(haystack: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w])${esc}(?![\\w])`, "i").test(haystack);
}

// ── Education / Certifications / Summary ───────────────────────────────────────

function parseEducation(lines: RawLine[], unmapped: string[]): EducationFact[] {
  const out: EducationFact[] = [];
  let current: EducationFact | null = null;
  for (const raw of lines) {
    const line = raw.text.trim();
    if (!line) continue;
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
    const looksLikeEntry = parts.length > 1 || DATE_RANGE_RE.test(line) || /\b(bsc|ba|beng|btech|msc|ma|meng|mba|phd|diploma|degree)\b/i.test(line);
    if (looksLikeEntry && !BULLET_RE.test(raw.text)) {
      const datesIdx = parts.findIndex((p) => DATE_RANGE_RE.test(p));
      const dates = datesIdx >= 0 ? parts[datesIdx] : (line.match(DATE_RANGE_RE)?.[0] ?? "");
      const rest = parts.filter((_, i) => i !== datesIdx);
      current = {
        id: `ED${out.length + 1}`,
        degree: rest[0] || line,
        institution: rest[1] || "",
        dates,
        note: "",
        source: { section: "education", line: raw.line, text: line },
      };
      out.push(current);
    } else if (current) {
      current.note = current.note ? `${current.note} ${stripBullet(line)}` : stripBullet(line);
    } else {
      unmapped.push(line);
    }
  }
  return out;
}

function parseCertifications(lines: RawLine[]): CertificationFact[] {
  const out: CertificationFact[] = [];
  for (const raw of lines) {
    const line = stripBullet(raw.text.trim());
    if (!line) continue;
    out.push({ id: `C${out.length + 1}`, name: line, source: { section: "certifications", line: raw.line, text: raw.text.trim() } });
  }
  return out;
}

function parseSummary(lines: RawLine[]): SummaryFact[] {
  const out: SummaryFact[] = [];
  for (const raw of lines) {
    const line = stripBullet(raw.text.trim());
    if (!line) continue;
    out.push({ id: `SF${out.length + 1}`, text: line, source: { section: "summary", line: raw.line, text: raw.text.trim() } });
  }
  return out;
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export function buildStructuredProfile(cvText: string, nowIso: string): ImportResult {
  const problems: string[] = [];
  const unmapped: string[] = [];
  const lines = (cvText || "").split("\n");

  const blocks: Record<SectionType, RawLine[]> = {
    summary: [], experience: [], projects: [], skills: [], education: [], certifications: [], other: [],
  };
  let section: SectionType | null = null; // null = the header block (name/contact), ignored
  const otherHeadings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.trim();
    if (!text) continue;
    if (HEADING_RE.test(raw) && !DATE_RANGE_RE.test(text)) {
      section = classifyHeading(text);
      if (section === "other") otherHeadings.push(text);
      continue;
    }
    if (section === null) continue; // identity header above the first section
    blocks[section].push({ line: i + 1, text: raw });
  }

  // Unrecognised sections are never dropped: every line goes to unmapped.
  for (const raw of blocks.other) unmapped.push(raw.text.trim());

  const { entries, bulletLines: expBulletLines } = parseExperience(blocks.experience, unmapped);
  const { projects, bulletLines: projBulletLines } = parseProjects(blocks.projects, unmapped);
  const rawSkills = parseSkills(blocks.skills);
  const education = parseEducation(blocks.education, unmapped);
  const certifications = parseCertifications(blocks.certifications);
  const summary_facts = parseSummary(blocks.summary);

  const expBullets = entries.flatMap((e) => e.bullets);

  // Evidence level + refs per skill, from where the CV actually shows it.
  const skills: SkillFact[] = rawSkills.map((s, i) => {
    if (s.learning) return { id: `S${i + 1}`, name: s.name, tier: s.tier, evidence: "learning", evidence_refs: [] };
    const expRefs = expBullets.filter((b) => mentions(b.text, s.name)).map((b) => b.id);
    if (expRefs.length) return { id: `S${i + 1}`, name: s.name, tier: s.tier, evidence: "production", evidence_refs: expRefs };
    const projRefs = projectRefs(projects, s.name);
    const evidence: SkillEvidence = projRefs.length ? "project" : "coursework";
    return { id: `S${i + 1}`, name: s.name, tier: s.tier, evidence, evidence_refs: projRefs };
  });

  // A bullet's tools are the named skills it mentions (reading order).
  const technicalNames = rawSkills.map((s) => s.name);
  for (const b of [...expBullets, ...projects.flatMap((p) => p.bullets)]) {
    b.tools = technicalNames.filter((name) => mentions(b.text, name));
  }

  if (!entries.length && blocks.experience.length) problems.push("Could not read any work experience — check the EXPERIENCE heading and the role header dates.");

  const profile = normalizeStructuredProfile({
    version: 1,
    updated_at: nowIso,
    experience: entries,
    skills,
    projects,
    education,
    certifications,
    summary_facts,
    unmapped,
  });

  // Every experience/project bullet line in the source must have become a
  // Bullet; if the counts disagree, say so rather than silently lose one.
  const placed = profile.experience.flatMap((e) => e.bullets).length + profile.projects.flatMap((p) => p.bullets).length;
  if (placed !== expBulletLines + projBulletLines) {
    problems.push(`Placed ${placed} of ${expBulletLines + projBulletLines} bullet lines — the rest are in "unmapped".`);
  }

  return { profile, problems };
}

function projectRefs(projects: ProjectFact[], name: string): string[] {
  const refs: string[] = [];
  for (const p of projects) {
    const inTools = p.tools.some((t) => t.toLowerCase() === name.toLowerCase()) || mentions(p.tools.join(" "), name);
    const inBullet = p.bullets.some((b) => mentions(b.text, name));
    if (inTools || inBullet) refs.push(p.id);
  }
  return refs;
}
