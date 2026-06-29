import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

// Adjust this constant to change the per-user daily tailoring cap
const DAILY_TAILOR_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour rolling window

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
    // Identify the user via locally-verified JWT claims (no network call)
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = claimsData.claims.sub as string;

    // Per-user rate limiting via the profiles table
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("tailor_count, tailor_count_reset_at, is_unlimited")
      .eq("id", userId)
      .single();

    if (profileError || !profileRow) {
      // Trigger should have created this row on signup — log and allow
      console.error("Rate limit: missing profiles row for user", userId, profileError);
    } else if (!profileRow.is_unlimited) {
      // Only apply the cap to non-unlimited accounts
      const now = Date.now();
      const resetAt = profileRow.tailor_count_reset_at
        ? new Date(profileRow.tailor_count_reset_at).getTime()
        : 0;

      if (resetAt > now) {
        // Inside the current window — enforce the limit
        if (profileRow.tailor_count >= DAILY_TAILOR_LIMIT) {
          const hoursLeft = Math.ceil((resetAt - now) / (60 * 60 * 1000));
          return NextResponse.json(
            {
              error: `Daily limit reached (${DAILY_TAILOR_LIMIT} tailors per 24 hours). Try again in about ${hoursLeft} hour(s).`,
            },
            { status: 429 }
          );
        }
        // Under the limit — increment
        await supabase
          .from("profiles")
          .update({ tailor_count: profileRow.tailor_count + 1 })
          .eq("id", userId);
      } else {
        // Window expired — start a fresh window
        await supabase
          .from("profiles")
          .update({
            tailor_count: 1,
            tailor_count_reset_at: new Date(now + WINDOW_MS).toISOString(),
          })
          .eq("id", userId);
      }
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