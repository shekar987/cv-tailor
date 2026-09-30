// What runs the next tailor for this account, in one honest sentence
// (30 Sep audit, Phase 3). Settings used to say "This account runs without
// limits." for an unlimited account and never mentioned the daily cap,
// which applies on every path — the user's own key included. Pure and
// import-free (tests/); the numbers come from lib/usage and the route order
// from lib/llmRouting resolveLlmRoute: the daily cap first, then the free
// Claude credits, then the user's OpenRouter key, else a stop.

export type UsageLike = { dailyUsed: number; dailyLimit: number; claudeUsed: number; claudeLimit: number; unlimited: boolean };
export type RoutingSummary = {
  // "claude" | "openrouter" | "gemini" | "none": what the next run would use.
  next: "claude" | "openrouter" | "gemini" | "none" | "blocked";
  headline: string;
  detail: string;
};

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Claude", openrouter: "OpenRouter", gemini: "Gemini" };

export function describeRouting(
  usage: UsageLike | null | undefined,
  hasOpenRouter: boolean,
  chosenProvider: string | null = null
): RoutingSummary {
  if (!usage) {
    return {
      next: "none",
      headline: "Your usage could not be read just now.",
      detail: hasOpenRouter ? "Tailoring runs on the free credits first, then on your OpenRouter key." : "Tailoring runs on the free credits first; an OpenRouter key keeps it running after them.",
    };
  }
  const dailyLeft = Math.max(usage.dailyLimit - usage.dailyUsed, 0);
  const claudeLeft = Math.max(usage.claudeLimit - usage.claudeUsed, 0);
  if (usage.unlimited) {
    const label = PROVIDER_LABEL[chosenProvider ?? "anthropic"] ?? "Claude";
    return {
      next: label === "OpenRouter" ? "openrouter" : label === "Gemini" ? "gemini" : "claude",
      headline: `This account is unlimited: no daily cap and no credit count. ${usage.dailyUsed} tailor${usage.dailyUsed === 1 ? "" : "s"} so far today.`,
      detail: `The next run uses ${label}${chosenProvider ? " (the provider picked on the tailoring page)" : ""}.`,
    };
  }
  if (dailyLeft === 0) {
    return {
      next: "blocked",
      headline: `The daily cap is reached: ${usage.dailyLimit} tailors a day, on every path — your own key included.`,
      detail: "The next run waits for the daily window to reset.",
    };
  }
  if (claudeLeft > 0) {
    return {
      next: "claude",
      headline: `${dailyLeft} of ${usage.dailyLimit} tailors left today; ${claudeLeft} of ${usage.claudeLimit} free Claude credit${usage.claudeLimit === 1 ? "" : "s"} left.`,
      detail: hasOpenRouter
        ? "The next run uses a free Claude credit. When those are used, your OpenRouter key takes over — the daily cap still applies."
        : "The next run uses a free Claude credit. When those are used you will need an OpenRouter key; the daily cap applies either way.",
    };
  }
  if (hasOpenRouter) {
    return {
      next: "openrouter",
      headline: `${dailyLeft} of ${usage.dailyLimit} tailors left today; your free Claude credits are used.`,
      detail: "The next run uses your OpenRouter key. Free models are slower and the run skips the polish retries; every honesty check still runs.",
    };
  }
  return {
    next: "none",
    headline: `${dailyLeft} of ${usage.dailyLimit} tailors left today, but your free Claude credits are used and there is no OpenRouter key.`,
    detail: "Add a free OpenRouter key below to keep tailoring.",
  };
}
