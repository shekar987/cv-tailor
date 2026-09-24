import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, callLLM, ProviderCreditError } from "@/lib/claude";
import { loadOwnOpenRouterKey } from "@/lib/llmRouting";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { JD_ANALYZER_PROMPT } from "@/prompts/steps";
import { matchAtsKeywords } from "@/lib/atsMatch";
import {
  detectGates,
  mergeModelGates,
  compareGates,
  readVerdict,
  jdQuality,
  normalizeEligibility,
  isEligibilitySet,
} from "@/lib/knockouts";
import { MAX_CV_CHARS, MAX_JD_CHARS, MAX_ELIGIBILITY_JSON, CV_TOO_LONG, JD_TOO_LONG } from "@/lib/limits";
import { classifySeniority, seniorityFit } from "@/lib/seniority";

// Rows the user already saved with this exact job description. Goes through
// an RPC because a 15k-char JD can't ride in a PostgREST filter URL; the
// function is SECURITY INVOKER so RLS applies. A missing function (migration
// not applied) or any error simply means "no duplicate check".
type DuplicateRow = { id: string; company_name: string; role: string; date_applied: string };
let warnedDuplicateLookup = false;
async function findDuplicates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jd: string
): Promise<DuplicateRow[] | null> {
  try {
    const { data, error } = await supabase.rpc("find_applications_by_jd", { p_jd: jd });
    if (error) {
      if (!warnedDuplicateLookup) {
        warnedDuplicateLookup = true;
        console.warn("analyze: duplicate-JD lookup unavailable:", error.message);
      }
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    return data
      .filter((r): r is DuplicateRow => !!r && typeof r === "object" && typeof (r as DuplicateRow).id === "string")
      .slice(0, 3)
      .map((r) => ({
        id: r.id,
        company_name: String(r.company_name ?? ""),
        role: String(r.role ?? ""),
        date_applied: String(r.date_applied ?? ""),
      }));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Burst limit: this endpoint calls Claude on the owner's key with no DB
    // quota, so an unmetered loop here would drain the wallet. Gate it.
    // Deliberately NOT the tailor-count/lifetime RPCs — this call (JD
    // analysis alone, a fraction of a full tailor run) must not consume one of
    // the paid-tailor quota slots. Those RPCs only fire inside /api/tailor when
    // the full pipeline actually runs.
    const userId = data.claims.sub as string;
    const burst = await checkBurstLimit(userId, "analyze");
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

    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (jobDescription.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    }
    // cvText is optional: when present, this doubles as the pre-tailoring
    // gate (Step 1 only, plus local keyword and eligibility checks — no extra
    // LLM call). When absent, behaviour is the original standalone analysis
    // plus the free gate/quality/duplicate reads.
    const cvText = typeof body.cvText === "string" ? body.cvText : "";
    if (cvText.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }
    // The user's eligibility answers, sent along by the client (never read
    // from a table here). Absent or empty → every gate is "unknown".
    if (body.eligibility !== undefined && JSON.stringify(body.eligibility).length > MAX_ELIGIBILITY_JSON) {
      return NextResponse.json({ error: "Eligibility profile is too large." }, { status: 400 });
    }
    const eligibility = normalizeEligibility(body.eligibility);

    // Free, and independent of the model call — run it alongside.
    const duplicatesPromise = findDuplicates(supabase, jobDescription);

    // The shared account out of credit: the same analysis on the user's own
    // OpenRouter key, once (lib/fallbackRoute); without a key, the 503 below.
    let result: unknown;
    let fallback: { from: "anthropic"; to: "openrouter"; source: "own_key"; reason: "provider_credit" } | null = null;
    try {
      result = await callClaude({
        system: JD_ANALYZER_PROMPT,
        userInput: jobDescription,
        expectJson: true,
      });
    } catch (e) {
      if (!(e instanceof ProviderCreditError)) throw e;
      const own = await loadOwnOpenRouterKey(supabase, userId);
      if (!own.key) throw e;
      console.warn("Analyze fallback: anthropic → openrouter (own_key) after provider_credit");
      result = await callLLM({ provider: "openrouter", apiKeyOverride: own.key, system: JD_ANALYZER_PROMPT, userInput: jobDescription, expectJson: true });
      fallback = { from: "anthropic", to: "openrouter", source: "own_key", reason: "provider_credit" };
    }

    const analysis = (result && typeof result === "object" ? result : {}) as {
      top_15_ats_keywords?: unknown;
      required_skills?: unknown;
      hard_gates?: unknown;
      role_title?: unknown;
    };

    // Knockout gates: deterministic detection is the source of truth; the
    // model's hard_gates only add coverage and only when quoted verbatim.
    const gates = mergeModelGates(detectGates(jobDescription), analysis.hard_gates, jobDescription);
    const verdicts = compareGates(gates, eligibility);
    const duplicateOf = await duplicatesPromise;
    const quality = jdQuality(jobDescription);
    // Seniority read (lib/seniority): which level the posting is written
    // for, against the candidate's stated years — before a credit is spent.
    const seniority = seniorityFit(
      classifySeniority(jobDescription, typeof analysis.role_title === "string" ? analysis.role_title : null),
      eligibility.yearsExperience
    );

    if (cvText.trim()) {
      const atsPreCheck = matchAtsKeywords(cvText, analysis.top_15_ats_keywords);
      const requiredPreCheck = matchAtsKeywords(cvText, analysis.required_skills);
      const read = readVerdict(verdicts, requiredPreCheck.total > 0 ? requiredPreCheck : null, atsPreCheck.total > 0 ? atsPreCheck : null);
      return NextResponse.json({
        result,
        atsPreCheck,
        requiredPreCheck,
        knockouts: { profileSet: isEligibilitySet(eligibility), verdicts, read },
        seniority,
        jdQuality: quality,
        duplicateOf,
        fallback,
      });
    }

    const read = readVerdict(verdicts, null, null);
    return NextResponse.json({
      result,
      knockouts: { profileSet: isEligibilitySet(eligibility), verdicts, read },
      seniority,
      jdQuality: quality,
      duplicateOf,
      fallback,
    });
  } catch (error) {
    if (error instanceof ProviderCreditError) {
      console.error("Provider credit exhausted:", error.provider);
      return NextResponse.json(
        {
          error:
            "The pre-check is temporarily unavailable — the shared Claude account has run out of credit. " +
            "This isn't your account: add your own free OpenRouter key in Settings.",
          errorType: "provider_credit",
        },
        { status: 503 }
      );
    }
    console.error("Analyze API error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Failed to analyze JD" }, { status: 500 });
  }
}
