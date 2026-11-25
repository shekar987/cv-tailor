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
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

import structlog

from .adapters import greenhouse
from .artifacts import ArtifactUploader, ArtifactUploadError, NullUploader
from .browser.observer import PageObservation, observe_page
from .browser.session import BrowserSession, open_and_settle
from .config import Settings
from .fields.profile_bank import ProfileBank
from .models import Job

# A button/link whose visible text starts like this is treated as "Apply".
APPLY_TEXT_RE = re.compile(r"^\s*(apply|apply now|apply for|apply to|start application)\b", re.IGNORECASE)

# Seam type: given a job, return the user's ProfileBank (or None if unavailable).
LoadBank = Callable[["Job"], Optional[ProfileBank]]


def _null_load_bank(job: "Job") -> None:  # type: ignore[return]
    """Default: no bank available — the runner observes only."""
    return None


def _resolve_cv_path(settings: Settings) -> Optional[Path]:
    """Return the first CV file in ``settings.cv_dir``, or None."""
    if not settings.cv_dir:
        return None
    cv_dir = Path(settings.cv_dir)
    if not cv_dir.is_dir():
        return None
    for pattern in ("*.pdf", "*.PDF", "*.docx", "*.DOCX"):
        matches = sorted(cv_dir.glob(pattern))
        if matches:
            return matches[0]
    return None


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
    """Opens a job URL, observes it, and fills it when a Greenhouse form is
    detected and a ``ProfileBank`` is available.  The default ``JobRunner``."""

    uploader: ArtifactUploader = field(default_factory=NullUploader)
    session_factory: SessionFactory = _default_session
    open_url: OpenUrl = _default_open
    click_apply: ClickApply = _default_click_apply
    observe: Observe = observe_page
    screenshot: Screenshot = _default_screenshot
    # Chunk 37: injectable seam so tests can supply a real bank without I/O.
    # Default returns None → runner observes only (no filling).
    load_bank: LoadBank = field(default=_null_load_bank)

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

            # Wall (login / CAPTCHA): screenshot the wall and return early.
            if observation.has_wall:
                screenshot_path = self._save_screenshot(job, ctx, page)
                step = "login_wall" if observation.login_wall else "captcha"
                reason = observation.wall_reason or "A human needs to take over this page."
                ctx.client.log_event(job.id, "warn", step, reason)
                ctx.log.warning(step, job_id=job.id)
                return RunResult(
                    status="needs_human",
                    data=_status_data(screenshot_path),
                    message=reason,
                )

            # Greenhouse form-filling (Chunk 37).
            bank = self.load_bank(job)
            if bank is not None and greenhouse.detect(job.job_url, observation):
                cv_path = _resolve_cv_path(ctx.settings)
                fill_result = greenhouse.fill(
                    page, observation, bank,
                    cv_path=cv_path,
                    pause=0.0,  # caller sets polite pacing; tests want 0
                )
                ctx.client.log_event(
                    job.id, "info", "form_filled",
                    fill_result.summary(),
                    data={
                        "filled": fill_result.filled,
                        "needs_you": fill_result.needs_you,
                        "unknown": fill_result.unknown,
                        "cv_uploaded": fill_result.cv_uploaded,
                        "letter_uploaded": fill_result.letter_uploaded,
                        "errors": fill_result.errors,
                    },
                )
                screenshot_path = self._save_screenshot(job, ctx, page)
                status_data: dict = {}
                if screenshot_path:
                    status_data["screenshot_path"] = screenshot_path
                status_data["fill_summary"] = fill_result.summary()
                return RunResult(
                    status="dry_run_done",
                    data=status_data or None,
                    message=fill_result.summary(),
                )

            # Not Greenhouse (or no bank): read-only observe path.
            if ctx.effective_mode == "submit":
                ctx.client.log_event(
                    job.id,
                    "info",
                    "submit_noop",
                    "Submit mode: this version only reads the form — it does not fill in or submit anything yet.",
                )

            screenshot_path = self._save_screenshot(job, ctx, page)
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
