import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/claude";
import {
  SUMMARY_PROMPT,
  SKILLS_PROMPT,
  EXPERIENCE_PROMPT,
  PROJECTS_PROMPT,
} from "@/prompts/steps";

const JD_ANALYZER_PROMPT = `You are a JD analyzer for a CV tailoring system. Extract structured data from the job description.

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
    const { jobDescription } = await req.json();

    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }

    // Step 1 — Analyze the JD (returns parsed JSON)
    const analysis = await callClaude({
      system: JD_ANALYZER_PROMPT,
      userInput: jobDescription,
      expectJson: true,
    });

    const analysisStr = JSON.stringify(analysis);

    // Steps 3-6 — run the tailoring steps, each fed the JD analysis
    const [summary, skills, experience, projects] = await Promise.all([
      callClaude({ system: SUMMARY_PROMPT, userInput: analysisStr }),
      callClaude({ system: SKILLS_PROMPT, userInput: analysisStr }),
      callClaude({ system: EXPERIENCE_PROMPT, userInput: analysisStr }),
      callClaude({ system: PROJECTS_PROMPT, userInput: analysisStr }),
    ]);

    return NextResponse.json({
      analysis,
      summary,
      skills,
      experience,
      projects,
    });
  } catch (error) {
    console.error("Tailor API error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Tailoring failed", detail: msg }, { status: 500 });
  }
}