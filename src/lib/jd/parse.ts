// JD parse orchestrator (TL-3, 27 Nov 2026).
//
// 1. Runs all deterministic rules (lib/jd/rules.ts) — no network.
// 2. Maps jdTriage hits to JdParse red-flag codes (the two rule sets overlap;
//    the merge deduplicates by code).
// 3. Only if fewer than 3 must-haves OR no seniority detected: calls the local
//    Ollama provider with a JSON-schema prompt to fill in the gaps.
//    Every LLM-extracted item whose source_phrase cannot be found verbatim
//    in the JD text is dropped — the honesty rule.
// 4. Assembles a validated JdParse, computes the verdict and returns it.
//
// Imports only lib/triage/jdTriage.ts, lib/jd/rules.ts, lib/jd/schema.ts
// and (optionally) an LLM caller injected at runtime — so the module runs
// under node:test with a mock LLM.

import { triageJd } from "../triage/jdTriage.ts";
import {
  runRules,
  type RulesOutput,
} from "./rules.ts";
import {
  verdictFromFlags,
  normalizeJdParse,
  emptyJdParse,
  RED_FLAG_SEVERITY,
  RED_FLAG_LABELS,
  JD_LLM_SCHEMA,
  type JdParse,
  type RedFlag,
  type RedFlagCode,
  type Requirement,
} from "./schema.ts";

// ── Triage-code → JdParse-code mapping ───────────────────────────────────────
// jdTriage uses different string keys; we map them here rather than coupling
// jdTriage to this module's red-flag vocabulary.

const TRIAGE_TO_FLAGCODE: Record<string, RedFlagCode> = {
  years: "YEARS_3_PLUS",
  clearance: "SECURITY_CLEARANCE",
  residence: "UK_RESIDENCE_5Y",
  contract: "CONTRACT_OR_DAY_RATE",
  contractor: "CONTRACT_OR_DAY_RATE",
  sponsorship: "NO_SPONSORSHIP_EVER",
  fixed_term: "FIXED_TERM",
  rtw_permanent: "NO_SPONSORSHIP_EVER",
  tech_required: "UNDEFENDABLE_CORE_SKILL",
  // rtw_programme: no direct mapping — it's a warning, not a hard skip for us
};

function triageHitsToFlags(jd: string): RedFlag[] {
  const triage = triageJd(jd);
  const flags: RedFlag[] = [];

  for (const hit of triage.hits) {
    const code = TRIAGE_TO_FLAGCODE[hit.rule];
    if (!code) continue;
    flags.push({
      code,
      severity: RED_FLAG_SEVERITY[code],
      label: RED_FLAG_LABELS[code],
      phrase: hit.sentence.slice(0, 180),
    });
  }

  return flags;
}

// ── Merge flags without duplicates ────────────────────────────────────────────

function mergeFlags(a: RedFlag[], b: RedFlag[]): RedFlag[] {
  const seen = new Set<string>();
  const result: RedFlag[] = [];
  for (const f of [...a, ...b]) {
    if (!seen.has(f.code)) {
      seen.add(f.code);
      result.push(f);
    }
  }
  return result;
}

// ── LLM provider interface ────────────────────────────────────────────────────
// The caller injects this so parse.ts stays testable without a real Ollama.

export interface LlmProvider {
  complete(opts: {
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
  }): Promise<unknown>;
}

// ── LLM gap-fill prompt ───────────────────────────────────────────────────────

function buildGapPrompt(jd: string): { system: string; prompt: string } {
  const system = [
    "You are a job description parser. Extract structured information from the JD.",
    "",
    "Rules:",
    "- Extract ONLY requirements explicitly stated in the JD. Never invent.",
    "- For every extracted skill, copy the exact phrase from the JD as source_phrase.",
    "- If a field is not stated, use 'unknown' or omit it.",
    "- Return JSON matching the schema exactly.",
  ].join("\n");

  const prompt = [
    "=== JOB DESCRIPTION ===",
    jd.slice(0, 8_000),
    "",
    "Extract: seniority level, must-have requirements and nice-to-have requirements.",
    "Each requirement needs: skill (short name), category (technical/domain/soft/qualification/unknown), source_phrase (verbatim from the JD).",
  ].join("\n");

  return { system, prompt };
}

// ── Honesty filter: drop any LLM item whose source_phrase is not in the JD ──

function phraseInJd(phrase: string, jd: string): boolean {
  if (!phrase || phrase.length < 4) return false;
  const needle = phrase.toLowerCase().trim();
  return jd.toLowerCase().includes(needle);
}

function filterHonestRequirements(items: unknown[], jd: string): Requirement[] {
  if (!Array.isArray(items)) return [];
  const result: Requirement[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const skill = typeof o.skill === "string" ? o.skill.trim() : "";
    const category = ["technical", "domain", "soft", "qualification", "unknown"].includes(o.category as string)
      ? (o.category as Requirement["category"])
      : "unknown";
    const source_phrase = typeof o.source_phrase === "string" ? o.source_phrase.trim() : "";
    const section = typeof o.section === "string" && o.section === "nice_to_have" ? "nice_to_have" : "must_have";

    if (!skill || skill.length > 150) continue;
    if (!phraseInJd(source_phrase, jd)) continue; // honesty gate

    result.push({ skill: skill.slice(0, 150), category, source_phrase: source_phrase.slice(0, 200), section });
  }
  return result;
}

// ── Main parse function ───────────────────────────────────────────────────────

export interface ParseOptions {
  /** Injected LLM provider. If undefined, no LLM call is made. */
  llm?: LlmProvider;
  /** Override salary floor (default 35000). */
  salaryFloor?: number;
  /** Override stale-posting threshold in days (default 60). */
  staleDays?: number;
}

export async function parseJd(jd: string, opts: ParseOptions = {}): Promise<JdParse> {
  const text = jd.slice(0, 20_000);

  // 1. Deterministic rules
  const rules: RulesOutput = runRules(text, { salaryFloor: opts.salaryFloor, staleDays: opts.staleDays });

  // 2. jdTriage red flags (deduplicated merge)
  const triageFlags = triageHitsToFlags(text).filter(
    (f) => !(f.code === "CONTRACT_OR_DAY_RATE" && rules.contract_type === "fixed_term")
  );
  const allFlags = mergeFlags(rules.red_flags, triageFlags);

  // 3. LLM gap-fill if fewer than 3 must-haves OR seniority unknown
  let mustHave = rules.must_have;
  let niceToHave = rules.nice_to_have;
  let seniority = rules.seniority;
  let rulesOnly = true;

  const needsLlm = (mustHave.length < 3 || seniority === "unknown") && opts.llm !== undefined;
  if (needsLlm && opts.llm) {
    rulesOnly = false;
    try {
      const { system, prompt } = buildGapPrompt(text);
      const raw = await opts.llm.complete({ system, prompt, jsonSchema: JD_LLM_SCHEMA });

      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;

        // Merge seniority
        const llmSeniority = o.seniority as string | undefined;
        if (seniority === "unknown" && ["graduate", "junior", "mid", "senior"].includes(llmSeniority ?? "")) {
          seniority = llmSeniority as JdParse["seniority"];
        }

        // Merge must_have (honesty-filtered; prefer rules' items)
        if (Array.isArray(o.must_have)) {
          const llmMust = filterHonestRequirements(o.must_have, text);
          const ruleSkills = new Set(mustHave.map((r) => r.skill.toLowerCase()));
          for (const r of llmMust) {
            if (!ruleSkills.has(r.skill.toLowerCase())) {
              mustHave = [...mustHave, { ...r, section: "must_have" }];
            }
          }
        }

        // Merge nice_to_have
        if (Array.isArray(o.nice_to_have)) {
          const llmNice = filterHonestRequirements(o.nice_to_have, text);
          const niceSkills = new Set(niceToHave.map((r) => r.skill.toLowerCase()));
          for (const r of llmNice) {
            if (!niceSkills.has(r.skill.toLowerCase())) {
              niceToHave = [...niceToHave, { ...r, section: "nice_to_have" }];
            }
          }
        }
      }
    } catch {
      // LLM failure is non-fatal — rules result is still used
    }
  }

  // 4. Verdict
  const verdict = verdictFromFlags(allFlags);
  const verdictReasons = allFlags
    .filter((f) => f.severity === "hard" ? verdict === "skip" : verdict !== "go")
    .map((f) => `${f.label}: "${f.phrase}"`)
    .slice(0, 10);

  // 5. Assemble and validate
  const raw: JdParse = {
    title: rules.meta.title,
    company: rules.meta.company,
    location: rules.meta.location,
    remote_policy: rules.remote_policy,
    seniority,
    years_required: rules.years_required,
    must_have: mustHave.slice(0, 30),
    nice_to_have: niceToHave.slice(0, 20),
    tools: rules.tools,
    salary: rules.salary,
    contract_type: rules.contract_type,
    start_date: rules.start_date,
    closing_date: null,
    posted_or_updated: rules.posted_phrase,
    red_flags: allFlags,
    verdict,
    verdict_reasons: verdictReasons,
    parsed_at: new Date().toISOString(),
    rules_only: rulesOnly,
  };

  return normalizeJdParse(raw) ?? emptyJdParse();
}

// ── Hash helper (for jd_parses cache key) ────────────────────────────────────
// A fast 32-bit djb2 hash — not cryptographic, just for deduplication.

export function jdHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) & 0xffff_ffff;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
