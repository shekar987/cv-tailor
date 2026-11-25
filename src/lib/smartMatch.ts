// Smart Match: deterministic CV reordering for a job description.
// No AI call. No credit spent. Reorders the user's own bullets and skills
// by keyword coverage — nothing is added or invented.
//
// Scoring uses atsMatch so Java never matches JavaScript.

import { matchAtsKeywords } from "./atsMatch.ts";
import { parseMasterExperience, type MasterRole } from "./bulletIds.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type SmartMatchSections = {
  summary: string;
  skills: string;
  experience: string;
  projects: Record<string, string[]>;
};

export type SmartMatchResult = {
  sections: SmartMatchSections;
  /** 0–1 fraction of required terms matched in the CV. */
  coverage: number;
  /** Must-have terms with no evidence in the CV. */
  gaps: string[];
  /** Bullet IDs (R1.1, R2.3 …) used in the experience output. */
  evidenceIds: string[];
  /** Marker so the UI and route know no AI was used. */
  isFreeMatch: true;
  /**
   * TL-4: maps each covered JD requirement to the first 60 chars of the
   * bullet that best satisfies it. Empty when no workerSelection is provided.
   */
  coveredBy: Record<string, string>;
};

// ── TL-4: worker selection types ──────────────────────────────────────────────

/** Score assigned by the retrieval worker for one experience bullet. */
export type WorkerBulletScore = {
  id: string;
  score: number;              // 0–1 blended (cosine × 0.7 + rule × 0.3) or pure rule score
  coveredRequirement: string; // JD requirement this bullet best satisfies
};

/**
 * Optional parameter from the PC worker's "select" job. When present,
 * smartMatch() reorders evidenceIds by the worker's scores and builds coveredBy
 * from its covered_requirement annotations.
 */
export type WorkerSelection = {
  bulletScores: WorkerBulletScore[];
};

export type Project = {
  name: string;
  tech?: string[];
  originalBullets?: string[];
  label?: string;
};

// ── JD keyword parsing ────────────────────────────────────────────────────────

type JdKeywords = {
  required: string[];  // from Required / Essential / Must-have headings
  preferred: string[]; // from Nice-to-have / Preferred headings
  general: string[];   // everything else
};

const REQUIRED_HEADING = /^\s*(?:requirement[s]?|essential[s]?|must[\s-]have|qualifications?|what\s+you(?:'ll|\s+will)?\s+(?:need|have|bring)|key\s+skills?|your\s+skills|you(?:'ll|\s+will)?\s+need)\s*:?\s*$/i;
const PREFERRED_HEADING = /^\s*(?:nice[\s-]to[\s-]have|preferred|desirable|bonus|good\s+to\s+have|advantageous|additional\s+skills?)\s*:?\s*$/i;
const IGNORE_HEADING = /^\s*(?:about\s+(?:us|the\s+role|the\s+company|you)|responsibilities?|day[\s-]to[\s-]day|benefits?|compensation|how\s+to\s+apply|perks?|overview)\s*:?\s*$/i;
// A "generic section heading": starts with a capital, mostly letters/spaces, short.
// Only treated as a heading (switching mode back to general) when it EXPLICITLY
// looks like a heading — ends with ":" or is entirely in UPPERCASE.
// This prevents single-word tech names like "Java" or "TypeScript" from being
// mistaken for headings when they appear as bare items in a requirements list.
const ANY_HEADING_RE = /^\s*[A-Z][A-Za-z\s&-]{2,50}:?\s*$/;

function extractPhrases(line: string): string[] {
  const stripped = line.replace(/^\s*[-•*·]\s*/, "").trim();
  if (stripped.length < 2) return [];

  // Strip common fluff prefixes so "proficiency in React" → "React"
  const cleaned = stripped
    .replace(/^\d+\+?\s+years?\s+(?:of\s+)?(?:experience\s+(?:in|with)\s+)?/i, "")
    .replace(/^(?:strong|solid|good|excellent|proven|demonstrable)\s+/i, "")
    .replace(/^(?:proficiency|proficient|knowledge|expertise|experience|familiarity|understanding)\s+(?:in|with|of)\s+/i, "")
    .replace(/^(?:ability|willingness)\s+to\s+\S+/i, "")
    .trim();

  // Split on common list delimiters
  const segments = cleaned.split(/[,;]|\s+and\s+|\s+or\s+/i);
  const result: string[] = [];
  for (const seg of segments) {
    const word = seg.trim().replace(/^(?:in|with|of|a|an|the|to|for|from)\s+/i, "").trim();
    if (!word || word.length < 2) continue;
    // Keep at most 4 words per phrase
    result.push(word.split(/\s+/).slice(0, 4).join(" "));
  }
  return result.filter((p) => p.length > 1);
}

export function parseJdKeywords(jdText: string): JdKeywords {
  const lines = jdText.split("\n");
  type Mode = "required" | "preferred" | "general" | "ignore";
  let mode: Mode = "general";

  const required: string[] = [];
  const preferred: string[] = [];
  const general: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (REQUIRED_HEADING.test(trimmed)) { mode = "required"; continue; }
    if (PREFERRED_HEADING.test(trimmed)) { mode = "preferred"; continue; }
    if (IGNORE_HEADING.test(trimmed)) { mode = "ignore"; continue; }
    // Only treat as a generic section heading when we are already in general mode.
    // Once inside a named section (required / preferred), every non-heading line
    // is content — we never reset back to general mid-section.
    // Also require the line to look explicitly like a heading: ends with ":"
    // OR is entirely uppercase. This prevents single-word tech names like
    // "Java", "Docker", "AWS" from being misread as headings. All-caps acronyms
    // ("AWS", "SQL") still pass the uppercase test, but they only do so when
    // mode is already general, so they can't silently end a requirements block.
    if (
      mode === "general" &&
      ANY_HEADING_RE.test(trimmed) &&
      trimmed.length < 60 &&
      (trimmed.trim().endsWith(":") || trimmed.trim() === trimmed.trim().toUpperCase())
    ) {
      mode = "general";
      continue;
    }
    if (mode === "ignore") continue;

    const phrases = extractPhrases(trimmed);
    if (mode === "required") required.push(...phrases);
    else if (mode === "preferred") preferred.push(...phrases);
    else general.push(...phrases);
  }

  return { required, preferred, general };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreText(text: string, kw: JdKeywords): number {
  if (!text.trim()) return 0;
  const req = kw.required.length > 0 ? matchAtsKeywords(text, kw.required).matched * 4 : 0;
  const pref = kw.preferred.length > 0 ? matchAtsKeywords(text, kw.preferred).matched * 2 : 0;
  const gen = kw.general.length > 0 ? matchAtsKeywords(text, kw.general).matched : 0;
  return req + pref + gen;
}

// ── CV section extraction ─────────────────────────────────────────────────────

const SUMMARY_HEADING = /^\s*(?:PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE|PERSONAL\s+STATEMENT|PROFESSIONAL\s+PROFILE|OBJECTIVE|ABOUT\s+ME)\s*:?\s*$/i;
const SKILLS_HEADING = /^\s*(?:TECHNICAL\s+SKILLS?|SKILLS?\s+(?:&|AND)\s+\w+|SKILLS?|KEY\s+SKILLS?|CORE\s+COMPETENCIES|COMPETENCIES)\s*:?\s*$/i;
const ANY_SECTION_RE = /^\s*[A-Z][A-Z\s&/-]{2,40}:?\s*$/;

function extractCvSection(cvText: string, headingRe: RegExp): string {
  const lines = cvText.split("\n");
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return "";

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_SECTION_RE.test(lines[i]) && !headingRe.test(lines[i])) { end = i; break; }
  }
  return lines
    .slice(start + 1, end)
    .filter((l) => l.trim())
    .join("\n")
    .trim();
}

// ── Skills reordering ─────────────────────────────────────────────────────────

function reorderSkillLine(line: string, kw: JdKeywords): string {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return line;
  const label = line.slice(0, colonIdx + 1);
  const rest = line.slice(colonIdx + 1).trim();

  const separator = rest.includes("|") ? "|" : ",";
  const items = rest.split(separator).map((s) => s.trim()).filter(Boolean);
  if (items.length <= 1) return line;

  const scored = items.map((item) => ({ item, score: scoreText(item, kw) }));
  // Stable sort: matched items first, then original order for ties
  scored.sort((a, b) => b.score - a.score);

  const sep = separator === "|" ? " | " : ", ";
  return `${label} ${scored.map((s) => s.item).join(sep)}`;
}

export function reorderSkills(skillsText: string, kw: JdKeywords): string {
  return skillsText
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.includes(":") && (t.includes("|") || t.includes(","))) {
        return reorderSkillLine(t, kw);
      }
      return line;
    })
    .join("\n");
}

// ── Experience ranking ────────────────────────────────────────────────────────

type ScoredBullet = { id: string; text: string; score: number };

function rankRoleBullets(role: MasterRole, kw: JdKeywords): ScoredBullet[] {
  return role.bullets
    .map((b) => ({ id: b.id, text: b.text, score: scoreText(b.text, kw) }))
    .sort((a, b) => b.score - a.score);
}

function formatExperience(roles: MasterRole[], kw: JdKeywords): { text: string; evidenceIds: string[] } {
  const evidenceIds: string[] = [];
  const sections: string[] = [];

  for (const role of roles) {
    const ranked = rankRoleBullets(role, kw);
    evidenceIds.push(...ranked.map((b) => b.id));
    const bullets = ranked.map((b) => `• ${b.text}`).join("\n");
    sections.push(`${role.header}\n${bullets}`);
  }

  return { text: sections.join("\n\n"), evidenceIds };
}

// ── Project ranking ───────────────────────────────────────────────────────────

function rankProjects(projects: Project[], kw: JdKeywords, maxProjects = 2): Project[] {
  return projects
    .map((p) => {
      const techScore = scoreText((p.tech ?? []).join(" "), kw);
      const bulletScore = (p.originalBullets ?? []).reduce((s, b) => s + scoreText(b, kw), 0);
      return { project: p, score: techScore + bulletScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxProjects)
    .map((r) => r.project);
}

function formatProjects(projects: Project[], kw: JdKeywords): Record<string, string[]> {
  const ranked = rankProjects(projects, kw);
  const result: Record<string, string[]> = {};
  ranked.forEach((p, i) => {
    result[String(i)] = (p.originalBullets ?? []).slice(0, 4);
  });
  return result;
}

// ── Coverage & gaps ───────────────────────────────────────────────────────────

export function computeCoverage(cvText: string, kw: JdKeywords): { coverage: number; gaps: string[] } {
  const terms = kw.required.length > 0 ? kw.required : kw.general.slice(0, 20);
  if (terms.length === 0) return { coverage: 1, gaps: [] };
  const result = matchAtsKeywords(cvText, terms);
  return {
    coverage: result.total > 0 ? result.matched / result.total : 1,
    gaps: result.missedKeywords,
  };
}

// ── TL-4: worker selection helpers ────────────────────────────────────────────

/**
 * Re-sort evidenceIds by the worker's bullet scores (descending). IDs not
 * present in the worker's list are appended in their original order.
 * Re-orders only — never drops a bullet.
 */
function applyWorkerSelection(
  evidenceIds: string[],
  workerSelection: WorkerSelection,
): string[] {
  const scoreMap = new Map<string, number>();
  for (const bs of workerSelection.bulletScores) {
    scoreMap.set(bs.id, bs.score);
  }
  return [...evidenceIds].sort((a, b) => {
    const sa = scoreMap.get(a) ?? -1;
    const sb = scoreMap.get(b) ?? -1;
    return sb - sa;
  });
}

/**
 * Build coveredBy from the worker's covered_requirement annotations.
 * Maps each non-empty coveredRequirement → first 60 chars of that bullet's text.
 * The first bullet claiming each requirement wins.
 */
function coveredByFromWorkerSelection(
  workerSelection: WorkerSelection,
  roles: MasterRole[],
): Record<string, string> {
  const bulletMap = new Map<string, string>();
  for (const role of roles) {
    for (const bullet of role.bullets) {
      bulletMap.set(bullet.id, bullet.text);
    }
  }
  const result: Record<string, string> = {};
  for (const bs of workerSelection.bulletScores) {
    if (!bs.coveredRequirement) continue;
    if (bs.coveredRequirement in result) continue; // first bullet wins
    const text = bulletMap.get(bs.id);
    if (text) result[bs.coveredRequirement] = text.slice(0, 60);
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function smartMatch(
  cvText: string,
  jdText: string,
  projects: Project[] = [],
  workerSelection?: WorkerSelection,
): SmartMatchResult {
  const kw = parseJdKeywords(jdText);

  const summary = extractCvSection(cvText, SUMMARY_HEADING);
  const rawSkills = extractCvSection(cvText, SKILLS_HEADING);
  const skills = reorderSkills(rawSkills, kw);

  const roles = parseMasterExperience(cvText);
  const { text: experience, evidenceIds: rawEvidenceIds } = formatExperience(roles, kw);

  const projectsOut = formatProjects(projects, kw);

  const { coverage, gaps } = computeCoverage(cvText, kw);

  // TL-4: when the PC worker provides a selection, reorder by its scores and
  // build the coveredBy map. Fallback: original rule-score order, empty map.
  const evidenceIds = workerSelection
    ? applyWorkerSelection(rawEvidenceIds, workerSelection)
    : rawEvidenceIds;
  const coveredBy = workerSelection
    ? coveredByFromWorkerSelection(workerSelection, roles)
    : {};

  return {
    sections: { summary, skills, experience, projects: projectsOut },
    coverage,
    gaps,
    evidenceIds,
    isFreeMatch: true,
    coveredBy,
  };
}
