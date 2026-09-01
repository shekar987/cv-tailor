import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { JD_ANALYZER_PROMPT } from "@/prompts/steps";
import { matchAtsKeywords } from "@/lib/atsMatch";
import { MAX_CV_CHARS, MAX_JD_CHARS, CV_TOO_LONG, JD_TOO_LONG } from "@/lib/limits";

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
    const burst = await checkBurstLimit(data.claims.sub as string, "analyze");
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
    // cvText is optional: when present, this doubles as the pre-tailoring ATS
    // gate (Step 1 only, plus a local keyword check — no extra LLM call).
    // When absent, behaviour is exactly the original standalone JD analysis.
    const cvText = typeof body.cvText === "string" ? body.cvText : "";
    if (cvText.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }

    const result = await callClaude({
      system: JD_ANALYZER_PROMPT,
      userInput: jobDescription,
      expectJson: true,
    });

    if (cvText.trim()) {
      const analysis = result as { top_15_ats_keywords?: unknown };
      const atsPreCheck = matchAtsKeywords(cvText, analysis?.top_15_ats_keywords);
      return NextResponse.json({ result, atsPreCheck });
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Analyze API error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Failed to analyze JD" }, { status: 500 });
  }
}
