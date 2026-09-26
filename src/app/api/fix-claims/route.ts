// "Fix it" on /app: makes the tailored CV and letter, AS EDITED in the
// preview, pass the claims check — without another tailor and without
// spending a tailor credit. lib/claimRepair does the work, cheapest first:
//   0. project-level tools moved out of the lead Technical Tools (no words change)
//   1. exact trims: only the flagged skill's own words go ("LLM/RAG" → "LLM")
//   2. ONE model call rewrites what is left, with the job's terms in view;
//      a rewrite that breaks a rule on its own is not applied
//   3. anything still failing is removed
// so one click always ends in a document that passes. Burst-limited, never
// metered (the pre-check's policy: a single small call attached to a run the
// daily counter already paid for). The server reads no per-user table: the
// registry, CV and pool arrive in the body, as on /api/tailor.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { callForUser } from "@/lib/llmRouting";
import { ProviderCreditError, ProviderRateLimitError } from "@/lib/claude";
import { normalizeClaims, renderClaimsBlock, demoteProjectTools, TOOLS_LEAD_SLOTS } from "@/lib/claims";
import {
  checkSections,
  listRepairs,
  surgicalUntilStable,
  normalizeRepairEdits,
  applyModelEdits,
  replacementPasses,
  dropUntilClean,
  type RepairSections,
  type RepairChange,
} from "@/lib/claimRepair";
import { unsupportedProperNouns } from "@/lib/properNouns";
import { buildEvidenceMap, graftRules } from "@/lib/evidenceMap";
import { claimsRepairPrompt } from "@/prompts/steps";
import {
  MAX_CV_CHARS,
  MAX_JD_CHARS,
  MAX_POOL_CHARS,
  MAX_CLAIMS_JSON,
  MAX_COVER_LETTER_CHARS,
  CV_TOO_LONG,
  JD_TOO_LONG,
  POOL_TOO_LONG,
} from "@/lib/limits";

export const maxDuration = 120;

const MAX_SECTION_CHARS = 4_000; // summary, skills
const MAX_PROJECT_KEYS = 20;
const MAX_PROJECT_BULLETS = 20;
const MAX_BULLET_CHARS = 1_200;
const MAX_ANALYSIS_JSON = 20_000;
// One call; a CV with more flagged sentences than this has the rest removed.
const MAX_MODEL_ITEMS = 20;

// undefined/null → ""; a non-string or an over-long string → null (reject).
function boundedString(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return "";
  return typeof v === "string" && v.length <= max ? v : null;
}

function boundedProjects(v: unknown): Record<string, string[]> | null {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_PROJECT_KEYS) return null;
  const out: Record<string, string[]> = {};
  for (const [key, list] of entries) {
    if (!Array.isArray(list) || list.length > MAX_PROJECT_BULLETS || key.length > 20) return null;
    const bullets = list.filter((b): b is string => typeof b === "string");
    if (bullets.some((b) => b.length > MAX_BULLET_CHARS)) return null;
    out[key] = bullets;
  }
  return out;
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 100)).slice(0, 30) : [];

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    const burst = await checkBurstLimit(userId, "fix-claims");
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const cv = boundedString(body.cvText, MAX_CV_CHARS);
    if (cv === null) return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    if (!cv.trim()) return NextResponse.json({ error: "Your master CV is needed to check the claims against." }, { status: 400 });
    const jd = boundedString(body.jobDescription, MAX_JD_CHARS);
    if (jd === null) return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    const pool = boundedString(body.projectsPool, MAX_POOL_CHARS);
    if (pool === null) return NextResponse.json({ error: POOL_TOO_LONG }, { status: 400 });
    if (body.claims !== undefined && JSON.stringify(body.claims).length > MAX_CLAIMS_JSON) {
      return NextResponse.json({ error: "Claims registry is too large." }, { status: 400 });
    }
    const claims = normalizeClaims(body.claims);
    if (body.analysis !== undefined && JSON.stringify(body.analysis).length > MAX_ANALYSIS_JSON) {
      return NextResponse.json({ error: "Job analysis is too large." }, { status: 400 });
    }
    const analysis = body.analysis && typeof body.analysis === "object" ? (body.analysis as Record<string, unknown>) : {};

    const sec = body.sections && typeof body.sections === "object" ? (body.sections as Record<string, unknown>) : null;
    if (!sec) return NextResponse.json({ error: "No CV sections to fix." }, { status: 400 });
    const summary = boundedString(sec.summary, MAX_SECTION_CHARS);
    const skills = boundedString(sec.skills, MAX_SECTION_CHARS);
    const experience = boundedString(sec.experience, MAX_CV_CHARS);
    const coverLetter = boundedString(sec.coverLetter, MAX_COVER_LETTER_CHARS);
    const projects = boundedProjects(sec.projects);
    if (summary === null || skills === null || experience === null || coverLetter === null || projects === null) {
      return NextResponse.json({ error: "The CV sections are malformed or too long." }, { status: 400 });
    }

    const sources = [cv, pool];
    // The posting's technologies the master CV never shows, and those only a
    // project shows — the same rules the tailor route checks against.
    const grafts = graftRules(buildEvidenceMap(analysis, cv, pool, claims));
    let cur: RepairSections = { summary, skills, experience, projects, coverLetter };
    const changes: RepairChange[] = [];

    // 0. The lead-tool rule without touching a word, when the line is long
    //    enough to move the tool down.
    const projectNames = (claims?.skills ?? []).filter((k) => k.level === "project").map((k) => k.name);
    const demoted = demoteProjectTools(cur.skills, projectNames);
    if (demoted.demoted.length > 0 && typeof demoted.skills === "string") {
      changes.push({
        section: "skills",
        before: demoted.demoted.join(", "),
        after: `Moved ${demoted.demoted.join(", ")} out of the first ${TOOLS_LEAD_SLOTS} Technical Tools`,
        how: "reordered",
      });
      cur = { ...cur, skills: demoted.skills };
    }

    // 1. Exact trims.
    const trimmed = surgicalUntilStable(cur, claims, sources, jd, grafts);
    cur = trimmed.sections;
    changes.push(...trimmed.changes);

    // 2. One model call for what is left.
    const items = listRepairs(cur, checkSections(cur, claims, sources, jd, grafts), claims).slice(0, MAX_MODEL_ITEMS);
    const model: { used: boolean; provider: string | null; fallback: boolean; rejected: number; error: string | null } = {
      used: false,
      provider: null,
      fallback: false,
      rejected: 0,
      error: null,
    };
    if (items.length > 0) {
      const job = {
        title: typeof analysis.role_title === "string" ? analysis.role_title.slice(0, 120) : "",
        keywords: stringList(analysis.top_15_ats_keywords),
        required: stringList(analysis.required_skills),
      };
      // A name the rewrite introduces must exist somewhere: in the master CV
      // or pool for the CV itself (a JD-only tool in a bullet is a graft,
      // rule 6), and also in the posting for the summary (its role title)
      // and the letter.
      const cvNameSources = [cv, pool];
      const openNameSources = [jd, cv, pool, JSON.stringify(analysis)];
      try {
        const out = await callForUser(supabase, userId, body.provider, {
          system: claimsRepairPrompt(cv, renderClaimsBlock(claims), job),
          userInput: JSON.stringify({ items: items.map(({ id, section, sentence, problems }) => ({ id, section, sentence, problems })) }),
          expectJson: true,
          maxTokens: 3000,
        });
        model.used = true;
        model.provider = out.provider;
        model.fallback = out.fallback;
        const edits = normalizeRepairEdits(out.result, items);
        const applied = applyModelEdits(cur, items, edits, (it, rep) => {
          if (!replacementPasses(rep, it.section, claims, sources, jd, grafts)) return false;
          const names = it.section === "summary" || it.section === "coverLetter" ? openNameSources : cvNameSources;
          return unsupportedProperNouns(rep, names).filter((n) => !unsupportedProperNouns(it.sentence, names).includes(n)).length === 0;
        });
        cur = applied.sections;
        changes.push(...applied.changes);
        model.rejected = applied.rejected;
      } catch (e) {
        // The trims and the drop below still produce a document that passes;
        // the response says the rewrite was unavailable.
        model.error = e instanceof ProviderCreditError ? "provider_credit" : e instanceof ProviderRateLimitError ? "provider_limit" : "failed";
        console.error("Fix-claims model call failed:", e instanceof Error ? e.message : String(e));
      }
    }

    // 3. Whatever still fails is removed.
    const dropped = dropUntilClean(cur, claims, sources, jd, grafts);
    cur = dropped.sections;
    changes.push(...dropped.changes);

    return NextResponse.json({ sections: cur, claimCheck: checkSections(cur, claims, sources, jd, grafts), changes, model });
  } catch (error) {
    console.error("Fix-claims API error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Couldn't fix the flagged claims. Edit the highlighted text in the preview instead — the re-check is free." }, { status: 500 });
  }
}
