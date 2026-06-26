import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/claude";
import { PROFILE_EXTRACTION_PROMPT } from "@/prompts/steps";

export async function POST(req: NextRequest) {
  try {
    const { cvText } = await req.json();
    if (!cvText || !cvText.trim()) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }
    const profile = await callClaude({
      system: PROFILE_EXTRACTION_PROMPT,
      userInput: cvText,
      expectJson: true,
    });
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Profile extraction error:", error);
    return NextResponse.json({ error: "Failed to extract profile" }, { status: 500 });
  }
}