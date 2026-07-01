import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/claude";
import { PROFILE_EXTRACTION_PROMPT } from "@/prompts/steps";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { cvText } = await req.json();
    if (!cvText || !cvText.trim()) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }
    if (cvText.length > 20_000) {
      return NextResponse.json({ error: "CV is too long (max ~5 pages / 20,000 characters)." }, { status: 400 });
    }
    const profile = await callClaude({
      system: PROFILE_EXTRACTION_PROMPT,
      userInput: cvText,
      expectJson: true,
    });
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Profile extraction error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Failed to extract profile" }, { status: 500 });
  }
}