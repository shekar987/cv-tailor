import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, Provider, ProviderRateLimitError } from "@/lib/claude";
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

// Lifetime (not daily) cap on Claude tailors per user. After this many, Claude is
// permanently blocked for that user (is_unlimited accounts exempt). Future steps
// will route capped users to their own Gemini/OpenRouter keys.
const CLAUDE_LIFETIME_LIMIT = 3;

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

// Global, all-or-nothing switch for the whole tailoring chain: a single run
// uses one provider for all 8 calls, never a mix. Resolution order:
// request body "provider" (unused by the UI today, wired for a future
// per-tailor toggle) -> LLM_PROVIDER env var -> "anthropic" default.
function resolveProvider(bodyProvider: unknown): Provider {
  if (bodyProvider === "anthropic" || bodyProvider === "openrouter" || bodyProvider === "gemini") {
    return bodyProvider;
  }
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider === "anthropic" || envProvider === "openrouter" || envProvider === "gemini") {
    return envProvider;
  }
  return "anthropic";
}

// Renders a millisecond duration as "X hour(s) Y minute(s)" for user-facing
// messages — never a raw timestamp.
function formatDuration(ms: number): string {
  if (ms <= 0) return "shortly";
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export async function POST(req: NextRequest) {
  try {
    // Identify the user via locally-verified JWT claims (no network call)
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = claimsData.claims.sub as string;

    // Per-user rate limiting — atomically checked and incremented server-side.
    // Users cannot write tailor_count/tailor_count_reset_at/is_unlimited directly
    // (REVOKE UPDATE on those columns from authenticated); only this SECURITY DEFINER
    // function can touch them.
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "check_and_increment_tailor_count",
      {
        uid:            userId,
        daily_limit:    DAILY_TAILOR_LIMIT,
        window_seconds: Math.floor(WINDOW_MS / 1000),
      }
    );

    if (rpcError) {
      // Unexpected DB error — log and fail open rather than blocking the user
      console.error("Rate limit RPC error:", rpcError.message);
    } else if (rpcResult && !rpcResult.allowed) {
      if (rpcResult.reason === "limit_reached") {
        const resetAt = rpcResult.reset_at as string;
        const remaining = formatDuration(new Date(resetAt).getTime() - Date.now());
        return NextResponse.json(
          {
            error: `You've reached your daily tailoring limit (${DAILY_TAILOR_LIMIT} per 24 hours). Resets in ${remaining}.`,
            errorType: "user_limit",
            resetAt,
          },
          { status: 429 }
        );
      }
      // profile_not_found — trigger should have created the row on signup; log and allow
      console.error("Rate limit: profile not found for user");
    }

    const MAX_CV_CHARS = 20_000;
    const MAX_JD_CHARS = 15_000;

    const { jobDescription, cvText, projectNames, provider: bodyProvider } = await req.json();
    const provider = resolveProvider(bodyProvider);
    if (!jobDescription) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (!cvText || !cvText.trim()) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }
    if (cvText.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: "CV is too long (max ~5 pages / 20,000 characters)." }, { status: 400 });
    }
    if (jobDescription.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: "Job description is too long (max ~15,000 characters)." }, { status: 400 });
    }

    const cv: string = cvText.trim();
    const safeProjectNames: string[] = Array.isArray(projectNames) ? projectNames : [];

    // Lifetime Claude cap — checked only when this run will actually use Claude,
    // and only after input validation so a 400 never burns one of the 3 lifetime
    // credits. Atomic check-and-increment via SECURITY DEFINER RPC; the
    // claude_tailors_used column is not writable by the authenticated role.
    // is_unlimited accounts bypass inside the function and are never incremented.
    if (provider === "anthropic") {
      const { data: lifetimeResult, error: lifetimeError } = await supabase.rpc(
        "check_and_increment_claude_lifetime",
        {
          uid:            userId,
          lifetime_limit: CLAUDE_LIFETIME_LIMIT,
        }
      );

      if (lifetimeError) {
        // Unexpected DB error — log and fail open, same policy as the daily limiter
        console.error("Claude lifetime RPC error:", lifetimeError.message);
      } else if (lifetimeResult && !lifetimeResult.allowed) {
        if (lifetimeResult.reason === "claude_limit_reached") {
          return NextResponse.json(
            {
              error: `You've used all ${CLAUDE_LIFETIME_LIMIT} free Claude tailors. Claude is no longer available on this account.`,
              errorType: "claude_limit_reached",
            },
            { status: 403 }
          );
        }
        // profile_not_found — trigger should have created the row on signup; log and allow
        console.error("Claude lifetime: profile not found for user");
      }
    }

    // Step 1 — Analyze the JD (returns parsed JSON)
    const analysis = await callLLM({
      provider,
      system: JD_ANALYZER_PROMPT,
      userInput: jobDescription,
      expectJson: true,
    });

    const analysisStr = JSON.stringify(analysis);

    // Wave 1: company research + all 4 tailoring steps. Each is caught independently so a single
    // step failure (e.g. projects returning prose instead of JSON) doesn't kill the whole response.
    const [research, summary, skills, experience, projects] = await Promise.all([
      callLLM({ provider, system: COMPANY_RESEARCH_PROMPT, userInput: analysisStr, expectJson: true })
        .catch(() => ({})),
      callLLM({ provider, system: summaryPrompt(cv), userInput: analysisStr })
        .catch(() => ""),
      callLLM({ provider, system: skillsPrompt(cv), userInput: analysisStr })
        .catch(() => ""),
      callLLM({ provider, system: experiencePrompt(cv), userInput: analysisStr })
        .catch(() => ""),
      safeProjectNames.length > 0
        ? callLLM({ provider, system: projectsPrompt(cv, safeProjectNames), userInput: analysisStr, expectJson: true })
          .catch(() => ({}))
        : Promise.resolve({}),
    ]);

    // Wave 2: cover letter needs analysis + research; ATS scoring needs analysis + tailored sections.
    // Each caught independently so atsScore failure doesn't lose the cover letter.
    const coverLetterInput = JSON.stringify({ analysis, research });
    const atsInput = JSON.stringify({ analysis, summary, skills, experience, projects });

    const [coverLetter, atsScore] = await Promise.all([
      callLLM({ provider, system: coverLetterPrompt(cv), userInput: coverLetterInput, maxTokens: 1200 })
        .catch(() => ""),
      callLLM({ provider, system: ATS_SCORING_PROMPT, userInput: atsInput, expectJson: true })
        .catch(() => null),
    ]);

    return NextResponse.json({
      provider,
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
    if (error instanceof ProviderRateLimitError) {
      const retryMsg = error.retryAfterSeconds
        ? `Resets in ~${formatDuration(error.retryAfterSeconds * 1000)}.`
        : "Try again shortly.";
      const message = error.provider === "anthropic"
        ? `Claude's rate limit has been reached. ${retryMsg}`
        : `The free AI provider's daily limit has been reached. Try switching to Claude, or wait — ${retryMsg}`;
      console.error("Provider rate limit:", error.provider, error.message);
      return NextResponse.json(
        {
          error: message,
          errorType: "provider_limit",
          provider: error.provider,
          retryAfter: error.retryAfterSeconds ?? null,
        },
        { status: 429 }
      );
    }
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Tailor API error:", msg);
    return NextResponse.json({ error: "Tailoring failed", detail: msg }, { status: 500 });
  }
}