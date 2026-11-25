// The provider factory (Chunk TL-1). One place to turn a provider id + config
// into an LLMProvider. The website uses the cloud providers through this; the
// PC worker and the benchmark use the local-ollama one.

import { createOllamaProvider, DEFAULT_OLLAMA_HOST, type OllamaProviderOptions } from "./ollama.ts";
import { RemoteProvider } from "./remote.ts";
import { type LLMConfig, type LLMProvider, type ProviderId } from "./types.ts";
import { type Provider } from "../claude.ts";

export { DEFAULT_OLLAMA_HOST } from "./ollama.ts";
export { LLMProviderError } from "./types.ts";
export type {
  JsonSchema,
  LLMConfig,
  LLMGenerateOptions,
  LLMGenerateJSONOptions,
  LLMProvider,
  ProviderId,
} from "./types.ts";
export { createOllamaProvider, OllamaProvider } from "./ollama.ts";
export { RemoteProvider } from "./remote.ts";

// The default local model Jobhuntz recommends after the TL-1 benchmark. The
// worker and the benchmark read OLLAMA_MODEL to override; keep this in step with
// agent/bench/results-2026-11-19.md.
export const DEFAULT_LOCAL_MODEL = "qwen2.5:7b-instruct-q4_K_M";
export const DEFAULT_LOCAL_TEMPERATURE = 0.2;

export type GetProviderOptions = LLMConfig & {
  apiKeyOverride?: string; // cloud own-key
  host?: string; // local-ollama host
};

export function getProvider(id: ProviderId, opts: GetProviderOptions): LLMProvider {
  if (id === "local-ollama") {
    const o: OllamaProviderOptions = {
      model: opts.model || DEFAULT_LOCAL_MODEL,
      embedModel: opts.embedModel,
      temperature: opts.temperature ?? DEFAULT_LOCAL_TEMPERATURE,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      host: opts.host || DEFAULT_OLLAMA_HOST,
    };
    return createOllamaProvider(o);
  }
  return new RemoteProvider({
    provider: id as Provider,
    model: opts.model,
    apiKeyOverride: opts.apiKeyOverride,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
  });
}
