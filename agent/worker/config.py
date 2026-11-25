"""Configuration for the Jobhuntz local worker (Chunk TL-1).

Everything comes from environment variables so no secret is ever hard-coded.
The worker holds NO Supabase session: its only credential is the one-time
device token the website showed once (created on the Auto-apply page). It talks
to Supabase through the SECURITY DEFINER RPCs that validate that token, and to
Ollama on localhost.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


# The default local model Jobhuntz recommends after the TL-1 benchmark. Keep in
# step with agent/bench/results-2026-11-19.md and src/lib/llm/index.ts.
DEFAULT_MODEL = "qwen2.5:7b-instruct-q4_K_M"
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_key: str  # the publishable (anon) key — safe to ship with the worker
    device_token: str
    ollama_host: str
    model: str
    temperature: float
    poll_seconds: float

    @staticmethod
    def from_env() -> "Config":
        url = os.environ.get("JOBHUNTZ_SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("JOBHUNTZ_SUPABASE_KEY", "")
        token = os.environ.get("JOBHUNTZ_DEVICE_TOKEN", "")
        missing = [
            name
            for name, val in (
                ("JOBHUNTZ_SUPABASE_URL", url),
                ("JOBHUNTZ_SUPABASE_KEY", key),
                ("JOBHUNTZ_DEVICE_TOKEN", token),
            )
            if not val
        ]
        if missing:
            raise SystemExit(
                "Missing environment variables: "
                + ", ".join(missing)
                + ".\nSet them (see agent/README.md) and try again."
            )
        return Config(
            supabase_url=url,
            supabase_key=key,
            device_token=token,
            ollama_host=os.environ.get("OLLAMA_HOST", DEFAULT_OLLAMA_HOST).rstrip("/"),
            model=os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL),
            temperature=float(os.environ.get("OLLAMA_TEMPERATURE", "0.2")),
            poll_seconds=float(os.environ.get("JOBHUNTZ_POLL_SECONDS", "4")),
        )
