import test from "node:test";
import assert from "node:assert/strict";
import { chooseFallback, fallbackNotice, openRouterLimitMessage, fallbackExhaustedMessage } from "../src/lib/fallbackRoute.ts";

test("chooseFallback: the user's own OpenRouter key first, the deployment's only for the unlimited path, never from an own-key run", () => {
  assert.deepEqual(chooseFallback({ failedProvider: "anthropic", routeReason: "ok", ownKey: "sk-or-v1-x", envOpenRouterKey: true }), { provider: "openrouter", apiKeyOverride: "sk-or-v1-x", source: "own_key" });
  assert.deepEqual(chooseFallback({ failedProvider: "anthropic", routeReason: "unlimited", ownKey: null, envOpenRouterKey: true }), { provider: "openrouter", apiKeyOverride: undefined, source: "env_key" });
  assert.equal(chooseFallback({ failedProvider: "anthropic", routeReason: "ok", ownKey: null, envOpenRouterKey: true }), null, "a free-credit user without a key gets the Settings pointer, not the owner's env key");
  assert.equal(chooseFallback({ failedProvider: "openrouter", routeReason: "own_key", ownKey: "sk-or-v1-x", envOpenRouterKey: true }), null, "already on the own key");
  assert.equal(chooseFallback({ failedProvider: "openrouter", routeReason: "unlimited", ownKey: "sk-or-v1-x", envOpenRouterKey: true }), null, "OpenRouter failing is not rescued by OpenRouter");
  assert.equal(chooseFallback({ failedProvider: "anthropic", routeReason: "ok", ownKey: null, envOpenRouterKey: false }), null);
});

test("openRouterLimitMessage names the free-model daily cap and the $10 unlock", () => {
  assert.match(openRouterLimitMessage({ message: "OpenRouter free-model daily limit reached" }), /50 free requests.*\$10 of credit/);
  assert.equal(openRouterLimitMessage({ message: "OpenRouter rate limit exceeded" }), "Your API key has reached its limit. Try again later.");
});

test("fallbackExhaustedMessage names both closed roads", () => {
  const m = fallbackExhaustedMessage("provider_credit", { message: "OpenRouter free-model daily limit reached" });
  assert.match(m, /^Our free AI service is not available, so Jobhuntz tried your own API key\./);
  assert.match(m, /50 free requests/);
});

test("fallbackNotice says what ran and why, and that no free tailor was spent", () => {
  assert.equal(fallbackNotice({ source: "own_key", reason: "provider_credit" }), "This CV was written with your own API key because our free AI service is not available right now. It did not use one of your free tailored CVs.");
  assert.match(fallbackNotice({ source: "env_key", reason: "provider_limit" }), /deployment's OpenRouter key because our free AI service is busy/);
});
