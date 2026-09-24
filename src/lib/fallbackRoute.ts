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

export function fallbackNotice(f: { source: FallbackSource; reason: FallbackReason }): string {
  const why = f.reason === "provider_credit" ? "the shared Claude account is out of credit" : "the shared Claude account is being rate-limited";
  const on = f.source === "own_key" ? "your OpenRouter key" : "the deployment's OpenRouter key";
  return `This run used ${on} because ${why}. Nothing was charged to your free tailors.`;
}
