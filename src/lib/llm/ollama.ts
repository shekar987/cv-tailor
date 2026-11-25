// The local-ollama provider: Jobhuntz's open-weight, £0-per-run model path.
//
// Talks to an Ollama server (default http://127.0.0.1:11434) over its HTTP API:
//   - generate()      → POST /api/chat          (system + user messages)
//   - generateJSON()  → POST /api/chat          with `format` = the JSON schema
//                       (Ollama constrains decoding to that schema)
//   - embed()         → POST /api/embeddings    (classic endpoint, { embedding })
//
// NOTE the website never imports this in a request path — only the PC worker
// and the benchmark do. It lives here so the TypeScript worker (and the
// provider-contract tests, which point it at a mocked HTTP server) share one
// implementation with the cloud providers' interface. The Python worker in
// agent/ mirrors this shape.
//
// import-free apart from ./types.ts (also import-free), so node:test can run it.

import {
  LLMProviderError,
  type JsonSchema,
  type LLMConfig,
  type LLMGenerateJSONOptions,
  type LLMGenerateOptions,
  type LLMProvider,
} from "./types.ts";

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 120_000; // a 7B model on a CPU laptop is slow — be patient.

type FetchImpl = typeof fetch;

export type OllamaProviderOptions = LLMConfig & {
  // Where Ollama is listening. Defaults to localhost; the benchmark and the
  // worker may override it, and the tests point it at a mock server.
  host?: string;
  // Injectable for tests; defaults to the global fetch.
  fetchImpl?: FetchImpl;
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export class OllamaProvider implements LLMProvider {
  readonly id = "local-ollama" as const;
  readonly model: string;
  private readonly embedModel: string;
  private readonly host: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: OllamaProviderOptions) {
    if (!opts.model) throw new LLMProviderError("local-ollama", "No model name configured");
    this.model = opts.model;
    this.embedModel = opts.embedModel || opts.model;
    this.host = trimTrailingSlash(opts.host || DEFAULT_OLLAMA_HOST);
    this.temperature = opts.temperature ?? 0.2;
    this.maxTokens = opts.maxTokens ?? 1024;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.host}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A refused connection is the common case: Ollama isn't running.
      throw new LLMProviderError(
        "local-ollama",
        `Could not reach Ollama at ${this.host} (${msg}). Is it running? Start it with "ollama serve".`
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMProviderError(
        "local-ollama",
        `Ollama returned ${res.status} for ${path}${text ? `: ${text.slice(0, 300)}` : ""}`
      );
    }
    return res.json().catch(() => {
      throw new LLMProviderError("local-ollama", `Ollama returned a non-JSON body for ${path}`);
    });
  }

  private chatBody(opts: LLMGenerateOptions, format?: JsonSchema) {
    return {
      model: this.model,
      stream: false,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      options: {
        temperature: opts.temperature ?? this.temperature,
        // Ollama's num_predict is the max output tokens.
        num_predict: opts.maxTokens ?? this.maxTokens,
      },
      ...(format ? { format } : {}),
    };
  }

  async generate(opts: LLMGenerateOptions): Promise<string> {
    const data = (await this.post("/api/chat", this.chatBody(opts), opts.timeoutMs ?? this.timeoutMs)) as {
      message?: { content?: unknown };
    };
    const content = typeof data.message?.content === "string" ? data.message.content : "";
    return content.trim();
  }

  async generateJSON<T = unknown>(opts: LLMGenerateJSONOptions): Promise<T> {
    const data = (await this.post(
      "/api/chat",
      this.chatBody(opts, opts.schema),
      opts.timeoutMs ?? this.timeoutMs
    )) as { message?: { content?: unknown } };
    const content = typeof data.message?.content === "string" ? data.message.content : "";
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new LLMProviderError(
        "local-ollama",
        `Model did not return valid JSON (${content.length} chars). The model may not support \`format\` mode.`
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    const data = (await this.post(
      "/api/embeddings",
      { model: this.embedModel, prompt: text },
      this.timeoutMs
    )) as { embedding?: unknown };
    const vec = data.embedding;
    if (!Array.isArray(vec) || !vec.every((n) => typeof n === "number")) {
      throw new LLMProviderError(
        "local-ollama",
        `Model "${this.embedModel}" did not return an embedding. Use an embedding model (e.g. nomic-embed-text).`
      );
    }
    return vec as number[];
  }
}

export function createOllamaProvider(opts: OllamaProviderOptions): OllamaProvider {
  return new OllamaProvider(opts);
}
