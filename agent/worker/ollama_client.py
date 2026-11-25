"""A tiny Ollama HTTP client (Chunk TL-1), stdlib only.

Mirrors src/lib/llm/ollama.ts: /api/chat for generate / generateJSON (passing a
JSON schema in `format`), /api/embeddings for embed. Returns Ollama's timing
fields too, so the benchmark can read tokens/sec straight from the response.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class OllamaError(RuntimeError):
    pass


@dataclass
class ChatResult:
    content: str
    # Ollama timing (nanoseconds) and token counts, when present.
    eval_count: int = 0
    eval_duration_ns: int = 0
    total_duration_ns: int = 0
    load_duration_ns: int = 0

    @property
    def tokens_per_sec(self) -> float:
        if self.eval_count and self.eval_duration_ns:
            return self.eval_count / (self.eval_duration_ns / 1e9)
        return 0.0


class OllamaClient:
    def __init__(self, host: str = "http://127.0.0.1:11434", timeout: float = 300.0) -> None:
        self.host = host.rstrip("/")
        self.timeout = timeout

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.host}{path}", data=data, headers={"content-type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise OllamaError(
                f"Could not reach Ollama at {self.host} ({exc}). Is it running? Start it with 'ollama serve'."
            ) from exc

    def chat(
        self,
        model: str,
        system: str,
        user: str,
        *,
        temperature: float = 0.2,
        num_predict: int = 1024,
        fmt: dict[str, Any] | None = None,
    ) -> ChatResult:
        body: dict[str, Any] = {
            "model": model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "options": {"temperature": temperature, "num_predict": num_predict},
        }
        if fmt is not None:
            body["format"] = fmt
        data = self._post("/api/chat", body)
        content = ""
        msg = data.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            content = msg["content"]
        return ChatResult(
            content=content.strip(),
            eval_count=int(data.get("eval_count") or 0),
            eval_duration_ns=int(data.get("eval_duration") or 0),
            total_duration_ns=int(data.get("total_duration") or 0),
            load_duration_ns=int(data.get("load_duration") or 0),
        )

    def embed(self, model: str, text: str) -> list[float]:
        data = self._post("/api/embeddings", {"model": model, "prompt": text})
        vec = data.get("embedding")
        if not isinstance(vec, list):
            raise OllamaError(f"Model '{model}' returned no embedding — use an embedding model.")
        return [float(x) for x in vec]

    def running_models(self) -> list[dict[str, Any]]:
        """`ollama ps` over HTTP: the models currently loaded and their memory."""
        try:
            with urllib.request.urlopen(f"{self.host}/api/ps", timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return list(data.get("models") or [])
        except Exception:
            return []
