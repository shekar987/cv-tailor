// Provider-contract tests for the local-ollama provider (Chunk TL-1), against a
// mocked Ollama HTTP server. Covers generate / generateJSON(schema) / embed,
// JSON-schema pass-through, and the error cases. node:test, no dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOllamaProvider, OllamaProvider } from "../src/lib/llm/ollama.ts";
import { LLMProviderError } from "../src/lib/llm/types.ts";

// A tiny mock Ollama. `handler(path, body)` returns { status?, json } per request.
type MockHandler = (path: string, body: Record<string, unknown>) => { status?: number; json: unknown } | { status: number; text: string };
function startMock(handler: MockHandler): Promise<{ host: string; close: () => Promise<void>; lastBody: () => Record<string, unknown> }> {
  let last: Record<string, unknown> = {};
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      last = body;
      const out = handler(req.url || "", body);
      if ("text" in out) {
        res.writeHead(out.status, { "content-type": "text/plain" });
        res.end(out.text);
        return;
      }
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        host: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
        lastBody: () => last,
      });
    });
  });
}

test("generate(): returns the model's trimmed chat content", async () => {
  const mock = await startMock((path) => {
    assert.equal(path, "/api/chat");
    return { json: { message: { content: "  A tailored summary.\n" } } };
  });
  const p = createOllamaProvider({ model: "qwen2.5:7b-instruct", host: mock.host });
  const out = await p.generate({ system: "sys", prompt: "hi" });
  assert.equal(out, "A tailored summary.");
  // The request carried model, messages and the num_predict/temperature options.
  const body = mock.lastBody();
  assert.equal(body.model, "qwen2.5:7b-instruct");
  assert.equal(body.stream, false);
  assert.ok(Array.isArray(body.messages));
  assert.ok((body.options as Record<string, unknown>).num_predict);
  await mock.close();
});

test("generateJSON(schema): sends `format` = schema and parses the JSON content", async () => {
  const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
  const mock = await startMock(() => ({ json: { message: { content: JSON.stringify({ summary: "Tailored." }) } } }));
  const p = createOllamaProvider({ model: "m", host: mock.host });
  const out = await p.generateJSON<{ summary: string }>({ system: "s", prompt: "p", schema });
  assert.deepEqual(out, { summary: "Tailored." });
  assert.deepEqual(mock.lastBody().format, schema, "the JSON schema is passed to Ollama's format");
  await mock.close();
});

test("generateJSON(): invalid JSON from the model throws LLMProviderError", async () => {
  const mock = await startMock(() => ({ json: { message: { content: "not json at all" } } }));
  const p = createOllamaProvider({ model: "m", host: mock.host });
  await assert.rejects(
    () => p.generateJSON({ system: "s", prompt: "p", schema: { type: "object" } }),
    (e) => e instanceof LLMProviderError
  );
  await mock.close();
});

test("embed(): returns the embedding vector from a dedicated embed model", async () => {
  const mock = await startMock((path, body) => {
    assert.equal(path, "/api/embeddings");
    assert.equal(body.model, "nomic-embed-text");
    return { json: { embedding: [0.1, 0.2, 0.3] } };
  });
  const p = createOllamaProvider({ model: "m", embedModel: "nomic-embed-text", host: mock.host });
  assert.deepEqual(await p.embed("hello"), [0.1, 0.2, 0.3]);
  await mock.close();
});

test("embed(): a non-embedding model (no vector) throws LLMProviderError", async () => {
  const mock = await startMock(() => ({ json: { message: "no embedding here" } }));
  const p = createOllamaProvider({ model: "m", host: mock.host });
  await assert.rejects(() => p.embed("x"), (e) => e instanceof LLMProviderError);
  await mock.close();
});

test("an HTTP error from Ollama throws LLMProviderError with the status", async () => {
  const mock = await startMock(() => ({ status: 500, text: "boom" }));
  const p = createOllamaProvider({ model: "m", host: mock.host });
  await assert.rejects(
    () => p.generate({ system: "s", prompt: "p" }),
    (e) => e instanceof LLMProviderError && /500/.test((e as Error).message)
  );
  await mock.close();
});

test("an unreachable host throws LLMProviderError (Ollama not running)", async () => {
  // Port 1 is never a live Ollama; the connection is refused.
  const p = new OllamaProvider({ model: "m", host: "http://127.0.0.1:1", timeoutMs: 2000 });
  await assert.rejects(
    () => p.generate({ system: "s", prompt: "p" }),
    (e) => e instanceof LLMProviderError && /Ollama/.test((e as Error).message)
  );
});

test("no model name is a configuration error", () => {
  assert.throws(() => new OllamaProvider({ model: "" }), (e) => e instanceof LLMProviderError);
});
