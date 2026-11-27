// POST /api/check/outreach — honest outreach checker (JH-7, 26 Nov 2026).
//
// Reads the user's master CV and retired-claims list from the database (never
// trusts them from the body). No model call, no credit. Returns { ok, blocks, warns }.
//
// Burst-limited the same way as /api/tailor/letter-smart (20 per minute).

import { NextRequest, NextResponse } from "next/server";
import {
  signedIn,
  unauthorized,
  readJsonBody,
  invalidBody,
  declaresMoreThan,
  payloadTooLarge,
} from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { normalizePreferences } from "@/lib/preferences";
import { checkOutreach, type OutreachKind, type OutreachRow } from "@/lib/outreachCheck";

export const runtime = "nodejs";
export const maxDuration = 10;

const VALID_KINDS = new Set<OutreachKind>(["follow_up", "cold_email", "dm", "letter"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Column-ladder helper: a migration-added column may be absent (PGRST204 / 42703).
function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

export async function POST(req: NextRequest) {
  if (declaresMoreThan(req, 50_000)) return payloadTooLarge();

  const caller = await signedIn();
  if (!caller) return unauthorized();
  const { supabase, userId } = caller;

  const burst = await checkBurstLimit(userId, "check-outreach", { limit: 20, windowSeconds: 60 });
  if (!burst.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again.", errorType: "burst_limit" },
      { status: 429 },
    );
  }

  const body = await readJsonBody(req);
  if (!body) return invalidBody();

  // ── Validate request fields ────────────────────────────────────────────────

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required." }, { status: 400 });
  }

  const rawKind = body.kind;
  if (!rawKind || !VALID_KINDS.has(rawKind as OutreachKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${[...VALID_KINDS].join(", ")}.` },
      { status: 400 },
    );
  }
  const kind = rawKind as OutreachKind;

  const recipient = typeof body.recipient === "string" ? body.recipient.trim() : undefined;

  const rawAppId = body.application_id;
  const applicationId =
    typeof rawAppId === "string" && UUID_RE.test(rawAppId) ? rawAppId : null;

  const rawRecent = Array.isArray(body.recent_texts) ? body.recent_texts : [];
  const recentTexts = rawRecent
    .filter((t: unknown): t is string => typeof t === "string")
    .map((t) => t.slice(0, 2000))
    .slice(0, 50);

  // ── Read master CV (never from the body) ──────────────────────────────────

  let masterText = "";
  {
    const first = await supabase.from("master_cvs").select("text, projects_pool").maybeSingle();
    if (first.error && isMissingColumn(first.error)) {
      const second = await supabase.from("master_cvs").select("text").maybeSingle();
      if (second.error) {
        console.error("check/outreach: master CV read error:", second.error.message);
        return NextResponse.json({ error: "Could not load your main CV." }, { status: 500 });
      }
      masterText = typeof second.data?.text === "string" ? second.data.text.trim() : "";
    } else if (first.error) {
      console.error("check/outreach: master CV read error:", first.error.message);
      return NextResponse.json({ error: "Could not load your main CV." }, { status: 500 });
    } else {
      masterText = typeof first.data?.text === "string" ? first.data.text.trim() : "";
    }
  }

  if (!masterText) {
    return NextResponse.json(
      { error: "Save your main CV on My CV first.", errorType: "needs_cv" },
      { status: 400 },
    );
  }

  // ── Read user_settings.preferences for retiredClaims ─────────────────────
  // The preferences column is a later migration; degrade if missing.

  let retiredClaims: ReturnType<typeof normalizePreferences>["retiredClaims"] = [];
  {
    const first = await supabase
      .from("user_settings")
      .select("preferences")
      .maybeSingle();
    if (first.error && !isMissingColumn(first.error)) {
      // Non-structural error: proceed with no retired claims rather than failing
      console.error("check/outreach: user_settings read error:", first.error.message);
    } else if (!first.error && first.data?.preferences) {
      const prefs = normalizePreferences(first.data.preferences);
      retiredClaims = prefs.retiredClaims;
    }
  }

  // ── Optionally load tracker row ───────────────────────────────────────────

  let row: OutreachRow | undefined;
  if (applicationId) {
    const { data, error } = await supabase
      .from("applications")
      .select("status, pending_outcome")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) {
      console.error("check/outreach: application row read error:", error.message);
      // Proceed without the row check rather than hard-failing.
    } else if (data) {
      row = {
        status: typeof data.status === "string" ? data.status : "",
        pending_outcome: data.pending_outcome ?? undefined,
      };
    }
  }

  // ── Run the check ─────────────────────────────────────────────────────────

  const result = checkOutreach({
    text,
    kind,
    recipient,
    row,
    recentTexts: recentTexts.length > 0 ? recentTexts : undefined,
    masterText,
    retiredClaims,
  });

  return NextResponse.json(result);
}
