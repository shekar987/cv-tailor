// "Swap" on /app (4 Nov 2026, Chunk 14): one other pool project written for this job, in
// one model call, and nothing else re-run. Burst-limited and not metered, the policy of
// /api/fix-claims, but on the wallet the user's next tailor would use: someone with no free
// tailors left swaps on their own key, never on the shared account. The server reads no
// per-user content table: the cards, CV and registry arrive in the body, as on /api/tailor.
// The name, dates, tech and label come from the card, never the model; the bullets take the
// same deterministic passes a tailor's project bullets do.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { callOnPath, loadOwnOpenRouterKey, type LlmPath } from "@/lib/llmRouting";
import { ProviderCreditError, ProviderRateLimitError } from "@/lib/claude";
import { isLearningTech, normalizeClaims, renderClaimsBlock } from "@/lib/claims";
import { buildEvidenceMap, renderEvidenceBlock } from "@/lib/evidenceMap";
import { poolProjectsPrompt } from "@/prompts/steps";
import { styleFor } from "@/lib/formatStyles";
import { normalizeFormatStyle } from "@/lib/formatStyles/ids";
import { normalizeSelectedProjects } from "@/lib/poolProjects";
import { OTHER_PROJECT_BULLETS, TOP_PROJECT_BULLETS, alignWritten, cardToText, cardsToPoolText, normalizePoolCards, selectCards } from "@/lib/projectPool";
import { stripLinkText } from "@/lib/projectLinks";
import { trimBoltOn } from "@/lib/quality";
import { stripRightToWorkBullets } from "@/lib/rightToWorkText";
import { applyBulletStyle } from "@/lib/stylePass";
import { applyRetiredToBullets, normalizeRetiredClaims } from "@/lib/retiredClaims";
import { toBritishDeep } from "@/lib/britishSpelling";
import { CLAUDE_LIFETIME_LIMIT, MAX_CV_CHARS, MAX_POOL_CHARS, CV_TOO_LONG, POOL_TOO_LONG } from "@/lib/limits";

export const maxDuration = 120;

const MAX_ANALYSIS_JSON = 20_000;
const SWAPS_PER_HOUR = 20;

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const burst = await checkBurstLimit(userId, "swap-project", { limit: SWAPS_PER_HOUR, windowSeconds: 3600 });
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many swaps. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }
    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    const cards = normalizePoolCards(body.cards);
    const card = cards.find((c) => c.id === body.cardId);
    if (!card) return NextResponse.json({ error: "That project isn't in your pool." }, { status: 404 });
    const cv = typeof body.cvText === "string" ? body.cvText.trim() : "";
    if (!cv) return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    if (cv.length > MAX_CV_CHARS) return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    const pool = cardsToPoolText(cards);
    if (pool.length > MAX_POOL_CHARS) return NextResponse.json({ error: POOL_TOO_LONG }, { status: 400 });
    const analysis = body.analysis && typeof body.analysis === "object" ? (body.analysis as Record<string, unknown>) : {};
    const analysisStr = JSON.stringify(analysis);
    if (analysisStr.length > MAX_ANALYSIS_JSON) return NextResponse.json({ error: "That analysis is too long." }, { status: 400 });

    const { data: account, error: accountError } = await supabase.from("profiles").select("is_unlimited, claude_tailors_used").eq("id", userId).maybeSingle();
    if (accountError || !account) return NextResponse.json({ error: "Couldn't check your account. Your CV is unchanged, so try again." }, { status: 503 });
    const unlimited = account.is_unlimited === true;
    let path: LlmPath = unlimited ? "unlimited" : "claude";
    if (!unlimited && (typeof account.claude_tailors_used === "number" ? account.claude_tailors_used : 0) >= CLAUDE_LIFETIME_LIMIT) {
      const own = await loadOwnOpenRouterKey(supabase, userId);
      if (own.error) return NextResponse.json({ error: "Couldn't read your saved key. Your CV is unchanged, so try again, or re-enter the key in Settings." }, { status: 503 });
      if (!own.key) {
        return NextResponse.json({ error: "You've used your free tailors, so a swap needs your own OpenRouter key. Add it in Settings. Your CV is unchanged.", errorType: "needs_openrouter_key" }, { status: 402 });
      }
      path = "own_key";
    }

    const claims = normalizeClaims(body.claims);
    const evidence = buildEvidenceMap(analysis, cv, pool, claims);
    // CareerSet is the owner's trial; every other account runs UKJI, as on /api/tailor.
    const style = styleFor(unlimited ? normalizeFormatStyle(body.formatStyle) : "ukji");
    const system = poolProjectsPrompt(cv, cardToText(card), renderClaimsBlock(claims), "", renderEvidenceBlock(evidence), "", style.prompts.poolBullets, 1);

    let written: ReturnType<typeof normalizeSelectedProjects> = [];
    let modelError: string | null = null;
    try {
      const out = await callOnPath(supabase, userId, path, body.provider, { system, userInput: analysisStr, expectJson: true, maxTokens: 2000 });
      written = normalizeSelectedProjects(out, cardToText(card), 1);
    } catch (e) {
      if (e instanceof ProviderCreditError || e instanceof ProviderRateLimitError) {
        return NextResponse.json({ error: "The model isn't available right now. Your CV is unchanged, so try the swap again later.", errorType: "provider_unavailable" }, { status: 503 });
      }
      console.error("swap-project model error:", e instanceof Error ? e.message : "Unknown error");
      modelError = "The model didn't answer, so this project uses your own words from the pool.";
    }

    const scored = selectCards([card], { count: 1, order: "relevance" }, { keywords: analysis.top_15_ats_keywords, required: analysis.required_skills, pageTarget: 2, roles: 0, today: new Date() });
    const [project] = alignWritten(scored.chosen, written, (item) => !isLearningTech(item, claims));

    // The passes a tailor's project bullets take, in its order.
    const company = typeof analysis.company_name === "string" ? analysis.company_name : "";
    let bullets = project.bullets.map((b) => stripLinkText(trimBoltOn(b, company) ?? b)).filter(Boolean);
    if (body.includeRightToWorkOnCv !== true) bullets = (stripRightToWorkBullets({ "0": bullets }).projects as Record<string, string[]>)["0"] ?? [];
    bullets = applyBulletStyle({ experience: "", projects: { "0": bullets } }, { render: style.render, lint: style.lint, limits: style.limits }, [], [project.name]).projects["0"] ?? bullets;
    if (body.onePage === true) bullets = bullets.slice(0, body.index === 0 ? TOP_PROJECT_BULLETS : OTHER_PROJECT_BULLETS);
    const british = toBritishDeep(bullets, [], { protect: new Set(`${card.name} ${card.label}`.split(/[\s|—–,()]+/).filter(Boolean)) }) as string[];
    const finished = applyRetiredToBullets({ "0": british }, normalizeRetiredClaims(body.retiredClaims)).projects["0"] as string[];

    return NextResponse.json({
      project: { ...project, bullets: finished },
      used: { cardId: card.id, name: card.name, pinned: card.pinned, matches: scored.chosen[0]?.matches ?? [] },
      techLeftOut: card.tech.filter((t) => isLearningTech(t, claims)),
      ...(modelError ? { modelError } : {}),
    });
  } catch (err) {
    console.error("swap-project error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Couldn't swap that project. Your CV is unchanged." }, { status: 500 });
  }
}
