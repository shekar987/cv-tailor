import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, Provider, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { decrypt } from "@/lib/keyEncryption";
import { MAX_CV_CHARS, MAX_JD_CHARS, CV_TOO_LONG, JD_TOO_LONG, DAILY_TAILOR_LIMIT, CLAUDE_LIFETIME_LIMIT } from "@/lib/limits";
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
import { experienceBudget, projectsBudget, normalizeExperienceOutput } from "@/lib/contentBudget";
import { matchAtsKeywords } from "@/lib/atsMatch";

const WINDOW_MS = 24 * 60 * 60 * 1000;

const UNAVAILABLE = { error: "Service temporarily unavailable. Please try again in a moment." };

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

// Re-throws ProviderRateLimitError so the route can answer with a specific
// 429; swallows everything else and returns the given empty value. This keeps
// the "one bad step doesn't kill the whole response" behaviour while letting a
// provider quota error surface as itself rather than as a blank section.
function swallowStep<T>(fallback: T) {
  return (err: unknown): T => {
    if (err instanceof ProviderRateLimitError) throw err;
    return fallback;
  };
}

// The ATS scorer is itself a model call, and it occasionally files a keyword
// on the wrong side — a "hit" the tailored text doesn't actually contain, or
// a miss that is plainly present. Reconcile its verdicts against the REAL
// tailored output with the deterministic matcher (no extra model call), so
// the numbers shown to the user always agree with the document on their
// screen. Only hits/misses/counts are corrected; the model keeps the prose
// (recommendations, overall assessment).
function reconcileAtsScore(
  atsScore: unknown,
  analysis: unknown,
  sections: { summary: unknown; skills: unknown; experience: unknown; projects: unknown }
): unknown {
  if (!atsScore || typeof atsScore !== "object") return atsScore;
  const score = atsScore as Record<string, unknown>;
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  const keywords = a.top_15_ats_keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) return atsScore;

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const projectText = Object.values(
    (sections.projects && typeof sections.projects === "object" ? sections.projects : {}) as Record<string, unknown>
  )
    .flatMap((v) => (Array.isArray(v) ? v.filter((b): b is string => typeof b === "string") : []))
    .join("\n");
  const tailoredText = [str(sections.summary), str(sections.skills), str(sections.experience), projectText]
    .filter(Boolean)
    .join("\n");
  if (!tailoredText.trim()) return atsScore;

  const det = matchAtsKeywords(tailoredText, keywords);
  const present = new Set(det.matchedKeywords.map((k) => k.toLowerCase()));

  const modelHits = Array.isArray(score.hits) ? score.hits.filter((h): h is string => typeof h === "string") : [];
  const modelMisses = Array.isArray(score.misses) ? score.misses.filter((m): m is string => typeof m === "string") : [];
  // Prefix match, not containment: a hit's annotation ("Java — skills and
  // experience (Spring Boot API)") CONTAINS other keywords, and containment
  // matching filed the same entry under several of them (duplicate hits).
  const entryFor = (list: string[], kw: string) => list.find((e) => e.trim().toLowerCase().startsWith(kw.toLowerCase()));

  const hits: string[] = [];
  const misses: string[] = [];
  for (const kw of keywords) {
    if (typeof kw !== "string" || !kw.trim()) continue;
    if (present.has(kw.toLowerCase())) {
      hits.push(entryFor(modelHits, kw) ?? kw);
    } else if (entryFor(modelHits, kw)) {
      // The model claimed a hit the tailored text doesn't back.
      misses.push(`${kw} — not actually present in the tailored text`);
    } else {
      misses.push(entryFor(modelMisses, kw) ?? `${kw} — not present in the tailored text`);
    }
  }

  const required = a.required_skills;
  const requiredCoverage =
    Array.isArray(required) && required.length > 0
      ? (() => {
          const r = matchAtsKeywords(tailoredText, required);
          return `${r.matched}/${r.total}`;
        })()
      : score.required_skill_coverage;

  // The model's prose sometimes quotes different figures than its own lists
  // ("13 of 15" beside a 15-entry hits array, seen in testing). Sync any
  // X/N or "X of N" figure it quotes with the reconciled counts.
  const kwTotal = keywords.length;
  const reqParts = typeof requiredCoverage === "string" ? requiredCoverage.split("/") : [];
  const syncProse = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    let s = v.replace(
      new RegExp(String.raw`\b\d{1,2}(\s*(?:/|of)\s*)${kwTotal}\b`, "g"),
      (_m, sep: string) => `${hits.length}${sep}${kwTotal}`
    );
    if (reqParts.length === 2) {
      s = s.replace(
        new RegExp(String.raw`\b\d{1,2}(\s*(?:/|of)\s*)${reqParts[1]}\b`, "g"),
        (_m, sep: string) => `${reqParts[0]}${sep}${reqParts[1]}`
      );
    }
    return s;
  };

  return {
    ...score,
    hits,
    misses,
    keyword_coverage: `${hits.length}/${keywords.length}`,
    required_skill_coverage: requiredCoverage,
    overall_assessment: syncProse(score.overall_assessment),
  };
}

// Runs the complete tailoring pipeline — JD analysis, then wave 1 (five calls
// in parallel), then wave 2 (two calls) — for one provider + optional key
// override. Eight model calls, or seven when the pre-check gate's analysis is
// reused. Throws ProviderRateLimitError if any step hits the provider's quota.
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
  if (process.env.NODE_ENV !== "production") {
    // Decision only, never content — confirms locally whether the gate's
    // Step 1 call is actually being reused, not re-paid-for.
    console.log(reusedAnalysis ? "[tailor] Step 0: reused analysis from pre-check gate" : "[tailor] Step 0: ran JD analyzer fresh");
  }
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

  // Adaptive content budget: only ask the model to trim what two pages truly
  // can't hold (lib/contentBudget.ts). When the CV can't be parsed, the
  // prompts fall back to their fixed defaults — behaviour as before.
  const expBudget = experienceBudget(cv) ?? undefined;
  const projBudget = projectsBudget(projectNames.length);

  // Wave 1 — parallel; individual step failures produce empty values,
  // but ProviderRateLimitError propagates.
  const [research, summary, skills, experience, projects] = await Promise.all([
    callLLM({ provider, apiKeyOverride, system: COMPANY_RESEARCH_PROMPT, userInput: analysisStr, expectJson: true })
      .catch(swallowStep({})),
    callLLM({ provider, apiKeyOverride, system: summaryPrompt(cv), userInput: analysisStr })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: skillsPrompt(cv), userInput: analysisStr })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: experiencePrompt(cv, expBudget), userInput: analysisStr })
      .catch(swallowStep("")),
    projectNames.length > 0
      ? callLLM({ provider, apiKeyOverride, system: projectsPrompt(cv, projectNames, projBudget), userInput: analysisStr, expectJson: true })
          .catch(swallowStep({}))
      : Promise.resolve({}),
  ]);

  // The model mirrors a bullet-less master CV with plain achievement lines —
  // repair the markers deterministically so every renderer draws real
  // bullets. Done BEFORE ATS scoring, so the score sees exactly the text the
  // user gets.
  const experienceOut = typeof experience === "string" ? normalizeExperienceOutput(experience) : experience;

  // Wave 2 — cover letter + ATS score
  const coverLetterInput = JSON.stringify({ analysis, research });
  const atsInput         = JSON.stringify({ analysis, summary, skills, experience: experienceOut, projects });

  const [coverLetter, atsScore] = await Promise.all([
    callLLM({ provider, apiKeyOverride, system: coverLetterPrompt(cv), userInput: coverLetterInput, maxTokens: 1200 })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: ATS_SCORING_PROMPT, userInput: atsInput, expectJson: true })
      .catch(swallowStep(null)),
  ]);

  return {
    analysis,
    research,
    summary,
    skills,
    experience: experienceOut,
    projects,
    coverLetter,
    atsScore: reconcileAtsScore(atsScore, analysis, { summary, skills, experience: experienceOut, projects }),
  };
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
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const jd = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    const cv = typeof body.cvText === "string" ? body.cvText.trim() : "";
    if (!jd) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (!cv) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }
    if (cv.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }
    if (jd.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    }
    const safeProjectNames = Array.isArray(body.projectNames)
      ? body.projectNames.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, 50)
      : [];
    const bodyProvider = body.provider;
    const bodyAnalysis = body.analysis;

    // ── Daily rate limit (all users, all providers) ───────────────────────────
    // The quota is the wallet's last line of defence, so it fails CLOSED: if
    // the counter can't be read, no paid pipeline runs.
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "check_and_increment_tailor_count",
      {
        uid:            userId,
        daily_limit:    DAILY_TAILOR_LIMIT,
        window_seconds: Math.floor(WINDOW_MS / 1000),
      }
    );
    if (rpcError || !rpcResult) {
      console.error("Rate limit RPC error:", rpcError?.message ?? "no result");
      return NextResponse.json(UNAVAILABLE, { status: 503 });
    }
    if (!rpcResult.allowed) {
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
      // profile_not_found / forbidden: the account row the quota lives on is
      // missing or invisible. Running unmetered would be the wrong default.
      console.error("Rate limit RPC refused:", rpcResult.reason ?? "unknown reason");
      return NextResponse.json(
        { error: "Your account isn't fully set up yet. Sign out and back in, and if this persists, contact support." },
        { status: 503 }
      );
    }

    // ── Routing brain ─────────────────────────────────────────────────────────
    // Call check_and_increment_claude_lifetime once. Its return tells us everything:
    //   reason = 'unlimited'           → owner account; honour the dropdown; use env keys
    //   reason = 'ok'                  → user has free Claude credits; just incremented
    //   reason = 'claude_limit_reached'→ capped; route to their own saved keys
    //   anything else / DB error       → fail closed (503)
    const { data: lifetimeResult, error: lifetimeError } = await supabase.rpc(
      "check_and_increment_claude_lifetime",
      { uid: userId, lifetime_limit: CLAUDE_LIFETIME_LIMIT }
    );

    if (lifetimeError || !lifetimeResult) {
      console.error("Claude lifetime RPC error:", lifetimeError?.message ?? "no result");
      return NextResponse.json(UNAVAILABLE, { status: 503 });
    }

    const lifetimeReason = lifetimeResult.reason as string | undefined;

    // Both counters have been incremented at this point. If the pipeline then
    // fails — provider 429, upstream outage, transport error — give the slot
    // back; the user got nothing for it. Best effort: a missing refund
    // function (migration not applied yet) is logged, never surfaced.
    async function refundQuota() {
      const calls = [supabase.rpc("refund_tailor_count", { uid: userId })];
      if (lifetimeReason === "ok") calls.push(supabase.rpc("refund_claude_lifetime", { uid: userId }));
      const settled = await Promise.allSettled(calls);
      for (const s of settled) {
        if (s.status === "rejected") console.error("Quota refund failed:", s.reason instanceof Error ? s.reason.message : String(s.reason));
        else if (s.value.error) console.error("Quota refund RPC error:", s.value.error.message);
      }
    }
    async function runOrRefund(opts: Parameters<typeof runPipeline>[0]) {
      try {
        return await runPipeline(opts);
      } catch (err) {
        await refundQuota();
        throw err;
      }
    }

    // ── Path A: unlimited account — the only path that honours a client-chosen provider ──
    if (lifetimeReason === "unlimited") {
      const provider = resolveProvider(bodyProvider);
      const result   = await runOrRefund({ provider, apiKeyOverride: undefined, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
      return NextResponse.json({ provider, ...result });
    }

    // ── Path B: user has free Claude credits (counter just incremented) ───────
    if (lifetimeReason === "ok") {
      const result = await runOrRefund({ provider: "anthropic", apiKeyOverride: undefined, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
      return NextResponse.json(result);
    }

    // ── Path C: Claude credits exhausted — route to the user's own key ────────
    //
    // OpenRouter ONLY. Gemini is deliberately not in this rotation: its free
    // tier allows 5 requests/minute, and one tailoring run makes 8 calls — five
    // of them fired in parallel in wave 1, after Step 0 has already spent one.
    // A user on their own Gemini key therefore cannot complete a single run.
    // That is a structural ceiling, not an occasional rate limit, so attempting
    // it would only burn ~20 seconds and their quota before failing.
    //
    // Saving a Gemini key in Settings is still supported; it just isn't used
    // for automatic tailoring.
    if (lifetimeReason === "claude_limit_reached") {
      // key_enc is column-revoked from `authenticated`; this SECURITY DEFINER
      // RPC is the only read path. Check BOTH data and error: a failed lookup
      // previously read as "no key saved", which told a user who had saved a
      // key that they had none.
      const [orLookup, geminiLookup] = await Promise.all([
        supabase.rpc("get_encrypted_key", { p_user_id: userId, p_provider: "openrouter" }),
        supabase.rpc("get_encrypted_key", { p_user_id: userId, p_provider: "gemini" }),
      ]);

      if (orLookup.error || geminiLookup.error) {
        // Never claim "you have no key" when we simply failed to look.
        console.error(
          "Key lookup RPC failed:",
          orLookup.error?.message ?? geminiLookup.error?.message ?? "unknown"
        );
        return NextResponse.json(
          { error: "Couldn't check your saved API key just now. Please try again in a moment." },
          { status: 503 }
        );
      }

      // Decrypt server-side only — keys live only in this request scope, never logged
      let openrouterKey: string | null = null;
      let decryptFailed = false;
      try {
        if (orLookup.data) openrouterKey = decrypt(orLookup.data);
      } catch (e) {
        console.error(
          "OpenRouter key decryption failed (KEY_ENCRYPTION_SECRET rotation?):",
          e instanceof Error ? e.message : String(e)
        );
        decryptFailed = true;
      }

      if (!openrouterKey) {
        if (decryptFailed) {
          return NextResponse.json(
            {
              error: "Your saved API key couldn't be read — it may need to be re-entered. Go to Settings and replace it.",
              errorType: "key_decrypt_failed",
            },
            { status: 422 }
          );
        }
        // Distinguish "saved the wrong kind of key" from "saved nothing at all".
        // Telling someone who HAS added a key to add a key is the same confusing
        // message this routing was fixed to avoid.
        if (geminiLookup.data) {
          return NextResponse.json(
            {
              needsKeys: true,
              error:
                "Your Gemini key can't complete a tailoring run — Gemini's free tier allows 5 requests per minute and one run makes 8. Add an OpenRouter key in Settings to continue.",
              errorType: "needs_openrouter_key",
            },
            { status: 402 }
          );
        }
        // Capped and no usable key saved — prompt the Settings page.
        return NextResponse.json(
          {
            needsKeys: true,
            error: "You've used all free tailors. Add your own API key in Settings to continue.",
            errorType: "needs_keys",
          },
          { status: 402 }
        );
      }

      try {
        const result = await runOrRefund({ provider: "openrouter", apiKeyOverride: openrouterKey, jd, cv, projectNames: safeProjectNames, precomputedAnalysis: bodyAnalysis });
        return NextResponse.json(result);
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          // OpenRouter's own limit — the app imposes no cap of its own here.
          return NextResponse.json(
            {
              limitReached: true,
              error: "Your OpenRouter key has hit its usage limit. Try again later.",
              errorType: "user_key_limit",
            },
            { status: 429 }
          );
        }
        throw err;
      }
    }

    // 'profile_not_found', 'forbidden' (auth.uid() was null inside the RPC) or
    // anything unexpected: fail closed rather than run on the owner's key.
    console.error("Unexpected routing state; lifetime reason:", lifetimeReason ?? "undefined");
    return NextResponse.json(UNAVAILABLE, { status: 503 });

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
