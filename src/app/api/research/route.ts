// Stage 3 — company research + Fit Score.
//
// POST { url, cvText, provider?, force? } →
//   { profile, websiteStack, stackKeywords, openings, fitScore, researchedAt, cached }
//
// Order matters for the wallet: all web fetching is FREE and happens before
// the quota is touched, so an unreachable site costs the user nothing. Only
// once the raw material is in hand does the shared routing brain meter the
// run (one tailor credit) and the two model calls fire — company profile,
// then fit rubric — with a refund if either throws. Results are cached per
// (user, domain) for 7 days; a cache hit costs no credit and no model call.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { resolveLlmRoute, formatDuration } from "@/lib/llmRouting";
import { MAX_CV_CHARS, CV_TOO_LONG } from "@/lib/limits";
import {
  fetchPage,
  assertSafeUrl,
  UnsafeUrlError,
  extractLinks,
  extractTitle,
  extractMetaDescription,
  htmlToText,
  FetchedPage,
} from "@/lib/fetchPage";
import { detectWebsiteStack } from "@/lib/techFingerprint";
import { detectBoard, careersLinkCandidates, fetchBoard, harvestStackKeywords } from "@/lib/jobBoards";
import { COMPANY_PROFILE_PROMPT, FIT_SCORE_PROMPT } from "@/prompts/steps";
import { reconcileFitScore } from "@/lib/fitScore";

// node:dns (SSRF guard) and Buffer need the Node runtime.
export const runtime = "nodejs";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    // ── Burst rate limit (also caps how hard anyone can drive our fetcher) ────
    const burst = await checkBurstLimit(userId, "research");
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

    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    const cv = typeof body.cvText === "string" ? body.cvText.trim() : "";
    const force = body.force === true;
    if (!rawUrl || rawUrl.length > 500) {
      return NextResponse.json({ error: "Please paste the company's website URL." }, { status: 400 });
    }
    if (!cv) {
      return NextResponse.json({ error: "No CV text provided — save your master CV first." }, { status: 400 });
    }
    if (cv.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }

    // Users paste "deliveroo.co.uk" as readily as a full URL.
    let target: URL;
    try {
      target = await assertSafeUrl(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    const domain = target.hostname.toLowerCase().replace(/^www\./, "");

    // ── Cache (per-user, 7-day TTL) — a hit costs nothing ─────────────────────
    if (!force) {
      const { data: row, error: cacheError } = await supabase
        .from("company_profiles")
        .select("data, fetched_at")
        .eq("user_id", userId)
        .eq("domain", domain)
        .maybeSingle();
      if (cacheError) {
        // Table not migrated yet, or a transient failure — research still works, uncached.
        console.warn("Research cache read unavailable:", cacheError.message);
      } else if (row && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) {
        return NextResponse.json({ ...(row.data as Record<string, unknown>), cached: true });
      }
    }

    // ── Free gathering (≤5 page fetches + board API), before any metering ─────
    let homepage: FetchedPage;
    try {
      homepage = await fetchPage(target.toString());
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      return NextResponse.json(
        { error: "Couldn't reach that site. Check the URL and try again." },
        { status: 422 }
      );
    }
    if (homepage.status >= 400 || !homepage.body.trim()) {
      return NextResponse.json(
        { error: `That site answered with an error (HTTP ${homepage.status}). Check the URL and try again.` },
        { status: 422 }
      );
    }

    const links = extractLinks(homepage.body, homepage.url);
    const homeOrigin = new URL(homepage.url).origin;

    // Board discovery: a pasted board URL, the homepage itself, then up to two
    // careers-page candidates.
    let board = detectBoard(target.toString()) ?? detectBoard(homepage.body);
    let careersText = "";
    if (!board) {
      for (const candidate of careersLinkCandidates(links, homepage.url).slice(0, 2)) {
        try {
          const page = await fetchPage(candidate);
          if (!careersText) careersText = htmlToText(page.body, 4_000);
          board = detectBoard(page.body);
          if (board) break;
        } catch {
          // candidate unreachable — try the next
        }
      }
    }

    let aboutText = "";
    const aboutLink = links.find((l) => {
      try {
        const u = new URL(l.href);
        return u.origin === homeOrigin && /about|company|who-we-are/i.test(u.pathname);
      } catch {
        return false;
      }
    });
    if (aboutLink) {
      try {
        aboutText = htmlToText((await fetchPage(aboutLink.href)).body, 4_000);
      } catch {
        // about page unreachable — profile works from the homepage text
      }
    }

    const boardResult = board ? await fetchBoard(board) : null;
    const openings = boardResult?.openings ?? [];
    const stackCounts = harvestStackKeywords(openings.map((o) => `${o.title}\n${o.description}`));
    const websiteStack = detectWebsiteStack(homepage);

    // ── Quota + provider routing (one tailor credit — shared brain) ───────────
    const route = await resolveLlmRoute(supabase, userId, {
      bodyProvider: body.provider,
      geminiOnlyMessage:
        "Company research runs on an OpenRouter key once your free Claude credits are used — your saved Gemini key isn't used for it. Add an OpenRouter key in Settings to continue.",
    });
    if (!route.ok) {
      return NextResponse.json(route.body, { status: route.status });
    }

    // ── The two paid calls: company profile, then fit rubric ──────────────────
    const profileInput = JSON.stringify({
      domain,
      page_title: extractTitle(homepage.body),
      meta_description: extractMetaDescription(homepage.body),
      homepage_text: htmlToText(homepage.body, 6_000),
      about_text: aboutText || careersText,
      website_stack: websiteStack,
      job_ad_stack_keywords: stackCounts,
      sample_job_titles: openings.slice(0, 12).map((o) => o.title),
    });

    let profile: unknown;
    let fitRaw: unknown;
    try {
      profile = await callLLM({
        provider: route.provider,
        apiKeyOverride: route.apiKeyOverride,
        system: COMPANY_PROFILE_PROMPT,
        userInput: profileInput,
        expectJson: true,
      });

      // Deterministic job-ad keywords are the stack ground truth; the profile's
      // text-sourced list only fills in when no job ads were found.
      const profileStack = Array.isArray((profile as Record<string, unknown>)?.engineering_stack)
        ? ((profile as Record<string, unknown>).engineering_stack as unknown[]).filter(
            (s): s is string => typeof s === "string" && s.trim() !== ""
          )
        : [];
      const effectiveStack = stackCounts.length > 0 ? stackCounts.map((k) => k.keyword) : profileStack;

      fitRaw = await callLLM({
        provider: route.provider,
        apiKeyOverride: route.apiKeyOverride,
        system: FIT_SCORE_PROMPT,
        userInput: JSON.stringify({ company_profile: profile, engineering_stack: effectiveStack, master_cv: cv }),
        expectJson: true,
      });

      const fitScore = reconcileFitScore(fitRaw, cv, effectiveStack);

      const result = {
        profile,
        websiteStack,
        stackKeywords: stackCounts,
        openings,
        jobBoard: boardResult ? { provider: boardResult.provider, count: openings.length } : null,
        fitScore,
        researchedAt: new Date().toISOString(),
        cached: false,
      };

      // Cache write — best effort; a missing table degrades to uncached.
      const { error: upsertError } = await supabase
        .from("company_profiles")
        .upsert(
          { user_id: userId, domain, data: result, fetched_at: result.researchedAt },
          { onConflict: "user_id,domain" }
        );
      if (upsertError) console.warn("Research cache write unavailable:", upsertError.message);

      return NextResponse.json(result);
    } catch (err) {
      await route.refund();
      if (route.reason === "own_key" && err instanceof ProviderRateLimitError) {
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
  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      const retryMsg = error.retryAfterSeconds
        ? `Resets in ~${formatDuration(error.retryAfterSeconds * 1000)}.`
        : "Try again shortly.";
      console.error("Provider rate limit:", error.provider, error.message);
      return NextResponse.json(
        {
          error: `The service is busy right now. ${retryMsg}`,
          errorType: "provider_limit",
          retryAfter: error.retryAfterSeconds ?? null,
        },
        { status: 429 }
      );
    }
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Research API error:", msg);
    return NextResponse.json({ error: "Research failed" }, { status: 500 });
  }
}
