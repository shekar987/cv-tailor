// Edge/burst rate limiting for the Claude-spending API routes.
//
// WHY THIS EXISTS (distinct from the DB rate limits):
//   - The per-user DB counters (check_and_increment_tailor_count / _claude_lifetime)
//     cap how many *successful* tailors bill the owner's wallet. They are the
//     source of truth for quota and can't be bypassed by the client.
//   - They do NOT stop a logged-in user from *hammering* the endpoints. And
//     /api/extract-profile and /api/analyze call Claude on the owner's key with
//     no DB counter at all — a script could loop them to drain the wallet.
//   - This module adds a short-window burst limit in front of all three
//     Claude-spending routes, keyed by user id. It's the cheap first gate:
//     reject floods before they reach auth-heavy DB work or a paid LLM call.
//
// FAIL-OPEN BY DESIGN: if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
// not set, this is a no-op (logged once). A rate-limiter outage must never take
// the app down — the DB quota still protects the wallet underneath.
//
// TO ACTIVATE: create a free Upstash Redis DB, then set in Vercel + .env.local:
//   UPSTASH_REDIS_REST_URL=https://<...>.upstash.io
//   UPSTASH_REDIS_REST_TOKEN=<token>

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Decision = { ok: true } | { ok: false; retryAfterSeconds: number };

// Lazily built once per warm serverless instance. `null` = not configured.
let limiter: Ratelimit | null | undefined;
let warned = false;

function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (!warned) {
      console.warn(
        "[apiRateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — burst rate limiting is DISABLED (fail-open). DB quota still applies."
      );
      warned = true;
    }
    limiter = null;
    return limiter;
  }

  // Sliding window: 10 requests / 60s per identifier. One tailor run is a single
  // request from the client, so 10/min is generous for humans and still throttles
  // scripted floods hard. `analytics` off to avoid extra Redis commands/cost.
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "cvtailor:api",
  });
  return limiter;
}

// Enforce the burst limit for a caller identity (use the authenticated user id).
// The `bucket` namespaces the limit per route-group so one endpoint's traffic
// doesn't consume another's budget. Fails open on any limiter error.
export async function checkBurstLimit(identifier: string, bucket: string): Promise<Decision> {
  const rl = getLimiter();
  if (!rl) return { ok: true };

  try {
    const { success, reset } = await rl.limit(`${bucket}:${identifier}`);
    if (success) return { ok: true };
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return { ok: false, retryAfterSeconds };
  } catch (err) {
    // Redis unreachable / transient error — do not block real users.
    console.error("[apiRateLimit] limiter error (failing open):", err instanceof Error ? err.message : String(err));
    return { ok: true };
  }
}
