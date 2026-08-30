import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { PROFILE_EXTRACTION_PROMPT } from "@/prompts/steps";
import { MAX_CV_CHARS, CV_TOO_LONG } from "@/lib/limits";
import { normalizeProfile } from "@/lib/profile";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Burst limit: this endpoint calls Claude on the owner's key with no DB
    // quota, so an unmetered loop here would drain the wallet. Gate it.
    const burst = await checkBurstLimit(data.claims.sub as string, "extract-profile");
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

    const cvText = typeof body.cvText === "string" ? body.cvText.trim() : "";
    if (!cvText) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }
    if (cvText.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }
    // Unlike the tailoring prompts (which each carry an explicit length
    // budget), this prompt demands full verbatim capture of every section —
    // education notes, certifications, every project's name/tech/links/
    // bullets, right-to-work, every extra section — for CVs up to this
    // route's own 20,000-character cap, all in one JSON response. The
    // previous default (2000 tokens) was silently truncating detailed CVs;
    // 8000 is comfortably more than double the input size even accounting
    // for JSON structural overhead. This runs on the owner's API key with no
    // per-call cost cap (see checkBurstLimit above), so this raises the
    // theoretical max cost per call — in practice Claude only spends the
    // tokens it needs, so a typical CV's actual cost shouldn't change.
    const raw = await callClaude({
      system: PROFILE_EXTRACTION_PROMPT,
      userInput: cvText,
      expectJson: true,
      maxTokens: 8000,
    });
    // Valid JSON is not the same as the right shape: coerce every field to
    // what the preview and download routes assume before it is stored.
    const profile = normalizeProfile(raw);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Profile extraction error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Failed to extract profile" }, { status: 500 });
  }
}
