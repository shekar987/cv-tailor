import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, Provider, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { decrypt } from "@/lib/keyEncryption";
import {
  summaryPrompt,
  skillsPrompt,
  experiencePrompt,
  projectsPrompt,
  COMPANY_RESEARCH_PROMPT,
  coverLetterPrompt,
  ATS_SCORING_PROMPT,
  JD_ANALYZER_PROMPT,
} from "@/prompts/steps";

const DAILY_TAILOR_LIMIT  = 3;
const WINDOW_MS            = 24 * 60 * 60 * 1000;
const CLAUDE_LIFETIME_LIMIT = 3;

// Minimal shape check for a client-supplied analysis object (from the
// pre-tailoring ATS gate — see runPipeline's precomputedAnalysis param). Not a
// security boundary: the JD itself is already fully user-controlled input, so
// a hand-crafted analysis grants nothing an attacker couldn't already get by
// writing an unusual job description. This only guards against wasting the
// user's own quota on a silently broken run (e.g. a stale/malformed payload).
function looksLikeJdAnalysis(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).top_15_ats_keywords)
  );
}

// For unlimited users only — reads provider from the request body, then env, then defaults.
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

function formatDuration(ms: number): string {
  if (ms <= 0) return "shortly";
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours    = Math.floor(totalMinutes / 60);
  const minutes  = totalMinutes % 60;
  if (hours   === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// Re-throws ProviderRateLimitError so fallback logic above can catch it;
// swallows everything else and returns the given empty value.
// This keeps the existing "one bad step doesn't kill the whole response"
// behaviour while letting provider quota errors propagate for retry/fallback.
function swallowStep<T>(fallback: T) {
  return (err: unknown): T => {
    if (err instanceof ProviderRateLimitError) throw err;
    return fallback;
  };
}

// Runs the complete 9-call tailoring pipeline (JD analysis + wave 1 + wave 2)
// for one provider + optional key override. Throws ProviderRateLimitError if
// any step hits a quota, so the caller can catch and retry on another provider.
async function runPipeline(opts: {
  provider: Provider;
  apiKeyOverride: string | undefined;
  jd: string;
  cv: string;
  projectNames: string[];
  // Result of the pre-tailoring ATS gate's Step 1 call (/api/analyze with
  // cvText). When present and well-formed, Step 0 below is SKIPPED — this is
  // the whole point of the gate: the user already paid for this exact call
  // when they saw the "X/15 keywords" preview, so it must not run twice.
  precomputedAnalysis?: unknown;
}) {
  const { provider, apiKeyOverride, jd, cv, projectNames, precomputedAnalysis } = opts;

  // Step 0 — JD analysis. Reused from the pre-tailoring gate when available and
  // well-formed; otherwise run fresh (this is also the fallback for a caller
  // that never ran the gate, or a JD edited after the gate ran).
  const reusedAnalysis = looksLikeJdAnalysis(precomputedAnalysis);
  // Decision only, never content — confirms in server logs whether the
  // pre-tailoring gate's Step 1 call is actually being reused, not re-paid-for.
  console.log(reusedAnalysis ? "[tailor] Step 0: reused analysis from pre-check gate" : "[tailor] Step 0: ran JD analyzer fresh");
  const analysis = reusedAnalysis
    ? precomputedAnalysis
    : await callLLM({
        provider,
        apiKeyOverride,
        system: JD_ANALYZER_PROMPT,
        userInput: jd,
        expectJson: true,
      });
  const analysisStr = JSON.stringify(analysis);

  // Wave 1 — parallel; individual step failures produce empty values,
  // but ProviderRateLimitError propagates so the caller can retry.
  const [research, summary, skills, experience, projects] = await Promise.all([
    callLLM({ provider, apiKeyOverride, system: COMPANY_RESEARCH_PROMPT, userInput: analysisStr, expectJson: true })
      .catch(swallowStep({})),
    callLLM({ provider, apiKeyOverride, system: summaryPrompt(cv), userInput: analysisStr })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: skillsPrompt(cv), userInput: analysisStr })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: experiencePrompt(cv), userInput: analysisStr })
      .catch(swallowStep("")),
    projectNames.length > 0
      ? callLLM({ provider, apiKeyOverride, system: projectsPrompt(cv, projectNames), userInput: analysisStr, expectJson: true })
          .catch(swallowStep({}))
      : Promise.resolve({}),
  ]);

  // Wave 2 — cover letter + ATS score
  const coverLetterInput = JSON.stringify({ analysis, research });
  const atsInput         = JSON.stringify({ analysis, summary, skills, experience, projects });

  const [coverLetter, atsScore] = await Promise.all([
    callLLM({ provider, apiKeyOverride, system: coverLetterPrompt(cv), userInput: coverLetterInput, maxTokens: 1200 })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: ATS_SCORING_PROMPT, userInput: atsInput, expectJson: true })
      .catch(swallowStep(null)),
  ]);

  return { analysis, research, summary, skills, experience, projects, coverLetter, atsScore };
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    // ── Burst rate limit (cheap first gate, before DB + LLM work) ──────────────
    const burst = await checkBurstLimit(userId, "tailor");
    if (!burst.ok) {
      return NextResponse.json(
        {
          error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.`,
          errorType: "provider_limit",
          retryAfter: burst.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const MAX_CV_CHARS = 20_000;
    const MAX_JD_CHARS = 15_000;

    const { jobDescription, cvText, projectNames, provider: bodyProvider, analysis: bodyAnalysis } = await req.json();

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

    const jd              = jobDescription as string;
    const cv              = (cvText as string).trim();
    const safeProjectNames: string[] = Array.isArray(projectNames) ? projectNames : [];

    // ── Daily rate limit (all users, all providers) ───────────────────────────
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "check_and_increment_tailor_count",
      {
        uid:            userId,
        daily_limit:    DAILY_TAILOR_LIMIT,
        window_seconds: Math.floor(WINDOW_MS / 1000),
      }
    );
    if (rpcError) {
      console.error("Rate limit RPC error:", rpcError.message);
    } else if (rpcResult && !rpcResult.allowed) {
      if (rpcResult.reason === "limit_reached") {
        const resetAt   = rpcResult.reset_at as string;
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
      console.error("Rate limit: profile not found for user");
    }

    // ── Routing brain ─────────────────────────────────────────────────────────
    // Call check_and_increment_claude_lifetime once. Its return tells us everything:
    //   reason = 'unlimited'           → my account; honor the dropdown; use env keys
    //   reason = 'ok'                  → user has free Claude credits; just incremented
    //   reason = 'claude_limit_reached'→ capped; route to their own saved keys
    //   reason = 'profile_not_found'   → treat as unlimited (fail open)
    // DB error                         → treat as unlimited (fail open, same policy)
    const { data: lifetimeResult, error: lifetimeError } = await supabase.rpc(
      "check_and_increment_claude_lifetime",
      { uid: userId, lifetime_limit: CLAUDE_LIFETIME_LIMIT }
    );

    if (lifetimeError) {
      console.error("Claude lifetime RPC error:", lifetimeError.message);
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please try again in a moment." },
        { status: 503 }
      );
    }

    const lifetimeReason = lifetimeResult?.reason as string | undefined;
    const isUnlimited    = !lifetimeResult || lifetimeReason === "unlimited" || lifetimeReason === "profile_not_found";

    // ── Path A: unlimited account — existing dropdown behaviour ───────────────
    if (isUnlimited) {
      const provider = resolveProvider(bodyProvider);
      const result   = await runPipeline({ provider, apiKeyOverride: undefined, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
      return NextResponse.json({ provider, ...result });
    }

    // ── Path B: user has free Claude credits (counter just incremented) ───────
    if (lifetimeReason === "ok") {
      const result = await runPipeline({ provider: "anthropic", apiKeyOverride: undefined, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
      return NextResponse.json(result);
    }

    // ── Path C: Claude credits exhausted — route to user's own keys ───────────
    if (lifetimeReason === "claude_limit_reached") {
      // Fetch both encrypted keys via the SECURITY DEFINER function.
      // key_enc is column-revoked from authenticated; this RPC is the only read path.
      const [{ data: geminiEnc }, { data: orEnc }] = await Promise.all([
        supabase.rpc("get_encrypted_key", { p_user_id: userId, p_provider: "gemini" }),
        supabase.rpc("get_encrypted_key", { p_user_id: userId, p_provider: "openrouter" }),
      ]);

      // Decrypt server-side only — keys live only in this request scope, never logged
      let geminiKey:     string | null = null;
      let openrouterKey: string | null = null;
      let decryptFailed = false;
      try { if (geminiEnc)  geminiKey     = decrypt(geminiEnc);  } catch (e) {
        console.error("Gemini key decryption failed (KEY_ENCRYPTION_SECRET rotation?):", e instanceof Error ? e.message : String(e));
        decryptFailed = true;
      }
      try { if (orEnc)      openrouterKey = decrypt(orEnc);      } catch (e) {
        console.error("OpenRouter key decryption failed (KEY_ENCRYPTION_SECRET rotation?):", e instanceof Error ? e.message : String(e));
        decryptFailed = true;
      }

      if (!geminiKey && !openrouterKey) {
        if (decryptFailed) {
          return NextResponse.json(
            {
              error: "Your saved API key couldn't be read — it may need to be re-entered. Go to Settings and replace it.",
              errorType: "key_decrypt_failed",
            },
            { status: 422 }
          );
        }
        // User is capped but hasn't saved any keys yet — prompt the Settings page
        return NextResponse.json(
          {
            needsKeys: true,
            error: "You've used all free tailors. Add your own API key in Settings to continue.",
            errorType: "needs_keys",
          },
          { status: 402 }
        );
      }

      // Try Gemini first; auto-fallback to OpenRouter on quota error.
      // Both retries are invisible — no provider name leaks to the browser.
      if (geminiKey) {
        try {
          const result = await runPipeline({ provider: "gemini", apiKeyOverride: geminiKey, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
          return NextResponse.json(result);
        } catch (err) {
          if (err instanceof ProviderRateLimitError) {
            if (!openrouterKey) {
              return NextResponse.json(
                {
                  limitReached: true,
                  error: "Your API key has hit its usage limit. Try again later or add a second key in Settings.",
                  errorType: "user_key_limit",
                },
                { status: 429 }
              );
            }
            // Fallthrough to OpenRouter below
          } else {
            throw err; // non-quota error — let outer catch handle
          }
        }
      }

      // OpenRouter: either as the primary key (no Gemini saved) or as the fallback
      if (openrouterKey) {
        try {
          const result = await runPipeline({ provider: "openrouter", apiKeyOverride: openrouterKey, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
          return NextResponse.json(result);
        } catch (err) {
          if (err instanceof ProviderRateLimitError) {
            return NextResponse.json(
              {
                limitReached: true,
                error: "Both your API keys have hit their usage limits. Try again later.",
                errorType: "user_key_limit",
              },
              { status: 429 }
            );
          }
          throw err;
        }
      }
    }

    // Should not reach here — all reasons are handled above. Log which reason
    // fell through: 'forbidden' means the rate-limit RPCs did not see the
    // caller's JWT (auth.uid() was null), which would break every tailor call.
    console.error("Unexpected routing state; lifetime reason:", lifetimeReason ?? "undefined");
    return NextResponse.json({ error: "Unexpected routing state" }, { status: 500 });

  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      const retryMsg = error.retryAfterSeconds
        ? `Resets in ~${formatDuration(error.retryAfterSeconds * 1000)}.`
        : "Try again shortly.";
      const message = `The service is busy right now. ${retryMsg}`;
      console.error("Provider rate limit:", error.provider, error.message);
      return NextResponse.json(
        {
          error: message,
          errorType: "provider_limit",
          retryAfter: error.retryAfterSeconds ?? null,
        },
        { status: 429 }
      );
    }
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Tailor API error:", msg);
    return NextResponse.json({ error: "Tailoring failed" }, { status: 500 });
  }
}
