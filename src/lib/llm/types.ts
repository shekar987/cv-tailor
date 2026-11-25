// The provider abstraction for Jobhuntz model calls (Chunk TL-1, Local Tailor).
//
// One interface — generate / generateJSON(schema) / embed — over the existing
// cloud providers (Anthropic, OpenRouter, Gemini; src/lib/llm/remote.ts wraps
// the battle-tested callLLM in src/lib/claude.ts) and a new local-ollama
// provider (src/lib/llm/ollama.ts) that talks to Ollama on the user's own PC.
//
// Model name, temperature and max tokens come from config (LLMConfig) — never
// hard-coded in a call site. JSON mode uses the provider's own structured
// output: Ollama's `format` with a JSON schema, OpenRouter/Gemini's json mode.
//
// import-free on purpose, so it runs under node:test and in the browser.

export type ProviderId = "anthropic" | "openrouter" | "gemini" | "local-ollama";

// A JSON Schema object (draft 2020-12 subset Ollama accepts in `format`).
export type JsonSchema = Record<string, unknown>;

export type LLMConfig = {
  // The generation model name, e.g. "qwen2.5:7b-instruct" (local) or
  // "claude-haiku-4-5-20251001" (cloud).
  model: string;
  // A separate model for embed(), when the generation model cannot embed.
  // Defaults to `model`.
  embedModel?: string;
  // 0 = deterministic. Tailoring wants low temperature (faithfulness over flair).
  temperature?: number;
  maxTokens?: number;
  // Per-call deadline in ms. A local run on a laptop can be slow, so this is
  // generous by default in each provider.
  timeoutMs?: number;
};

export type LLMGenerateOptions = {
  system: string; // the instructions for this step
  prompt: string; // the input (JD, CV text, previous output …)
  // Per-call overrides of the config defaults.
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type LLMGenerateJSONOptions = LLMGenerateOptions & {
  // The shape the provider must return. Ollama enforces this at decode time;
  // the cloud adapter asks for json mode and the result is JSON.parsed.
  schema: JsonSchema;
};

export interface LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  // Free-text completion. Returns the model's text, trimmed.
  generate(opts: LLMGenerateOptions): Promise<string>;
  // Structured completion. Returns the parsed JSON value (caller casts/validates).
  generateJSON<T = unknown>(opts: LLMGenerateJSONOptions): Promise<T>;
  // A single embedding vector for the text. Local providers use embedModel.
  embed(text: string): Promise<number[]>;
}

// Thrown by a provider when the model host is unreachable or errors. Kept
// distinct so the queue worker can mark a job failed with a clear reason
// (e.g. "Ollama isn't running — start it and try again").
export class LLMProviderError extends Error {
  provider: ProviderId;
  constructor(provider: ProviderId, message: string) {
    super(message);
    this.name = "LLMProviderError";
    this.provider = provider;
  }
}
