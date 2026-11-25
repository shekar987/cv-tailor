"""The dry-run job runner (Chunk 35): open the page, observe it, save a
screenshot, report back. This is what replaces Chunk 34's 3-second placeholder.

It is **read-only**. It may click one obvious, same-domain "Apply" button to
reveal an embedded form, but it never types into a field and never submits —
even for a submit-mode job (real form-filling and submission arrive later).

The browser steps are injected as small callables so the loop is testable
without Playwright: the worker integration test passes fakes; the real worker
uses the Playwright-backed defaults.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol

import structlog

from .artifacts import ArtifactUploader, ArtifactUploadError, NullUploader
from .browser.observer import PageObservation, observe_page
from .browser.session import BrowserSession, open_and_settle
from .config import Settings
from .models import Job

# A button/link whose visible text starts like this is treated as "Apply".
APPLY_TEXT_RE = re.compile(r"^\s*(apply|apply now|apply for|apply to|start application)\b", re.IGNORECASE)


class ReportClient(Protocol):
    def log_event(
        self, job_id: str, level: str, step: Optional[str], message: Optional[str], data: Optional[dict] = None
    ) -> Optional[str]: ...


@dataclass
class RunContext:
    client: ReportClient
    log: Any
    settings: Settings
    effective_mode: str


@dataclass
class RunResult:
    status: str
    data: Optional[dict] = None
    message: str = ""


class JobRunner(Protocol):
    def run(self, job: Job, ctx: RunContext) -> RunResult: ...


# ── the browser seams (real defaults; fakes in tests) ─────────────────────────
SessionFactory = Callable[[Settings], Any]
OpenUrl = Callable[[Any, str, int], None]
ClickApply = Callable[[Any, str], bool]
Observe = Callable[[Any], PageObservation]
Screenshot = Callable[[Any], bytes]


def _default_session(settings: Settings) -> BrowserSession:
    return BrowserSession(settings)


def _default_open(page: Any, url: str, timeout_ms: int) -> None:
    open_and_settle(page, url, timeout_ms=timeout_ms)


def _same_host(href: str, base: str) -> bool:
    from urllib.parse import urljoin, urlparse

    if not href or href.startswith("#"):
        return True  # in-page, safe
    if href.startswith("javascript:") or href.startswith("mailto:"):
        return False
    try:
        resolved = urljoin(base, href)
        return urlparse(resolved).netloc.lower() == urlparse(base).netloc.lower()
    except Exception:
        return False


def _default_click_apply(page: Any, url: str) -> bool:
    """Click one visible, same-domain 'Apply' control to reveal the form. Best
    effort and never fatal; returns whether something was clicked."""
    try:
        candidates = page.query_selector_all("a, button, input[type=submit], input[type=button]")
    except Exception:
        return False
    for el in candidates or []:
        try:
            if not el.is_visible():
                continue
            text = (el.inner_text() if el.evaluate("e => e.tagName") != "INPUT" else el.get_attribute("value")) or ""
            if not APPLY_TEXT_RE.search(text):
                continue
            tag = (el.evaluate("e => e.tagName") or "").upper()
            if tag == "A" and not _same_host(el.get_attribute("href") or "", url):
                continue
            el.click(timeout=5000)
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            return True
        except Exception:
            continue
    return False


def _default_screenshot(page: Any) -> bytes:
    return page.screenshot(full_page=True)


@dataclass
class ObserverRunner:
    """Opens a job URL and observes it. The default `JobRunner` for the worker."""

    uploader: ArtifactUploader = field(default_factory=NullUploader)
    session_factory: SessionFactory = _default_session
    open_url: OpenUrl = _default_open
    click_apply: ClickApply = _default_click_apply
    observe: Observe = observe_page
    screenshot: Screenshot = _default_screenshot

    def run(self, job: Job, ctx: RunContext) -> RunResult:
        session = self.session_factory(ctx.settings)
        try:
            session.start() if hasattr(session, "start") else None
            page = session.new_page()
            if hasattr(session, "pause"):
                session.pause()

            self.open_url(page, job.job_url, ctx.settings.nav_timeout_ms)
            if hasattr(session, "pause"):
                session.pause()

            if self.click_apply(page, job.job_url):
                ctx.client.log_event(job.id, "info", "apply_clicked", "Opened the application form.")
                if hasattr(session, "pause"):
                    session.pause()

            observation = self.observe(page)
            ctx.client.log_event(
                job.id,
                "info",
                "observed",
                _observed_message(observation),
                data=observation.to_event_payload(),
            )

            screenshot_path = self._save_screenshot(job, ctx, page)

            if observation.has_wall:
                step = "login_wall" if observation.login_wall else "captcha"
                reason = observation.wall_reason or "A human needs to take over this page."
                ctx.client.log_event(job.id, "warn", step, reason)
                ctx.log.warning(step, job_id=job.id)
                return RunResult(
                    status="needs_human",
                    data=_status_data(screenshot_path),
                    message=reason,
                )

            if ctx.effective_mode == "submit":
                ctx.client.log_event(
                    job.id,
                    "info",
                    "submit_noop",
                    "Submit mode: this version only reads the form — it does not fill in or submit anything yet.",
                )

            return RunResult(
                status="dry_run_done",
                data=_status_data(screenshot_path),
                message=f"Dry run: read {len(observation.elements)} fields. Nothing was typed or submitted.",
            )
        finally:
            try:
                session.close()
            except Exception:
                pass

    def _save_screenshot(self, job: Job, ctx: RunContext, page: Any) -> Optional[str]:
        try:
            png = self.screenshot(page)
        except Exception as exc:
            ctx.client.log_event(job.id, "warn", "screenshot_skipped", f"Could not take a screenshot: {exc}")
            return None
        user_id = job.user_id or "unknown"
        try:
            path = self.uploader.upload_screenshot(
                user_id=user_id,
                job_id=job.id,
                filename="page.png",
                data=png,
                content_type="image/png",
            )
        except ArtifactUploadError as exc:
            ctx.client.log_event(job.id, "warn", "screenshot_skipped", str(exc))
            return None
        if path:
            ctx.client.log_event(job.id, "info", "screenshot_saved", "Saved a screenshot of the page.")
        else:
            ctx.client.log_event(
                job.id,
                "info",
                "screenshot_skipped",
                "Screenshot upload is not set up on this device — the field list above is still recorded.",
            )
        return path


def _observed_message(obs: PageObservation) -> str:
    n = len(obs.elements)
    if n == 0:
        return "Read the page but found no form fields."
    return f"Read the application form: {n} fields."


def _status_data(screenshot_path: Optional[str]) -> Optional[dict]:
    return {"screenshot_path": screenshot_path} if screenshot_path else None
