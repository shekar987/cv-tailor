import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/claude";

const JD_ANALYZER_PROMPT = `You are a JD analyzer for a CV tailoring system. Extract structured data from the job description the user provides.

Output ONLY a JSON object (no prose, no markdown fences) with these fields:
{
  "role_title": "exact job title",
  "company_name": "company name",
  "seniority_level": "junior | mid | senior | staff | unspecified",
  "role_type": "backend | frontend | fullstack | ai_engineering | data_engineering | ml_engineering | devops | other",
  "location_and_mode": "e.g. London, Hybrid",
  "required_skills": ["top 10 mandatory skills, priority order"],
  "nice_to_have_skills": ["up to 8 preferred skills"],
  "top_15_ats_keywords": ["top 15 ATS keywords, priority ordered"],
  "company_values_and_culture": ["3-6 cultural signals"],
  "domain_context": "1 sentence on what the product does",
  "tone_signals": "formal | semi-formal | founder-casual | technical-dense"
}`;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobDescription } = await req.json();

    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (jobDescription.length > 15_000) {
      return NextResponse.json({ error: "Job description is too long (max ~15,000 characters)." }, { status: 400 });
    }

    const result = await callClaude({
      system: JD_ANALYZER_PROMPT,
      userInput: jobDescription,
      expectJson: true,
    });

    return NextResponse.json({ result });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Failed to analyze JD" }, { status: 500 });
  }
}