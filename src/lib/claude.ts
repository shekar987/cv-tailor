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
async function callOpenRouter(options: BaseCallOptions) {
  const {
    system,
    userInput,
    model = OPENROUTER_MODEL,
    maxTokens = 2000,
    expectJson = false,
  } = options;

  const apiKey = process.env.OPENROUTER_API_KEY;
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
    throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = cleanText(data.choices?.[0]?.message?.content ?? "");

  return parseIfJson(text, expectJson);
}

export type Provider = "anthropic" | "openrouter";

type CallLLMOptions = BaseCallOptions & {
  provider: Provider; // resolved once per tailor run — never mixed mid-run
};

/**
 * Provider-generalized version of callClaude(). Used by the tailoring chain,
 * where the provider is picked once per run and passed through to every step.
 * The two providers are fully separate: no fallback from openrouter to
 * anthropic on failure — a failed OpenRouter call throws, it does not retry
 * on Claude.
 */
export async function callLLM(options: CallLLMOptions) {
  const { provider, ...rest } = options;
  return provider === "anthropic" ? callAnthropic(rest) : callOpenRouter(rest);
}

// Anthropic call logic factored out so both callClaude() (used by /api/analyze
// and /api/extract-profile, untouched) and callLLM() (used by /api/tailor) share
// one implementation.
async function callAnthropic(options: BaseCallOptions) {
  return callClaude(options);
}