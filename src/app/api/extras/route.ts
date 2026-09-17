// Stage 3 high-fit extras: a spoken pitch script and interview talking
// points, offered on /app when the Fit Score comes back 80+ and a tailored
// result exists. One model call each on the default provider, burst-limited;
// deliberately no DB quota — these are single cheap calls attached to work
// the daily counter already metered (the research + tailor runs).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { MAX_CV_CHARS, CV_TOO_LONG, MAX_CLAIMS_JSON } from "@/lib/limits";
import { sanitizeCompanyResearch } from "@/lib/companyResearch";
import { normalizeClaims, renderClaimsBlock, checkClaims } from "@/lib/claims";
import { pitchScriptPrompt, talkingPointsPrompt, coldEmailPrompt } from "@/prompts/steps";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    const burst = await checkBurstLimit(userId, "extras");
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

    const kind =
      body.kind === "pitch" || body.kind === "talking_points" || body.kind === "cold_email" ? body.kind : null;
    const cv = typeof body.cvText === "string" ? body.cvText.trim() : "";
    const research = sanitizeCompanyResearch(body.companyResearch);
    if (!kind) return NextResponse.json({ error: "Unknown extra requested" }, { status: 400 });
    if (!cv) return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    if (cv.length > MAX_CV_CHARS) return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    if (!research) {
      return NextResponse.json({ error: "Run the company research first — these are built from it." }, { status: 400 });
    }
    // The claims registry rides along from the client (never read from a
    // table here); the prompts get it rendered, the output is checked.
    if (body.claims !== undefined && JSON.stringify(body.claims).length > MAX_CLAIMS_JSON) {
      return NextResponse.json({ error: "Claims registry is too large." }, { status: 400 });
    }
    const claims = normalizeClaims(body.claims);
    const claimsBlock = renderClaimsBlock(claims);

    // Cold email drafts are owner-only for now. Same gate as the provider
    // selector: profiles.is_unlimited, read under RLS (own row only) and
    // fail-closed — any read problem means not available.
    if (kind === "cold_email") {
      const { data: profRow, error: profErr } = await supabase.from("profiles").select("is_unlimited").maybeSingle();
      if (profErr || profRow?.is_unlimited !== true) {
        return NextResponse.json({ error: "Cold email drafts aren't available on this account yet." }, { status: 403 });
      }
    }

    // Cold-email personalisation — user-typed, size-capped, optional. The
    // prompt only uses personal_note faithfully and skips the line entirely
    // when absent (it must never invent a connection).
    const recipientName = typeof body.recipientName === "string" ? body.recipientName.trim().slice(0, 80) : "";
    const personalNote = typeof body.personalNote === "string" ? body.personalNote.trim().slice(0, 300) : "";

    // Only the analysis fields the prompts benefit from; ignored if absent.
    const a = body.analysis && typeof body.analysis === "object" ? (body.analysis as Record<string, unknown>) : null;
    const jdAnalysis = a
      ? {
          role_title: typeof a.role_title === "string" ? a.role_title.slice(0, 200) : undefined,
          company_name: typeof a.company_name === "string" ? a.company_name.slice(0, 200) : undefined,
          top_15_ats_keywords: Array.isArray(a.top_15_ats_keywords)
            ? a.top_15_ats_keywords.filter((k): k is string => typeof k === "string").slice(0, 15)
            : undefined,
        }
      : undefined;

    const text = await callLLM({
      provider: "anthropic",
      apiKeyOverride: undefined,
      system:
        kind === "pitch"
          ? pitchScriptPrompt(cv, claimsBlock)
          : kind === "talking_points"
            ? talkingPointsPrompt(cv, claimsBlock)
            : coldEmailPrompt(cv, claimsBlock),
      userInput: JSON.stringify({
        company_research: research,
        jd_analysis: jdAnalysis,
        ...(kind === "cold_email" && recipientName ? { recipient_name: recipientName } : {}),
        ...(kind === "cold_email" && personalNote ? { personal_note: personalNote } : {}),
      }),
      maxTokens: 800,
    });

    const out = typeof text === "string" ? text.trim() : "";
    // Deterministic claim check on the copy text. Never blocks here — the
    // fix for an extra is "Rewrite"; the page shows what was flagged.
    // Company facts come from the research; the candidate's own claims from the CV.
    const claimCheck = checkClaims(
      [{ where: kind === "cold_email" ? "email" : "extra", text: out, extraSources: [JSON.stringify(research)] }],
      claims,
      [cv]
    );
    return NextResponse.json({ text: out, claimCheck });
  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      return NextResponse.json(
        { error: "The service is busy right now. Try again shortly." },
        { status: 429 }
      );
    }
    console.error("Extras API error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Couldn't generate that just now. Try again." }, { status: 500 });
  }
}
