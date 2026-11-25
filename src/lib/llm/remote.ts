// The cloud providers behind the shared LLMProvider interface (Chunk TL-1).
//
// A thin adapter over callLLM in src/lib/claude.ts — the existing, battle-tested
// Anthropic / OpenRouter / Gemini path — so the new provider abstraction wraps
// what already works rather than reimplementing it. generate / generateJSON map
// straight onto callLLM; embed() is not offered by these providers in this app,
// so it throws (only local-ollama embeds, for later TL chunks).
//
// Imports ../claude.ts (the Anthropic SDK), so it is NOT import-free — the
// provider-contract tests exercise the local-ollama provider, which is.

import { callLLM, type Provider } from "../claude.ts";
import {
  LLMProviderError,
  type LLMConfig,
  type LLMGenerateJSONOptions,
  type LLMGenerateOptions,
  type LLMProvider,
  type ProviderId,
} from "./types.ts";

export type RemoteProviderOptions = LLMConfig & {
  provider: Provider; // "anthropic" | "openrouter" | "gemini"
  // The user's own decrypted key (OpenRouter / Gemini); never logged.
  apiKeyOverride?: string;
};

export class RemoteProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  private readonly provider: Provider;
  private readonly apiKeyOverride?: string;
  private readonly maxTokens?: number;
  private readonly timeoutMs?: number;

  constructor(opts: RemoteProviderOptions) {
    this.provider = opts.provider;
    this.id = opts.provider;
    this.model = opts.model;
    this.apiKeyOverride = opts.apiKeyOverride;
    this.maxTokens = opts.maxTokens;
    this.timeoutMs = opts.timeoutMs;
  }

  async generate(opts: LLMGenerateOptions): Promise<string> {
    const text = await callLLM({
      provider: this.provider,
      apiKeyOverride: this.apiKeyOverride,
      system: opts.system,
      userInput: opts.prompt,
      model: this.model || undefined,
      maxTokens: opts.maxTokens ?? this.maxTokens,
      timeoutMs: opts.timeoutMs ?? this.timeoutMs,
    });
    return typeof text === "string" ? text : String(text ?? "");
  }

  // The cloud adapter asks for json mode; it does not constrain to the schema at
  // decode time (only local-ollama does), so the caller still validates the shape.
  async generateJSON<T = unknown>(opts: LLMGenerateJSONOptions): Promise<T> {
    const value = await callLLM({
      provider: this.provider,
      apiKeyOverride: this.apiKeyOverride,
      system: opts.system,
      userInput: opts.prompt,
      model: this.model || undefined,
      maxTokens: opts.maxTokens ?? this.maxTokens,
      timeoutMs: opts.timeoutMs ?? this.timeoutMs,
      expectJson: true,
    });
    return value as T;
  }

  async embed(): Promise<number[]> {
    throw new LLMProviderError(
      this.id,
      `embed() is only available on the local-ollama provider (${this.id} is not wired for embeddings).`
    );
  }
}
