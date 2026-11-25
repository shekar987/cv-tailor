"""Worker configuration, read from the environment / a local ``.env`` file.

Everything the worker needs to reach Supabase and behave safely lives here.
The only credentials are the publishable (anon) key and the device token — the
service-role key is never read, never accepted.
"""

from __future__ import annotations

import os
import socket
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The hard ceiling the empty-queue / network backoff climbs to.
MAX_BACKOFF_SECONDS = 60
# How often the background heartbeat tells the server a claimed job is alive.
HEARTBEAT_SECONDS = 20
# The placeholder "work" the Chunk 34 skeleton did in place of a browser. Kept
# only for the no-browser fallback (when Playwright is not installed).
PLACEHOLDER_SECONDS = 3

# Browser defaults (Chunk 35). A polite, human-ish delay between page actions.
ACTION_DELAY_MIN_MS = 400
ACTION_DELAY_MAX_MS = 900
# How long to wait for a page to settle / an element to appear.
NAV_TIMEOUT_MS = 30_000

ModeOverride = Literal["dry_run", "off"]


def default_profile_dir() -> str:
    """Where the persistent browser profile lives, by default.

    ``%LOCALAPPDATA%\\Jobhuntz\\agent-profile`` on Windows, else
    ``~/.local/share/jobhuntz/agent-profile``. The user signs in once here and
    their logins survive between runs."""
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return str(Path(local) / "Jobhuntz" / "agent-profile")
    return str(Path.home() / ".local" / "share" / "jobhuntz" / "agent-profile")


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

    # ── browser (Chunk 35) ───────────────────────────────────────────────────
    # The persistent Chromium profile directory (sign in once; logins persist).
    browser_profile_dir: str = Field(default_factory=default_profile_dir)
    # Headed by default so the user can see it and sign in. Headless optional.
    browser_headless: bool = Field(default=False)
    # Use an installed browser channel ("chrome" / "msedge") instead of the
    # Playwright-bundled Chromium, or point at an explicit executable. Both
    # blank = Playwright's own Chromium.
    browser_channel: str = Field(default="")
    browser_executable_path: str = Field(default="")
    # The polite delay between page actions, in milliseconds (a random value in
    # this range). Set both to 0 to disable (tests do).
    action_delay_min_ms: int = Field(default=ACTION_DELAY_MIN_MS, ge=0)
    action_delay_max_ms: int = Field(default=ACTION_DELAY_MAX_MS, ge=0)
    nav_timeout_ms: int = Field(default=NAV_TIMEOUT_MS, ge=1000)
    # Where the worker posts artifacts (the Supabase Edge Function that mints a
    # signed upload URL — deployed by hand, see agent/README). Blank = the
    # worker still observes and records the field list, but skips the screenshot
    # upload with a note (the Fields drawer works regardless).
    artifact_sign_url: str = Field(default="")

    # ── CV file (Chunk 37) ───────────────────────────────────────────────────
    # Directory that holds the user's CV/résumé file(s). The runner picks the
    # first *.pdf or *.docx it finds here and uploads it to file-input fields.
    # Blank = no CV available; file-input fields are flagged "needs_you".
    cv_dir: str = Field(default="")

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

    @property
    def action_delay_range_ms(self) -> tuple[int, int]:
        """The (min, max) action delay, with min never above max."""
        lo = self.action_delay_min_ms
        hi = max(self.action_delay_max_ms, lo)
        return (lo, hi)

    @property
    def has_artifact_upload(self) -> bool:
        return bool(self.artifact_sign_url.strip())


def load_settings() -> Settings:
    """Load settings, raising ``pydantic.ValidationError`` with clear messages."""
    return Settings()
