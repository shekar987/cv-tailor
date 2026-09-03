// The quota + provider routing brain, shared by every route that spends a
// paid model run (/api/tailor, /api/research). Extracted verbatim from the
// tailor route so both endpoints meter the same wallet the same way:
//
//   1. check_and_increment_tailor_count  — the daily quota (fail-closed)
//   2. check_and_increment_claude_lifetime — decides the path:
//        reason = 'unlimited'            → owner account; honour the client's
//                                          provider choice; env keys
//        reason = 'ok'                   → free Claude credit just spent
//        reason = 'claude_limit_reached' → route to the user's own OpenRouter key
//        anything else / DB error        → fail closed (503)
//
// A granted route carries a refund() that gives both incremented counters
// back — call it when the paid run throws after metering. Best effort: a
// missing refund function (migration not applied) is logged, never surfaced.

import { createClient } from "@/lib/supabase/server";
import { Provider } from "@/lib/claude";
import { decrypt } from "@/lib/keyEncryption";
import { DAILY_TAILOR_LIMIT, CLAUDE_LIFETIME_LIMIT } from "@/lib/limits";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export const UNAVAILABLE = { error: "Service temporarily unavailable. Please try again in a moment." };

// For unlimited users only — reads provider from the request body, then env, then defaults.
export function resolveProvider(bodyProvider: unknown): Provider {
  if (bodyProvider === "anthropic" || bodyProvider === "openrouter" || bodyProvider === "gemini") {
    return bodyProvider;
  }
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider === "anthropic" || envProvider === "openrouter" || envProvider === "gemini") {
    return envProvider;
  }
  return "anthropic";
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "shortly";
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours    = Math.floor(totalMinutes / 60);
  const minutes  = totalMinutes % 60;
  if (hours   === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export type RouteDenied = { ok: false; status: number; body: Record<string, unknown> };

export type RouteGranted = {
  ok: true;
  provider: Provider;
  apiKeyOverride: string | undefined;
  // "unlimited" — owner account (client-chosen provider honoured);
  // "ok" — a free Claude credit was just spent; "own_key" — user's OpenRouter key.
  reason: "unlimited" | "ok" | "own_key";
  refund: () => Promise<void>;
};

export async function resolveLlmRoute(
  supabase: Supabase,
  userId: string,
  opts: {
    bodyProvider?: unknown;
    // Shown when the user's only saved key is Gemini, which Path C never
    // routes to. The default explains the tailoring pipeline's constraint;
    // routes with a different run shape pass their own honest wording.
    geminiOnlyMessage?: string;
  } = {}
): Promise<RouteGranted | RouteDenied> {
  // ── Daily quota (all users, all providers) ────────────────────────────────
  // The quota is the wallet's last line of defence, so it fails CLOSED: if
  // the counter can't be read, no paid run happens.
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
    return { ok: false, status: 503, body: UNAVAILABLE };
  }
  if (!rpcResult.allowed) {
    if (rpcResult.reason === "limit_reached") {
      const resetAt   = rpcResult.reset_at as string;
      const remaining = formatDuration(new Date(resetAt).getTime() - Date.now());
      return {
        ok: false,
        status: 429,
        body: {
          error: `You've reached your daily tailoring limit (${DAILY_TAILOR_LIMIT} per 24 hours). Resets in ${remaining}.`,
          errorType: "user_limit",
          resetAt,
        },
      };
    }
    // profile_not_found / forbidden: the account row the quota lives on is
    // missing or invisible. Running unmetered would be the wrong default.
    console.error("Rate limit RPC refused:", rpcResult.reason ?? "unknown reason");
    return {
      ok: false,
      status: 503,
      body: { error: "Your account isn't fully set up yet. Sign out and back in, and if this persists, contact support." },
    };
  }

  // ── Lifetime Claude counter → routing decision ────────────────────────────
  const { data: lifetimeResult, error: lifetimeError } = await supabase.rpc(
    "check_and_increment_claude_lifetime",
    { uid: userId, lifetime_limit: CLAUDE_LIFETIME_LIMIT }
  );

  if (lifetimeError || !lifetimeResult) {
    console.error("Claude lifetime RPC error:", lifetimeError?.message ?? "no result");
    return { ok: false, status: 503, body: UNAVAILABLE };
  }

  const lifetimeReason = lifetimeResult.reason as string | undefined;

  // Both counters have been incremented at this point. If the paid run then
  // fails — provider 429, upstream outage, transport error — give the slot
  // back; the user got nothing for it.
  async function refund() {
    const calls = [supabase.rpc("refund_tailor_count", { uid: userId })];
    if (lifetimeReason === "ok") calls.push(supabase.rpc("refund_claude_lifetime", { uid: userId }));
    const settled = await Promise.allSettled(calls);
    for (const s of settled) {
      if (s.status === "rejected") console.error("Quota refund failed:", s.reason instanceof Error ? s.reason.message : String(s.reason));
      else if (s.value.error) console.error("Quota refund RPC error:", s.value.error.message);
    }
  }

  // Path A: unlimited account — the only path that honours a client-chosen provider.
  if (lifetimeReason === "unlimited") {
    return { ok: true, provider: resolveProvider(opts.bodyProvider), apiKeyOverride: undefined, reason: "unlimited", refund };
  }

  // Path B: user has free Claude credits (counter just incremented).
  if (lifetimeReason === "ok") {
    return { ok: true, provider: "anthropic", apiKeyOverride: undefined, reason: "ok", refund };
  }

  // Path C: Claude credits exhausted — route to the user's own key.
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
      return {
        ok: false,
        status: 503,
        body: { error: "Couldn't check your saved API key just now. Please try again in a moment." },
      };
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
        return {
          ok: false,
          status: 422,
          body: {
            error: "Your saved API key couldn't be read — it may need to be re-entered. Go to Settings and replace it.",
            errorType: "key_decrypt_failed",
          },
        };
      }
      // Distinguish "saved the wrong kind of key" from "saved nothing at all".
      // Telling someone who HAS added a key to add a key is the same confusing
      // message this routing was fixed to avoid.
      if (geminiLookup.data) {
        return {
          ok: false,
          status: 402,
          body: {
            needsKeys: true,
            error:
              opts.geminiOnlyMessage ??
              "Your Gemini key can't complete a tailoring run — Gemini's free tier allows 5 requests per minute and one run makes 8. Add an OpenRouter key in Settings to continue.",
            errorType: "needs_openrouter_key",
          },
        };
      }
      // Capped and no usable key saved — prompt the Settings page.
      return {
        ok: false,
        status: 402,
        body: {
          needsKeys: true,
          error: "You've used all free tailors. Add your own API key in Settings to continue.",
          errorType: "needs_keys",
        },
      };
    }

    return { ok: true, provider: "openrouter", apiKeyOverride: openrouterKey, reason: "own_key", refund };
  }

  // 'profile_not_found', 'forbidden' (auth.uid() was null inside the RPC) or
  // anything unexpected: fail closed rather than run on the owner's key.
  console.error("Unexpected routing state; lifetime reason:", lifetimeReason ?? "undefined");
  return { ok: false, status: 503, body: UNAVAILABLE };
}
