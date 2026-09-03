// Stage 3 high-fit extras: a spoken pitch script and interview talking
// points, offered on /app when the Fit Score comes back 80+ and a tailored
// result exists. One model call each on the default provider, burst-limited;
// deliberately no DB quota — these are single cheap calls attached to work
// the daily counter already metered (the research + tailor runs).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { MAX_CV_CHARS, CV_TOO_LONG } from "@/lib/limits";
import { sanitizeCompanyResearch } from "@/lib/companyResearch";
import { pitchScriptPrompt, talkingPointsPrompt } from "@/prompts/steps";

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

    const kind = body.kind === "pitch" || body.kind === "talking_points" ? body.kind : null;
    const cv = typeof body.cvText === "string" ? body.cvText.trim() : "";
    const research = sanitizeCompanyResearch(body.companyResearch);
    if (!kind) return NextResponse.json({ error: "Unknown extra requested" }, { status: 400 });
    if (!cv) return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    if (cv.length > MAX_CV_CHARS) return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    if (!research) {
      return NextResponse.json({ error: "Run the company research first — these are built from it." }, { status: 400 });
    }

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
      system: kind === "pitch" ? pitchScriptPrompt(cv) : talkingPointsPrompt(cv),
      userInput: JSON.stringify({ company_research: research, jd_analysis: jdAnalysis }),
      maxTokens: 800,
    });

    return NextResponse.json({ text: typeof text === "string" ? text.trim() : "" });
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
