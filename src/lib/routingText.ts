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
      detail: hasOpenRouter ? "Jobhuntz uses your free tailored CVs first, then your own API key." : "Jobhuntz uses your free tailored CVs first. After them you need your own API key.",
    };
  }
  const dailyLeft = Math.max(usage.dailyLimit - usage.dailyUsed, 0);
  const claudeLeft = Math.max(usage.claudeLimit - usage.claudeUsed, 0);
  if (usage.unlimited) {
    const label = PROVIDER_LABEL[chosenProvider ?? "anthropic"] ?? "Claude";
    return {
      next: label === "OpenRouter" ? "openrouter" : label === "Gemini" ? "gemini" : "claude",
      headline: `This account is unlimited: no daily limit and no count of free tailored CVs. ${usage.dailyUsed} tailored CV${usage.dailyUsed === 1 ? "" : "s"} so far today.`,
      detail: `Your next tailored CV uses ${label}${chosenProvider ? " (the provider picked on the Tailor page)" : ""}.`,
    };
  }
  if (dailyLeft === 0) {
    return {
      next: "blocked",
      headline: `You have reached today's limit: ${usage.dailyLimit} tailored CVs a day. The limit also applies on your own API key.`,
      detail: "You can tailor again when the limit resets.",
    };
  }
  if (claudeLeft > 0) {
    return {
      next: "claude",
      headline: `${dailyLeft} of ${usage.dailyLimit} left today. ${claudeLeft} of ${usage.claudeLimit} free tailored CV${usage.claudeLimit === 1 ? "" : "s"} left in total.`,
      detail: hasOpenRouter
        ? "Your next tailored CV is a free one. When the free ones are used, Jobhuntz uses your own API key. The daily limit still applies."
        : "Your next tailored CV is a free one. When the free ones are used, you will need your own API key. The daily limit applies in both cases.",
    };
  }
  if (hasOpenRouter) {
    return {
      next: "openrouter",
      headline: `${dailyLeft} of ${usage.dailyLimit} left today. Your free tailored CVs are used.`,
      detail: "Your next tailored CV uses your own API key. Free models are slower, and some second attempts at wording are skipped. Every honesty check still runs.",
    };
  }
  return {
    next: "none",
    headline: `${dailyLeft} of ${usage.dailyLimit} left today, but your free tailored CVs are used and you have no API key.`,
    detail: "Add your own API key below to keep tailoring.",
  };
}
