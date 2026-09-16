// Stage 4 — interview prep pack for one tracker application.
//
// POST { applicationId, force?, provider? } →
//   { pack, cached: true }                              existing pack, no charge
//   { pack, cached: false, saved, warning? }             freshly generated
//
// Order matters for the wallet, exactly as in /api/research: everything free
// (row, master CV, profile, cached research, talking points) is gathered
// first; a missing JD or CV answers 400 before any metering; a cached pack
// returns before any metering. Only then does the shared routing brain spend
// one tailor credit and the single model call fires — refunded if it throws
// or returns an unusable pack. The pack is cached on the row so opening it
// again is free; `force` regenerates and is charged again.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { resolveLlmRoute, formatDuration } from "@/lib/llmRouting";
import { MAX_CV_CHARS, CV_TOO_LONG, MAX_JD_CHARS, MAX_PREP_PACK_JSON } from "@/lib/limits";
import { interviewPrepPrompt } from "@/prompts/steps";
import { sanitizeCompanyResearch } from "@/lib/companyResearch";
import { companyNamesMatch } from "@/lib/companyMatch";
import {
  normalizePrepPack,
  verifyEvidence,
  packFromRow,
  flattenTailoredCv,
  extractTalkingPoints,
  type PrepSources,
} from "@/lib/prepPack";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Migrations are applied by hand; the column can be missing (42703 on reads,
// PGRST204 on writes) — same handling as applications.tailored_cv.
function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}
export const PREP_WARNING =
  "Your prep pack was generated but couldn't be saved to this application: the database is missing migration 20260915120000_applications_prep_pack.sql. Run it in the Supabase SQL editor, then regenerate to keep it.";

// Thrown inside the metered block when the model's JSON doesn't normalize into
// a usable pack, so the credit is refunded like any other failed run.
class PrepPackError extends Error {}

const ROW_COLUMN_LADDER = [
  "id, company_name, role, status, notes, job_description, tailored_cv, prep_pack",
  "id, company_name, role, status, notes, job_description, tailored_cv",
  "id, company_name, role, status, notes, job_description",
];

type Row = {
  id: string;
  company_name: string;
  role: string;
  status: string;
  notes: string | null;
  job_description: string | null;
  tailored_cv?: unknown;
  prep_pack?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    // ── Burst rate limit — first, before any DB work ──────────────────────────
    const burst = await checkBurstLimit(userId, "prep");
    if (!burst.ok) {
      return NextResponse.json(
        {
          error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.`,
          errorType: "provider_limit",
          retryAfter: burst.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
    const force = body.force === true;
    if (!UUID_RE.test(applicationId)) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    // ── The application row (RLS + explicit user scope), column ladder ────────
    let row: Row | null = null;
    let prepColumnMissing = false;
    for (let rung = 0; rung < ROW_COLUMN_LADDER.length; rung++) {
      const { data, error } = await supabase
        .from("applications")
        .select(ROW_COLUMN_LADDER[rung])
        .eq("id", applicationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error && isMissingColumn(error) && rung < ROW_COLUMN_LADDER.length - 1) {
        if (rung === 0) prepColumnMissing = true;
        continue;
      }
      if (error) {
        console.error("prep: application read error:", error.message);
        return NextResponse.json({ error: "Could not load that application" }, { status: 500 });
      }
      row = (data as unknown as Row | null) ?? null;
      break;
    }
    if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    // ── Cached pack: free ─────────────────────────────────────────────────────
    if (!force) {
      const existing = packFromRow(row.prep_pack);
      if (existing) return NextResponse.json({ pack: existing, cached: true });
    }

    const jd = (row.job_description ?? "").trim().slice(0, MAX_JD_CHARS);
    if (!jd) {
      return NextResponse.json(
        {
          error: "Add the job description to this application first — the prep pack is built from it.",
          errorType: "needs_jd",
        },
        { status: 400 }
      );
    }

    // ── Master CV (the only source of evidence) ───────────────────────────────
    const { data: cvRow, error: cvError } = await supabase.from("master_cvs").select("text").maybeSingle();
    if (cvError) {
      console.error("prep: master CV read error:", cvError.message);
      return NextResponse.json({ error: "Could not load your master CV" }, { status: 500 });
    }
    const cv = typeof cvRow?.text === "string" ? cvRow.text.trim() : "";
    if (!cv) {
      return NextResponse.json(
        { error: "Save your master CV in Customize first — every answer is built from it.", errorType: "needs_cv" },
        { status: 400 }
      );
    }
    if (cv.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }

    // ── Optional context: cached company research for this company ───────────
    // The row doesn't store the domain, so match the user's own cached rows by
    // company name. A missing table degrades to "no research".
    let research: Record<string, unknown> | null = null;
    let matchedStack: string[] = [];
    let knownGaps: string[] = [];
    {
      // An active job hunt accumulates a cached row per company researched
      // (the owner passed 48 within weeks) — read enough to actually find it.
      const { data: rows, error: rError } = await supabase
        .from("company_profiles")
        .select("data")
        .eq("user_id", userId)
        .order("fetched_at", { ascending: false })
        .limit(300);
      if (rError) {
        console.warn("prep: research cache unavailable:", rError.message);
      } else if (Array.isArray(rows)) {
        for (const r of rows) {
          const data = (r as { data?: unknown }).data as Record<string, unknown> | undefined;
          const profile = data?.profile as Record<string, unknown> | undefined;
          const got = typeof profile?.company_name === "string" ? profile.company_name : "";
          if (!companyNamesMatch(row.company_name, got)) continue;
          research = sanitizeCompanyResearch(profile);
          const fit = data?.fitScore as Record<string, unknown> | undefined;
          const list = (v: unknown) =>
            Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, 80)).slice(0, 25) : [];
          matchedStack = list(fit?.matched_stack);
          knownGaps = list(fit?.missing_stack);
          break;
        }
      }
    }

    const tailoredCvText = flattenTailoredCv(row.tailored_cv, 6_000);
    const talkingPoints = extractTalkingPoints(row.notes, 1_500);
    const sources: PrepSources = {
      jd: true,
      tailoredCv: tailoredCvText.length > 0,
      research: research !== null,
      talkingPoints: talkingPoints !== null,
    };

    // ── Quota + provider routing (one tailor credit — shared brain) ───────────
    const route = await resolveLlmRoute(supabase, userId, {
      bodyProvider: body.provider,
      geminiOnlyMessage:
        "Interview prep runs on an OpenRouter key once your free Claude credits are used — your saved Gemini key isn't used for it. Add an OpenRouter key in Settings to continue.",
    });
    if (!route.ok) {
      return NextResponse.json(route.body, { status: route.status });
    }

    // ── The one paid call ─────────────────────────────────────────────────────
    const userInput = JSON.stringify({
      company: row.company_name,
      role: row.role,
      status: row.status,
      job_description: jd,
      ...(tailoredCvText ? { tailored_cv_text: tailoredCvText } : {}),
      ...(research ? { company_research: research } : {}),
      ...(matchedStack.length ? { matched_stack: matchedStack } : {}),
      ...(knownGaps.length ? { known_stack_gaps: knownGaps } : {}),
      ...(talkingPoints ? { existing_talking_points: talkingPoints } : {}),
    });

    let pack;
    try {
      const raw = await callLLM({
        provider: route.provider,
        apiKeyOverride: route.apiKeyOverride,
        system: interviewPrepPrompt(cv),
        userInput,
        expectJson: true,
        // A 10-question pack with the prompt's word caps is ~4-5k tokens.
        // Headroom matters: on a max_tokens stop callLLM re-runs the whole
        // call at double the budget — a second full generation.
        maxTokens: 8000,
      });
      const normalized = normalizePrepPack(raw, {
        company: row.company_name,
        role: row.role,
        generatedAt: new Date().toISOString(),
        sources,
      });
      if (!normalized) throw new PrepPackError("pack did not normalize");
      pack = verifyEvidence(normalized, cv);
      if (JSON.stringify(pack).length > MAX_PREP_PACK_JSON) throw new PrepPackError("pack too large");
    } catch (err) {
      await route.refund();
      if (err instanceof PrepPackError) {
        console.error("prep: unusable pack:", err.message);
        return NextResponse.json(
          { error: "The model returned an unusable prep pack. Your credit was refunded — try again.", errorType: "bad_pack" },
          { status: 500 }
        );
      }
      if (route.reason === "own_key" && err instanceof ProviderRateLimitError) {
        return NextResponse.json(
          { limitReached: true, error: "Your OpenRouter key has hit its usage limit. Try again later.", errorType: "user_key_limit" },
          { status: 429 }
        );
      }
      throw err;
    }

    // ── Cache on the row — best effort; a missing column returns it unsaved ───
    let saved = false;
    let warning: string | undefined;
    if (prepColumnMissing) {
      warning = PREP_WARNING;
    } else {
      const { error: writeError } = await supabase
        .from("applications")
        .update({ prep_pack: pack })
        .eq("id", applicationId)
        .eq("user_id", userId);
      if (!writeError) saved = true;
      else if (isMissingColumn(writeError)) warning = PREP_WARNING;
      else {
        console.error("prep: pack write error:", writeError.message);
        warning = "Your prep pack was generated but couldn't be saved to this application — it's shown now but won't be here next time.";
      }
    }

    return NextResponse.json({ pack, cached: false, saved, ...(warning ? { warning } : {}) });
  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      const retryMsg = error.retryAfterSeconds
        ? `Resets in ~${formatDuration(error.retryAfterSeconds * 1000)}.`
        : "Try again shortly.";
      console.error("Provider rate limit:", error.provider, error.message);
      return NextResponse.json(
        { error: `The service is busy right now. ${retryMsg}`, errorType: "provider_limit", retryAfter: error.retryAfterSeconds ?? null },
        { status: 429 }
      );
    }
    console.error("Prep API error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Couldn't build your prep pack" }, { status: 500 });
  }
}
