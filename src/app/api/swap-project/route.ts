// "Swap" on /app (4 Nov 2026, Chunk 14): one other pool project written for this job, in
// one model call, and nothing else re-run. Burst-limited and never metered, the policy of
// /api/fix-claims: a single small call attached to a run the daily counter already paid
// for. The server reads no per-user table: the cards, CV and registry arrive in the body,
// as on /api/tailor. The name, dates, tech and label come from the card, never the model.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { callForUser } from "@/lib/llmRouting";
import { ProviderCreditError, ProviderRateLimitError } from "@/lib/claude";
import { normalizeClaims, renderClaimsBlock } from "@/lib/claims";
import { buildEvidenceMap, renderEvidenceBlock } from "@/lib/evidenceMap";
import { poolProjectsPrompt } from "@/prompts/steps";
import { styleFor } from "@/lib/formatStyles";
import { normalizeFormatStyle } from "@/lib/formatStyles/ids";
import { normalizeSelectedProjects } from "@/lib/poolProjects";
import { alignWritten, cardToText, cardsToPoolText, normalizePoolCards, selectCards } from "@/lib/projectPool";
import { applyRetiredToBullets, normalizeRetiredClaims } from "@/lib/retiredClaims";
import { toBritishDeep } from "@/lib/britishSpelling";
import { MAX_CV_CHARS, MAX_POOL_CHARS, CV_TOO_LONG, POOL_TOO_LONG } from "@/lib/limits";

export const maxDuration = 120;

const MAX_ANALYSIS_JSON = 20_000;

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const burst = await checkBurstLimit(userId, "swap-project");
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.` },
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

    const claims = normalizeClaims(body.claims);
    const evidence = buildEvidenceMap(analysis, cv, pool, claims);
    const style = styleFor(normalizeFormatStyle(body.formatStyle));
    const system = poolProjectsPrompt(cv, cardToText(card), renderClaimsBlock(claims), "", renderEvidenceBlock(evidence), "", style.prompts.poolBullets, 1);

    let written: ReturnType<typeof normalizeSelectedProjects> = [];
    let modelError: string | null = null;
    try {
      const out = await callForUser(supabase, userId, body.provider, { system, userInput: analysisStr, expectJson: true, maxTokens: 2000 });
      written = normalizeSelectedProjects(out.result, cardToText(card), 1);
    } catch (e) {
      if (e instanceof ProviderCreditError || e instanceof ProviderRateLimitError) {
        return NextResponse.json({ error: "The model isn't available right now. Your CV is unchanged, so try the swap again later.", errorType: "provider_unavailable" }, { status: 503 });
      }
      console.error("swap-project model error:", e instanceof Error ? e.message : "Unknown error");
      modelError = "The model didn't answer, so this project uses your own words from the pool.";
    }

    const today = new Date();
    const scored = selectCards([card], { count: 1, order: "relevance" }, { keywords: analysis.top_15_ats_keywords, required: analysis.required_skills, pageTarget: 2, roles: 0, today });
    const [project] = alignWritten(scored.chosen, written);
    const rules = normalizeRetiredClaims(body.retiredClaims);
    const cleaned = applyRetiredToBullets({ "0": project.bullets }, rules).projects["0"] as string[];
    const bullets = toBritishDeep(cleaned, [], { protect: new Set(card.name.split(/\s+/)) }) as string[];
    return NextResponse.json({
      project: { ...project, bullets },
      used: { cardId: card.id, name: card.name, pinned: card.pinned, matches: scored.chosen[0]?.matches ?? [] },
      ...(modelError ? { modelError } : {}),
    });
  } catch (err) {
    console.error("swap-project error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Couldn't swap that project. Your CV is unchanged." }, { status: 500 });
  }
}
