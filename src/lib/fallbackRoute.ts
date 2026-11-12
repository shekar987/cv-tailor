// When the shared Claude account cannot serve a run (its balance is at zero,
// or Anthropic is rate-limiting it), the run is retried once on the user's
// own OpenRouter key — the key Settings already invites them to save for
// exactly this — instead of ending in a 503 that tells them to go and add
// the key they may already have. The owner's unlimited path may also fall
// back to the deployment's OpenRouter key.
//
// The decision is a pure function so it is unit-tested; the routes supply
// the lookups. Import-free.

export type FallbackReason = "provider_credit" | "provider_limit";
export type FallbackSource = "own_key" | "env_key";
export type Fallback = { provider: "openrouter"; apiKeyOverride: string | undefined; source: FallbackSource };

export function chooseFallback(a: {
  // The provider whose run just failed.
  failedProvider: string;
  // How the run was routed: the owner's unlimited path, a free Claude credit,
  // or the user's own key (which never falls back — it already IS the fallback).
  routeReason: "unlimited" | "ok" | "own_key";
  ownKey: string | null;
  envOpenRouterKey: boolean;
}): Fallback | null {
  if (a.routeReason === "own_key" || a.failedProvider === "openrouter") return null;
  if (a.ownKey) return { provider: "openrouter", apiKeyOverride: a.ownKey, source: "own_key" };
  if (a.routeReason === "unlimited" && a.envOpenRouterKey) return { provider: "openrouter", apiKeyOverride: undefined, source: "env_key" };
  return null;
}

// What to tell the user when the OpenRouter key itself is out of road.
export function openRouterLimitMessage(err: { message: string }): string {
  return /daily limit/i.test(err.message)
    ? "Your API key has used today's 50 free requests at OpenRouter. One tailored CV needs about 10. Add $10 of credit at openrouter.ai for 1,000 a day, or try again tomorrow."
    : "Your API key has reached its limit. Try again later.";
}

// Both roads closed: the shared account could not serve the run AND the
// key it fell back to is out of allowance. Say both — a message that only
// names OpenRouter reads as if Claude were fine.
export function fallbackExhaustedMessage(reason: FallbackReason, err: { message: string }): string {
  const first = reason === "provider_credit"
    ? "Our free AI service is not available, so Jobhuntz tried your own API key."
    : "Our free AI service is busy, so Jobhuntz tried your own API key.";
  return `${first} ${openRouterLimitMessage(err)}`;
}

export function fallbackNotice(f: { source: FallbackSource; reason: FallbackReason }): string {
  const why = f.reason === "provider_credit" ? "our free AI service is not available right now" : "our free AI service is busy";
  const on = f.source === "own_key" ? "your own API key" : "the deployment's OpenRouter key";
  return `This CV was written with ${on} because ${why}. It did not use one of your free tailored CVs.`;
}
