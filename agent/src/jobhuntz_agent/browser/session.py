"""A persistent-profile Chromium session for the worker (Chunk 35).

One Chromium context per worker, launched with ``launch_persistent_context`` in
a profile directory on the user's own disk — so the user signs in to the ATS
sites **once** and those logins survive between runs. Headed by default (the
user can watch it work and sign in when asked); headless is optional.

Guardrail 2: **no stealth plugins and no user-agent spoofing.** The browser is
its honest self — we do not pretend to be someone else to slip past a site.

Playwright is imported lazily so the rest of the worker (and its tests) run
without it installed; a clear error is raised only if a browser is actually
needed and Playwright is missing.
"""

from __future__ import annotations

import random
import time
from pathlib import Path
from typing import Any, Optional

from ..config import Settings

PLAYWRIGHT_MISSING = (
    "Playwright is not installed. Install the worker's browser support with "
    "`uv sync` and `uv run playwright install chromium`, then try again."
)


def _import_playwright() -> Any:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:  # pragma: no cover - exercised only without playwright
        raise RuntimeError(PLAYWRIGHT_MISSING) from exc
    return sync_playwright


class BrowserSession:
    """Owns the Playwright driver and one persistent Chromium context.

    Use as a context manager::

        with BrowserSession(settings) as session:
            page = session.new_page()
            page.goto(url)
            session.pause()        # a polite, human-ish delay
    """

    def __init__(self, settings: Settings, *, sleep: Any = time.sleep) -> None:
        self._settings = settings
        self._sleep = sleep
        self._pw: Any = None
        self._playwright: Any = None
        self._context: Any = None
        self._rng = random.Random()

    # ── lifecycle ──────────────────────────────────────────────────────────--
    def start(self) -> "BrowserSession":
        sync_playwright = _import_playwright()
        profile_dir = Path(self._settings.browser_profile_dir)
        profile_dir.mkdir(parents=True, exist_ok=True)

        self._pw = sync_playwright()
        self._playwright = self._pw.start()

        launch: dict[str, Any] = {
            "user_data_dir": str(profile_dir),
            "headless": self._settings.browser_headless,
            # No --disable-blink-features=AutomationControlled, no custom UA:
            # guardrail 2 says we do not disguise the browser.
            "args": ["--no-first-run", "--no-default-browser-check"],
        }
        channel = self._settings.browser_channel.strip()
        executable = self._settings.browser_executable_path.strip()
        if executable:
            launch["executable_path"] = executable
        elif channel:
            launch["channel"] = channel

        self._context = self._playwright.chromium.launch_persistent_context(**launch)
        self._context.set_default_navigation_timeout(self._settings.nav_timeout_ms)
        self._context.set_default_timeout(self._settings.nav_timeout_ms)
        return self

    def close(self) -> None:
        for closer in (
            lambda: self._context and self._context.close(),
            lambda: self._playwright and self._playwright.stop(),
        ):
            try:
                closer()
            except Exception:
                pass
        self._context = None
        self._playwright = None
        self._pw = None

    def __enter__(self) -> "BrowserSession":
        return self.start()

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ── pages & pacing ─────────────────────────────────────────────────────--
    @property
    def context(self) -> Any:
        if self._context is None:
            raise RuntimeError("BrowserSession is not started — call start() or use `with`.")
        return self._context

    def new_page(self) -> Any:
        # Reuse the context's first page if Chromium opened one (persistent
        # contexts start with a blank tab), else open a fresh one.
        pages = self.context.pages
        return pages[0] if pages else self.context.new_page()

    def pause(self) -> None:
        """Wait a polite, randomised moment between actions (configurable)."""
        lo, hi = self._settings.action_delay_range_ms
        if hi <= 0:
            return
        self._sleep(self._rng.uniform(lo, hi) / 1000.0)


def open_and_settle(page: Any, url: str, *, timeout_ms: Optional[int] = None) -> None:
    """Navigate to ``url`` and wait for the network to go idle, tolerating a slow
    page: a networkidle timeout is not fatal (many job pages keep a socket open),
    we just proceed to observe what loaded."""
    page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
        pass
