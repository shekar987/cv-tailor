import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Models: haiku for cheap dev/testing, sonnet for production quality
export const MODELS = {
  fast: "claude-haiku-4-5-20251001",
  quality: "claude-sonnet-4-6",
};

// OpenRouter's free-model catalog rotates (models get added/retired without notice).
// "openrouter/free" is OpenRouter's own auto-router alias that always resolves to
// some currently-live free model, so this never hard-breaks. Set OPENROUTER_MODEL
// to pin a specific model (e.g. "meta-llama/llama-3.3-70b-instruct:free"). If a run
// errors with a "model not found"-style message, check openrouter.ai/models
// (Price -> Free) for what's currently live.
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

// Pinned, not the "-latest" alias — Gemini's "-latest" aliases have a documented
// history of silently resolving to a since-deprecated model and 404ing with no
// actionable error. gemini-2.5-flash is confirmed free-tier eligible; switch to
// gemini-3.5-flash (also free-tier eligible as of this writing) via this env var
// if you prefer the newer model — check ai.google.dev/gemini-api/docs/pricing
// first, since Google has changed free-tier model availability before.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Thrown by any provider adapter when the provider itself returns a 429 (its own
// quota/rate-limit, not this app's per-user limit). Kept distinct from a plain
// Error so route.ts can show a specific "provider's limit reached" message
// instead of a generic failure.
export class ProviderRateLimitError extends Error {
  provider: Provider;
  retryAfterSeconds?: number;

  constructor(provider: Provider, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ProviderRateLimitError";
    this.provider = provider;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Best-effort retry-time extraction: the standard Retry-After header (seconds;
// OpenRouter and others use this), falling back to Gemini's own RetryInfo shape
// embedded in the JSON error body (e.g. "retryDelay": "11s"). Returns undefined
// if neither is present — callers show a generic "try again later" in that case.
function extractRetryAfterSeconds(res: Response, bodyText: string): number | undefined {
  const header = res.headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header);

  const match = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (match) return Math.ceil(Number(match[1]));

  return undefined;
}

function cleanText(raw: string): string {
  return raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}

function parseIfJson(text: string, expectJson: boolean) {
  if (!expectJson) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Model returned invalid JSON: " + text.slice(0, 200));
  }
}

type BaseCallOptions = {
  system: string;       // the prompt/instructions for this step
  userInput: string;    // the input (JD, previous step output, etc.)
  model?: string;       // defaults to fast
  maxTokens?: number;   // defaults to 2000
  expectJson?: boolean; // if true, strip fences + validate JSON
};

/**
 * Calls Claude with a system prompt and user input.
 * Returns clean text, or parsed JSON if expectJson is true.
 */
export async function callClaude(options: BaseCallOptions) {
  const {
    system,
    userInput,
    model = MODELS.fast,
    maxTokens = 2000,
    expectJson = false,
  } = options;

  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userInput }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const text = cleanText(textBlock && "text" in textBlock ? textBlock.text : "");

  return parseIfJson(text, expectJson);
}

// PRIVACY (manual pre-flight — not enforced by this code): OpenRouter's free
// models are offered in exchange for the underlying provider's ability to train
// on inputs. Before routing real CV data through "openrouter", set the free-tier
// data policy in your OpenRouter account settings to exclude providers that
// train, and keep prompt logging OFF (enabling it grants OpenRouter an
// irrevocable commercial-use license on the logged content).
async function callOpenRouter(options: BaseCallOptions, apiKeyOverride?: string) {
  const {
    system,
    userInput,
    model = OPENROUTER_MODEL,
    maxTokens = 2000,
    expectJson = false,
  } = options;

  const apiKey = apiKeyOverride ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userInput },
      ],
      // Free-tier models (8B/nano-class especially) are less reliable than Claude
      // at strict JSON. Forcing json_object makes a non-compliant model fail loudly
      // (OpenRouter returns an error) instead of returning prose that breaks
      // JSON.parse downstream.
      ...(expectJson ? { response_format: { type: "json_object" as const } } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new ProviderRateLimitError(
        "openrouter",
        "OpenRouter rate limit exceeded",
        extractRetryAfterSeconds(res, body)
      );
    }
    throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = cleanText(data.choices?.[0]?.message?.content ?? "");

  return parseIfJson(text, expectJson);
}

// PRIVACY (manual pre-flight — not enforced by this code): Gemini's free tier
// trains on inputs with NO opt-out — that's only available on the paid tier.
// Real CV data goes through a train-on-inputs third-party model when this
// provider is active. Confirm you're OK with that before using "gemini".
async function callGemini(options: BaseCallOptions, apiKeyOverride?: string) {
  const {
    system,
    userInput,
    model = GEMINI_MODEL,
    maxTokens = 2000,
    expectJson = false,
  } = options;

  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userInput }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          // gemini-2.5-flash has "thinking" on by default, and thinking tokens count
          // against maxOutputTokens. With this app's long rule-laden system prompts,
          // thinking alone consumed nearly the full budget (confirmed via
          // usageMetadata.thoughtsTokenCount ~1900/2000), leaving almost nothing for
          // the actual answer and truncating every step (finishReason: MAX_TOKENS).
          // These are straightforward extraction/rewriting tasks, not multi-step
          // reasoning, so thinking is disabled outright rather than just widening
          // the token budget and hoping the (variable) thinking allocation fits.
          thinkingConfig: { thinkingBudget: 0 },
          // Decoding-time constraint (the model can only emit valid JSON tokens),
          // stronger than OpenRouter's best-effort json_object mode. Malformed
          // output past this still fails loudly via parseIfJson below.
          ...(expectJson ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new ProviderRateLimitError(
        "gemini",
        "Gemini rate limit exceeded",
        extractRetryAfterSeconds(res, body)
      );
    }
    throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = cleanText(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");

  return parseIfJson(text, expectJson);
}

export type Provider = "anthropic" | "openrouter" | "gemini";

type CallLLMOptions = BaseCallOptions & {
  provider: Provider;       // resolved once per tailor run — never mixed mid-run
  apiKeyOverride?: string;  // user-supplied decrypted key; never logged or returned to client
};

/**
 * Provider-generalized version of callClaude(). Used by the tailoring chain,
 * where the provider is picked once per run and passed through to every step.
 * When apiKeyOverride is set the user's own decrypted key is used instead of
 * the app's env key — only possible for gemini and openrouter.
 */
export async function callLLM(options: CallLLMOptions) {
  const { provider, apiKeyOverride, ...rest } = options;
  if (provider === "anthropic") return callAnthropic(rest);
  if (provider === "openrouter") return callOpenRouter(rest, apiKeyOverride);
  return callGemini(rest, apiKeyOverride);
}

// Anthropic call logic factored out so both callClaude() (used by /api/analyze
// and /api/extract-profile, untouched) and callLLM() (used by /api/tailor) share
// one implementation. The try/catch here is additive — callClaude()'s own
// behavior is unchanged, this just re-throws Anthropic's 429s as the same
// ProviderRateLimitError the other two providers use, so route.ts can handle
// all three providers' rate limits identically.
async function callAnthropic(options: BaseCallOptions) {
  try {
    return await callClaude(options);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      const retryAfter = err.headers?.get("retry-after");
      throw new ProviderRateLimitError(
        "anthropic",
        "Claude rate limit exceeded",
        retryAfter ? Number(retryAfter) : undefined
      );
    }
    throw err;
  }
}