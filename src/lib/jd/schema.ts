// JD parse schema (TL-3, 27 Nov 2026). The structured output of the JD
// parser — schema.ts is import-free save for Zod so it can run in workers.
//
// Red-flag codes map directly to jdTriage rules plus three new ones:
//   SALARY_BELOW_FLOOR  — below the configurable £35k floor
//   STALE_POSTING       — posted or updated more than 60 days ago
//   FIXED_START_DATE    — a fixed or September start date
//
// Verdict:
//   skip  — any hard flag; never tailor
//   check — warn flags only; tailor with caution
//   go    — no flags
//
// The schema is the single source of truth that smartMatch (FT-1) and
// TL-4 retrieval read; no second parser is needed.

import { z } from "zod";

// ── Red flags ─────────────────────────────────────────────────────────────────

export const RED_FLAG_CODES = [
  "CONTRACT_OR_DAY_RATE",    // hard — contractor wording, IR35, day rate
  "FIXED_TERM",              // warn — fixed-term employee contract
  "SECURITY_CLEARANCE",      // hard — SC/DV required
  "UK_RESIDENCE_5Y",         // hard — 5 years' UK residence needed
  "NO_SPONSORSHIP_EVER",     // hard — "no current or future visa support"
  "YEARS_3_PLUS",            // hard — 3+ years as a requirement
  "SENIORITY_MID_SENIOR",    // warn — explicit mid/senior seniority signal
  "UNDEFENDABLE_CORE_SKILL", // hard — Java/C#/C++/.NET/Go/Rust/Kotlin/PHP as the core language
  "SALARY_BELOW_FLOOR",      // warn — below the configurable floor (default £35k)
  "STALE_POSTING",           // warn — posted or updated more than 60 days ago
  "FIXED_START_DATE",        // warn — fixed/September start
] as const;

export type RedFlagCode = (typeof RED_FLAG_CODES)[number];

// A hard flag → skip; a warn flag alone → check.
export const RED_FLAG_SEVERITY: Record<RedFlagCode, "hard" | "warn"> = {
  CONTRACT_OR_DAY_RATE: "hard",
  FIXED_TERM: "warn",
  SECURITY_CLEARANCE: "hard",
  UK_RESIDENCE_5Y: "hard",
  NO_SPONSORSHIP_EVER: "hard",
  YEARS_3_PLUS: "hard",
  SENIORITY_MID_SENIOR: "warn",
  UNDEFENDABLE_CORE_SKILL: "hard",
  SALARY_BELOW_FLOOR: "warn",
  STALE_POSTING: "warn",
  FIXED_START_DATE: "warn",
};

export const RED_FLAG_LABELS: Record<RedFlagCode, string> = {
  CONTRACT_OR_DAY_RATE: "Contract or day rate",
  FIXED_TERM: "Fixed-term contract",
  SECURITY_CLEARANCE: "Security clearance required",
  UK_RESIDENCE_5Y: "Five years' UK residence required",
  NO_SPONSORSHIP_EVER: "No sponsorship, ever",
  YEARS_3_PLUS: "Three or more years required",
  SENIORITY_MID_SENIOR: "Mid or senior seniority",
  UNDEFENDABLE_CORE_SKILL: "Core language you don't have",
  SALARY_BELOW_FLOOR: "Salary below floor",
  STALE_POSTING: "Stale posting",
  FIXED_START_DATE: "Fixed start date",
};

// ── Sub-schemas ───────────────────────────────────────────────────────────────

export const RedFlagSchema = z.object({
  code: z.enum(RED_FLAG_CODES),
  severity: z.enum(["hard", "warn"]),
  label: z.string(),
  phrase: z.string().max(200),
});

export const RequirementSchema = z.object({
  skill: z.string().max(150),
  category: z.enum(["technical", "domain", "soft", "qualification", "unknown"]),
  source_phrase: z.string().max(200),
  section: z.enum(["must_have", "nice_to_have"]),
});

export const SalarySchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().default("GBP"),
  period: z.enum(["annual", "daily", "hourly", "unknown"]),
  source_phrase: z.string().max(200),
});

export const YearsRequiredSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  source_phrase: z.string().max(200),
});

// ── Main schema ───────────────────────────────────────────────────────────────

export const JdParseSchema = z.object({
  title: z.string().max(200),
  company: z.string().max(200),
  location: z.string().max(200),
  remote_policy: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  seniority: z.enum(["graduate", "junior", "mid", "senior", "unknown"]),
  years_required: YearsRequiredSchema.nullable(),
  must_have: z.array(RequirementSchema),
  nice_to_have: z.array(RequirementSchema),
  tools: z.array(z.string().max(100)),
  salary: SalarySchema.nullable(),
  contract_type: z.enum(["permanent", "fixed_term", "contract", "internship", "unknown"]),
  start_date: z.string().max(100).nullable(),
  closing_date: z.string().max(100).nullable(),
  posted_or_updated: z.string().max(100).nullable(),
  red_flags: z.array(RedFlagSchema),
  verdict: z.enum(["skip", "check", "go"]),
  verdict_reasons: z.array(z.string().max(300)),
  parsed_at: z.string(),
  rules_only: z.boolean(),
});

export type JdParse = z.infer<typeof JdParseSchema>;
export type RedFlag = z.infer<typeof RedFlagSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type JdSalary = z.infer<typeof SalarySchema>;
export type YearsRequired = z.infer<typeof YearsRequiredSchema>;

// ── Default / empty parse ─────────────────────────────────────────────────────

export function emptyJdParse(): JdParse {
  return {
    title: "",
    company: "",
    location: "",
    remote_policy: "unknown",
    seniority: "unknown",
    years_required: null,
    must_have: [],
    nice_to_have: [],
    tools: [],
    salary: null,
    contract_type: "unknown",
    start_date: null,
    closing_date: null,
    posted_or_updated: null,
    red_flags: [],
    verdict: "go",
    verdict_reasons: [],
    parsed_at: new Date().toISOString(),
    rules_only: true,
  };
}

// ── JSON Schema for the Python worker (Ollama structured-output format) ───────
// A flat, tight schema: only what the worker needs to fill in when the rules
// find fewer than 3 must-haves or no seniority.

export const JD_LLM_SCHEMA = {
  type: "object",
  properties: {
    seniority: {
      type: "string",
      enum: ["graduate", "junior", "mid", "senior", "unknown"],
    },
    must_have: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          category: {
            type: "string",
            enum: ["technical", "domain", "soft", "qualification", "unknown"],
          },
          source_phrase: { type: "string" },
        },
        required: ["skill", "category", "source_phrase"],
        additionalProperties: false,
      },
    },
    nice_to_have: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          category: {
            type: "string",
            enum: ["technical", "domain", "soft", "qualification", "unknown"],
          },
          source_phrase: { type: "string" },
        },
        required: ["skill", "category", "source_phrase"],
        additionalProperties: false,
      },
    },
  },
  required: ["seniority", "must_have", "nice_to_have"],
  additionalProperties: false,
} as const;

// ── Verdict from flags ────────────────────────────────────────────────────────

export function verdictFromFlags(flags: RedFlag[]): JdParse["verdict"] {
  if (flags.some((f) => f.severity === "hard")) return "skip";
  if (flags.length > 0) return "check";
  return "go";
}

// ── Normalise / bound a stored parse on read ──────────────────────────────────

export function normalizeJdParse(raw: unknown): JdParse | null {
  const result = JdParseSchema.safeParse(raw);
  return result.success ? result.data : null;
}
