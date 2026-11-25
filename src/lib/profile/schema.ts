// The MASTER PROFILE as structured data (Local Tailor, TL-2).
//
// Every later Local-Tailor chunk — retrieval, rewriting, the honesty verifier
// (TL-6) — needs the candidate's experience as DATA, not prose, so each bullet
// and each metric carries a `source` tracing it back to a line of the master
// CV. This file is the shape and the coercion that guarantees it; the rules
// that check a profile against its source CV live in ./validate.ts, and the
// rule-based parser that builds one from a master CV lives in ./import.ts.
//
// House style, deliberately: no zod. The repo hand-rolls every validator at
// the boundary (normalizeProfile, normalizeEligibility, normalizeClaims …) and
// keeps tested libs import-free so they run under node:test with no `@/` alias
// and no new dependency. `normalizeStructuredProfile` is the same pattern.
// `STRUCTURED_PROFILE_JSON_SCHEMA` is a plain object literal (not generated),
// exported for a future out-of-process worker that wants the shape.
//
// Stored migration-free under cv_profiles.data.structured (see lib/cvStore).

export type Direction = "up" | "down" | "none";

// Where a fact was read from in the master CV. The CV is one text blob, so
// "file" is implicitly that blob; `line` is the 1-based line it was read from
// (null when a fact spans lines or was derived), and `text` is the verbatim
// line, for a human to check the trace and for TL-6 to quote.
export type Source = { section: string; line: number | null; text: string };

export type Metric = {
  id: string;
  label: string; // what the number measures ("deployment time", "juniors mentored")
  value: string; // verbatim as written in the CV ("40%", "3", "£2.3m")
  unit: string; // "%", "x", "" …
  direction: Direction; // down = reduced, up = increased, none = a count
  source: Source;
};

export type Bullet = {
  id: string; // e.g. "E1.2" (experience role 1, bullet 2) or "P1.1" (project 1)
  text: string;
  verbs: string[]; // leading action verbs, lower-cased
  tools: string[]; // named technologies the bullet mentions
  metrics: Metric[];
  source: Source;
};

export type ExperienceEntry = {
  id: string; // "E1", "E2" …
  employer: string;
  title: string;
  dates: string;
  location: string;
  bullets: Bullet[];
};

export type SkillTier = "functional" | "technical";
export type SkillEvidence = "production" | "project" | "coursework" | "learning";

export type SkillFact = {
  id: string; // "S1" …
  name: string;
  tier: SkillTier;
  evidence: SkillEvidence;
  evidence_refs: string[]; // bullet ids (E…/P…) that show the skill
};

export type ProjectFact = {
  id: string; // "P1" …
  name: string;
  label: string; // the bracketed descriptor — RideX must be the exact fixed phrase
  bullets: Bullet[];
  tools: string[];
};

export type EducationFact = {
  id: string; // "ED1" …
  degree: string;
  institution: string;
  dates: string;
  note: string;
  source: Source;
};

export type CertificationFact = {
  id: string; // "C1" …
  name: string;
  source: Source;
};

export type SummaryFact = {
  id: string; // "SF1" …
  text: string;
  source: Source;
};

export type StructuredProfile = {
  version: 1;
  updated_at: string; // ISO timestamp of the last save/import
  experience: ExperienceEntry[];
  skills: SkillFact[];
  projects: ProjectFact[];
  education: EducationFact[];
  certifications: CertificationFact[];
  summary_facts: SummaryFact[];
  // Lines the importer could not place. NEVER dropped and NEVER guessed — the
  // owner reviews them and files them by hand.
  unmapped: string[];
};

export const STRUCTURED_PROFILE_VERSION = 1 as const;

// ── Coercion ────────────────────────────────────────────────────────────────

const DIRECTIONS: readonly Direction[] = ["up", "down", "none"];
const TIERS: readonly SkillTier[] = ["functional", "technical"];
const EVIDENCE: readonly SkillEvidence[] = ["production", "project", "coursework", "learning"];

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, max = 600): string {
  if (typeof v === "string") return v.trim().slice(0, max);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function strList(v: unknown, maxItems: number, maxEach = 120): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, maxEach)).filter(Boolean).slice(0, maxItems);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeSource(v: unknown): Source {
  const o = obj(v);
  return { section: str(o.section, 60), line: num(o.line), text: str(o.text, 600) };
}

function normalizeMetric(v: unknown, fallbackId: string): Metric {
  const o = obj(v);
  return {
    id: str(o.id, 40) || fallbackId,
    label: str(o.label, 160),
    value: str(o.value, 40),
    unit: str(o.unit, 16),
    direction: oneOf(o.direction, DIRECTIONS, "none"),
    source: normalizeSource(o.source),
  };
}

function normalizeBullet(v: unknown, fallbackId: string): Bullet {
  const o = obj(v);
  return {
    id: str(o.id, 40) || fallbackId,
    text: str(o.text, 600),
    verbs: strList(o.verbs, 8, 40).map((s) => s.toLowerCase()),
    tools: strList(o.tools, 20, 60),
    metrics: Array.isArray(o.metrics)
      ? o.metrics.slice(0, 20).map((m, i) => normalizeMetric(m, `${fallbackId}m${i + 1}`))
      : [],
    source: normalizeSource(o.source),
  };
}

function normalizeExperience(v: unknown, i: number): ExperienceEntry {
  const o = obj(v);
  const id = str(o.id, 40) || `E${i + 1}`;
  return {
    id,
    employer: str(o.employer, 200),
    title: str(o.title, 200),
    dates: str(o.dates, 80),
    location: str(o.location, 120),
    bullets: Array.isArray(o.bullets)
      ? o.bullets.slice(0, 40).map((b, j) => normalizeBullet(b, `${id}.${j + 1}`))
      : [],
  };
}

function normalizeProjectFact(v: unknown, i: number): ProjectFact {
  const o = obj(v);
  const id = str(o.id, 40) || `P${i + 1}`;
  return {
    id,
    name: str(o.name, 200),
    label: str(o.label, 300),
    bullets: Array.isArray(o.bullets)
      ? o.bullets.slice(0, 40).map((b, j) => normalizeBullet(b, `${id}.${j + 1}`))
      : [],
    tools: strList(o.tools, 30, 60),
  };
}

function normalizeSkill(v: unknown, i: number): SkillFact {
  const o = obj(v);
  return {
    id: str(o.id, 40) || `S${i + 1}`,
    name: str(o.name, 80),
    tier: oneOf(o.tier, TIERS, "technical"),
    evidence: oneOf(o.evidence, EVIDENCE, "project"),
    evidence_refs: strList(o.evidence_refs, 40, 40),
  };
}

function normalizeEducationFact(v: unknown, i: number): EducationFact {
  const o = obj(v);
  return {
    id: str(o.id, 40) || `ED${i + 1}`,
    degree: str(o.degree, 300),
    institution: str(o.institution, 300),
    dates: str(o.dates, 100),
    note: str(o.note, 2000),
    source: normalizeSource(o.source),
  };
}

function normalizeCertFact(v: unknown, i: number): CertificationFact {
  const o = obj(v);
  return { id: str(o.id, 40) || `C${i + 1}`, name: str(o.name, 300), source: normalizeSource(o.source) };
}

function normalizeSummaryFact(v: unknown, i: number): SummaryFact {
  const o = obj(v);
  return { id: str(o.id, 40) || `SF${i + 1}`, text: str(o.text, 600), source: normalizeSource(o.source) };
}

export function emptyStructuredProfile(nowIso: string): StructuredProfile {
  return {
    version: STRUCTURED_PROFILE_VERSION,
    updated_at: str(nowIso, 40),
    experience: [],
    skills: [],
    projects: [],
    education: [],
    certifications: [],
    summary_facts: [],
    unmapped: [],
  };
}

// Coerce anything (a model guess, a stored row, a hand edit) to the real shape
// so every consumer — the editor, the validator, TL-6 — sees the type it
// assumes. Never throws.
export function normalizeStructuredProfile(input: unknown): StructuredProfile {
  const p = obj(input);
  return {
    version: STRUCTURED_PROFILE_VERSION,
    updated_at: str(p.updated_at, 40),
    experience: Array.isArray(p.experience) ? p.experience.slice(0, 30).map(normalizeExperience) : [],
    skills: Array.isArray(p.skills) ? p.skills.slice(0, 120).map(normalizeSkill) : [],
    projects: Array.isArray(p.projects) ? p.projects.slice(0, 30).map(normalizeProjectFact) : [],
    education: Array.isArray(p.education) ? p.education.slice(0, 20).map(normalizeEducationFact) : [],
    certifications: Array.isArray(p.certifications) ? p.certifications.slice(0, 40).map(normalizeCertFact) : [],
    summary_facts: Array.isArray(p.summary_facts) ? p.summary_facts.slice(0, 20).map(normalizeSummaryFact) : [],
    unmapped: strList(p.unmapped, 200, 600),
  };
}

// ── JSON Schema (for an out-of-process worker; draft-07 shape) ────────────────
// A plain literal, kept in step with the types above by hand. Not used by the
// TypeScript app — exported so the Local-Tailor worker can validate the same
// JSON without importing TypeScript.
const SOURCE_SCHEMA = {
  type: "object",
  required: ["section", "line", "text"],
  properties: {
    section: { type: "string" },
    line: { type: ["integer", "null"] },
    text: { type: "string" },
  },
} as const;

const METRIC_SCHEMA = {
  type: "object",
  required: ["id", "label", "value", "unit", "direction", "source"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    value: { type: "string" },
    unit: { type: "string" },
    direction: { enum: ["up", "down", "none"] },
    source: SOURCE_SCHEMA,
  },
} as const;

const BULLET_SCHEMA = {
  type: "object",
  required: ["id", "text", "verbs", "tools", "metrics", "source"],
  properties: {
    id: { type: "string" },
    text: { type: "string" },
    verbs: { type: "array", items: { type: "string" } },
    tools: { type: "array", items: { type: "string" } },
    metrics: { type: "array", items: METRIC_SCHEMA },
    source: SOURCE_SCHEMA,
  },
} as const;

export const STRUCTURED_PROFILE_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Jobhuntz master profile",
  type: "object",
  required: [
    "version",
    "updated_at",
    "experience",
    "skills",
    "projects",
    "education",
    "certifications",
    "summary_facts",
    "unmapped",
  ],
  properties: {
    version: { const: 1 },
    updated_at: { type: "string" },
    experience: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "employer", "title", "dates", "location", "bullets"],
        properties: {
          id: { type: "string" },
          employer: { type: "string" },
          title: { type: "string" },
          dates: { type: "string" },
          location: { type: "string" },
          bullets: { type: "array", items: BULLET_SCHEMA },
        },
      },
    },
    skills: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "tier", "evidence", "evidence_refs"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          tier: { enum: ["functional", "technical"] },
          evidence: { enum: ["production", "project", "coursework", "learning"] },
          evidence_refs: { type: "array", items: { type: "string" } },
        },
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "label", "bullets", "tools"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          label: { type: "string" },
          bullets: { type: "array", items: BULLET_SCHEMA },
          tools: { type: "array", items: { type: "string" } },
        },
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "degree", "institution", "dates", "note", "source"],
        properties: {
          id: { type: "string" },
          degree: { type: "string" },
          institution: { type: "string" },
          dates: { type: "string" },
          note: { type: "string" },
          source: SOURCE_SCHEMA,
        },
      },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "source"],
        properties: { id: { type: "string" }, name: { type: "string" }, source: SOURCE_SCHEMA },
      },
    },
    summary_facts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text", "source"],
        properties: { id: { type: "string" }, text: { type: "string" }, source: SOURCE_SCHEMA },
      },
    },
    unmapped: { type: "array", items: { type: "string" } },
  },
} as const;
