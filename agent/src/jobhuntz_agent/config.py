"""Worker configuration, read from the environment / a local ``.env`` file.

Everything the worker needs to reach Supabase and behave safely lives here.
The only credentials are the publishable (anon) key and the device token — the
service-role key is never read, never accepted.
"""

from __future__ import annotations

import socket
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The hard ceiling the empty-queue / network backoff climbs to.
MAX_BACKOFF_SECONDS = 60
# How often the background heartbeat tells the server a claimed job is alive.
HEARTBEAT_SECONDS = 20
# The placeholder "work" this chunk does in place of a browser.
PLACEHOLDER_SECONDS = 3

ModeOverride = Literal["dry_run", "off"]


class Settings(BaseSettings):
    """Validated worker settings.

    A missing or empty ``DEVICE_TOKEN`` / ``SUPABASE_URL`` / ``SUPABASE_ANON_KEY``
    is a hard error with a message that says what to do, so the worker never
    starts half-configured.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    supabase_url: str = Field(default="")
    supabase_anon_key: str = Field(default="")
    device_token: str = Field(default="")
    poll_seconds: int = Field(default=10, ge=1, le=3600)
    mode_override: ModeOverride = Field(default="dry_run")
    device_name: str = Field(default="")

    # Not read from the environment — derived constants, overridable in tests.
    heartbeat_seconds: int = Field(default=HEARTBEAT_SECONDS, ge=1)
    placeholder_seconds: float = Field(default=PLACEHOLDER_SECONDS, ge=0)
    max_backoff_seconds: int = Field(default=MAX_BACKOFF_SECONDS, ge=1)

    @field_validator("supabase_url", "supabase_anon_key", "device_token", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

    @field_validator("device_name", mode="before")
    @classmethod
    def _name(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

    @field_validator("supabase_url")
    @classmethod
    def _url_set(cls, v: str) -> str:
        if not v:
            raise ValueError("SUPABASE_URL is not set — copy agent/.env.example to agent/.env and fill it in.")
        if "service_role" in v or "secret" in v:
            raise ValueError("SUPABASE_URL looks wrong — it must be the project URL, not a key.")
        return v.rstrip("/")

    @field_validator("supabase_anon_key")
    @classmethod
    def _anon_set(cls, v: str) -> str:
        if not v:
            raise ValueError("SUPABASE_ANON_KEY is not set — paste the project's publishable (anon) key into agent/.env.")
        if v.startswith("sb_secret") or "service_role" in v:
            raise ValueError("That is a secret/service-role key. The worker must use the publishable (anon) key only.")
        return v

    @field_validator("device_token")
    @classmethod
    def _token_set(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "DEVICE_TOKEN is empty — open /agent, click 'Connect a device', and paste its token into agent/.env."
            )
        return v

    @property
    def resolved_device_name(self) -> str:
        """The name to show for this machine — the configured one, else the hostname."""
        if self.device_name:
            return self.device_name
        try:
            return socket.gethostname() or "this PC"
        except Exception:  # pragma: no cover - hostname lookup never really fails
            return "this PC"

    @property
    def forces_dry_run(self) -> bool:
        return self.mode_override == "dry_run"


def load_settings() -> Settings:
    """Load settings, raising ``pydantic.ValidationError`` with clear messages."""
    return Settings()
