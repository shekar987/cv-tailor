import { checkRateLimit } from "@/lib/rateLimit";
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/claude";
import {
  summaryPrompt,
  skillsPrompt,
  experiencePrompt,
  projectsPrompt,
  COMPANY_RESEARCH_PROMPT,
  coverLetterPrompt,
  ATS_SCORING_PROMPT,
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
    // Rate limit by IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
      const mins = Math.ceil((limit.resetAt - Date.now()) / 60000);
      return NextResponse.json(
        { error: `Rate limit reached. Try again in about ${mins} minute(s).` },
        { status: 429 }
      );
    }
const { jobDescription, cvText, projectNames } = await req.json();
    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (!cvText || !cvText.trim()) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }

    const cv: string = cvText.trim();
    const safeProjectNames: string[] = Array.isArray(projectNames) ? projectNames : [];

    // Step 1 — Analyze the JD (returns parsed JSON)
    const analysis = await callClaude({
      system: JD_ANALYZER_PROMPT,
      userInput: jobDescription,
      expectJson: true,
    });

    const analysisStr = JSON.stringify(analysis);

    // Wave 1: company research + all 4 tailoring steps. Each is caught independently so a single
    // step failure (e.g. projects returning prose instead of JSON) doesn't kill the whole response.
    const [research, summary, skills, experience, projects] = await Promise.all([
      callClaude({ system: COMPANY_RESEARCH_PROMPT, userInput: analysisStr, expectJson: true })
        .catch(() => ({})),
      callClaude({ system: summaryPrompt(cv), userInput: analysisStr })
        .catch(() => ""),
      callClaude({ system: skillsPrompt(cv), userInput: analysisStr })
        .catch(() => ""),
      callClaude({ system: experiencePrompt(cv), userInput: analysisStr })
        .catch(() => ""),
      safeProjectNames.length > 0
        ? callClaude({ system: projectsPrompt(cv, safeProjectNames), userInput: analysisStr, expectJson: true })
          .catch(() => ({}))
        : Promise.resolve({}),
    ]);

    // Wave 2: cover letter needs analysis + research; ATS scoring needs analysis + tailored sections.
    // Each caught independently so atsScore failure doesn't lose the cover letter.
    const coverLetterInput = JSON.stringify({ analysis, research });
    const atsInput = JSON.stringify({ analysis, summary, skills, experience, projects });

    const [coverLetter, atsScore] = await Promise.all([
      callClaude({ system: coverLetterPrompt(cv), userInput: coverLetterInput, maxTokens: 1200 })
        .catch(() => ""),
      callClaude({ system: ATS_SCORING_PROMPT, userInput: atsInput, expectJson: true })
        .catch(() => null),
    ]);

    return NextResponse.json({
      analysis,
      research,
      summary,
      skills,
      experience,
      projects,
      coverLetter,
      atsScore,
    });
  } catch (error) {
    console.error("Tailor API error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Tailoring failed", detail: msg }, { status: 500 });
  }
}