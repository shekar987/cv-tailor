// Burst rate limiting for the Claude-spending API routes.
//
// WHY THIS EXISTS (distinct from the DB rate limits):
//   - The per-user DB counters (check_and_increment_tailor_count / _claude_lifetime)
//     cap how many tailors bill the owner's wallet. They are the source of truth
//     for quota and can't be bypassed by the client.
//   - They do NOT stop a logged-in user from *hammering* the endpoints. And
//     /api/extract-profile and /api/analyze call Claude on the owner's key with
//     no DB counter at all — a script could loop them to drain the wallet.
//   - This module adds a short-window burst limit in front of every
//     Claude-spending route, keyed by user id. It's the cheap first gate:
//     reject floods before they reach auth-heavy DB work or a paid LLM call.
//
// TWO BACKENDS:
//   - Upstash Redis when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
//     set — shared across every serverless instance. This is the real one.
//   - Otherwise (or if Redis errors) an in-process sliding window. It resets on
//     every cold start and isn't shared between instances, so it is NOT a
//     substitute for Upstash — but it means the routes that have no DB counter
//     are never completely unmetered. Previously they fell fully open.
//
// TO ACTIVATE REDIS: create a free Upstash Redis DB, then set in Vercel + .env.local:
//   UPSTASH_REDIS_REST_URL=https://<...>.upstash.io
//   UPSTASH_REDIS_REST_TOKEN=<token>

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Decision = { ok: true } | { ok: false; retryAfterSeconds: number };

const LIMIT = 10;
const WINDOW_MS = 60_000;

// A limit other than the default burst: `limit` requests per `windowSeconds`
// (/api/import-job: 20 an hour). Each distinct pair gets its own limiter.
export type LimitOptions = { limit: number; windowSeconds: number };
const DEFAULT_LIMIT: LimitOptions = { limit: LIMIT, windowSeconds: WINDOW_MS / 1000 };

// Lazily built once per warm serverless instance, one per limit shape;
// getLimiter() answers null when Upstash is not configured.
const limiters = new Map<string, Ratelimit>();
let configured: boolean | undefined;
let warned = false;

function getLimiter(opts: LimitOptions): Ratelimit | null {
  if (configured === undefined) {
    configured = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  }
  if (!configured) {
    if (!warned) {
      console.warn(
        "[apiRateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — using the in-process fallback limiter (per instance, resets on cold start)."
      );
      warned = true;
    }
    return null;
  }
  const shape = `${opts.limit}/${opts.windowSeconds}`;
  const existing = limiters.get(shape);
  if (existing) return existing;

  // Sliding window: 10 requests / 60s per identifier by default. One tailor run
  // is a single request from the client, so 10/min is generous for humans and
  // still throttles scripted floods hard. `analytics` off to avoid extra Redis
  // commands/cost. The default keeps its original prefix so live counters carry on.
  const isDefault = opts.limit === DEFAULT_LIMIT.limit && opts.windowSeconds === DEFAULT_LIMIT.windowSeconds;
  const created = new Ratelimit({
    redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! }),
    limiter: Ratelimit.slidingWindow(opts.limit, `${opts.windowSeconds} s`),
    prefix: isDefault ? "cvtailor:api" : `cvtailor:api:${shape}`,
  });
  limiters.set(shape, created);
  return created;
}

// ── In-process fallback ───────────────────────────────────────────────────────
const hits = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 5000;

function fallbackLimit(key: string, opts: LimitOptions): Decision {
  const now = Date.now();
  const windowMs = opts.windowSeconds * 1000;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= opts.limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED_KEYS) {
    // Drop the stalest keys rather than growing without bound. A key's window
    // is not known here, so only keys idle for the longest window (an hour) go.
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= Math.max(windowMs, 3_600_000))) hits.delete(k);
      if (hits.size <= MAX_TRACKED_KEYS / 2) break;
    }
  }
  return { ok: true };
}

// Enforce the burst limit for a caller identity (use the authenticated user id).
// The `bucket` namespaces the limit per route-group so one endpoint's traffic
// doesn't consume another's budget. `opts` replaces the default 10 a minute.
export async function checkBurstLimit(identifier: string, bucket: string, opts: LimitOptions = DEFAULT_LIMIT): Promise<Decision> {
  const key = `${bucket}:${identifier}`;
  const rl = getLimiter(opts);
  if (!rl) return fallbackLimit(key, opts);

  try {
    const { success, reset } = await rl.limit(key);
    if (success) return { ok: true };
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return { ok: false, retryAfterSeconds };
  } catch (err) {
    // Redis unreachable / transient error — keep serving real users, but from
    // the local window rather than with no limit at all.
    console.error("[apiRateLimit] limiter error (using in-process fallback):", err instanceof Error ? err.message : String(err));
    return fallbackLimit(key, opts);
  }
}
