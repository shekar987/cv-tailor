import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { JD_ANALYZER_PROMPT } from "@/prompts/steps";
import { matchAtsKeywords } from "@/lib/atsMatch";

const MAX_JD_CHARS = 15_000;
const MAX_CV_CHARS = 20_000; // matches /api/tailor's cap

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Burst limit: this endpoint calls Claude on the owner's key with no DB
    // quota, so an unmetered loop here would drain the wallet. Gate it.
    // Deliberately NOT the tailor-count/lifetime RPCs below — this call (JD
    // analysis alone, ~1/9th the cost of a full tailor run) must not consume
    // one of the paid-tailor quota slots. That RPC only fires inside
    // /api/tailor when the full 8-step pipeline actually runs.
    const burst = await checkBurstLimit(data.claims.sub as string, "analyze");
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    const { jobDescription, cvText } = await req.json();

    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (jobDescription.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: "Job description is too long (max ~15,000 characters)." }, { status: 400 });
    }
    // cvText is optional: when present, this doubles as the pre-tailoring ATS
    // gate (Step 1 only, plus a local keyword check — no extra LLM call).
    // When absent, behaviour is exactly the original standalone JD analysis.
    if (typeof cvText === "string" && cvText.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: "CV is too long (max ~5 pages / 20,000 characters)." }, { status: 400 });
    }

    const result = await callClaude({
      system: JD_ANALYZER_PROMPT,
      userInput: jobDescription,
      expectJson: true,
    });

    if (typeof cvText === "string" && cvText.trim()) {
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
