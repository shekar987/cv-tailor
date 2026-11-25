"""The dry-run runner, with the browser steps injected (no Playwright).

Checks the contract the worker relies on: an ``observed`` event carrying the
field list, a screenshot uploaded (or skipped with a note), the right terminal
status, and ``needs_human`` with the matching event on a wall.
"""

from __future__ import annotations

from typing import Any, Optional

from jobhuntz_agent.artifacts import ArtifactUploadError, NullUploader
from jobhuntz_agent.browser.observer import build_observation
from jobhuntz_agent.runner import ObserverRunner, RunContext

from conftest import make_job, make_settings
from test_observer import greenhouse_raw, raw_el


# ── fakes ──────────────────────────────────────────────────────────────────--
class FakeReportClient:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def log_event(self, job_id, level, step, message, data=None):
        self.events.append({"job_id": job_id, "level": level, "step": step, "message": message, "data": data})
        return "evt"

    def steps(self) -> list[str]:
        return [e["step"] for e in self.events]


class _Log:
    def info(self, *a, **k): ...
    def warning(self, *a, **k): ...
    def error(self, *a, **k): ...
    def debug(self, *a, **k): ...


class FakeSession:
    def __init__(self) -> None:
        self.started = False
        self.closed = False
        self.pauses = 0

    def start(self):
        self.started = True
        return self

    def new_page(self):
        return object()  # the page is never touched directly — the seams are

    def pause(self):
        self.pauses += 1

    def close(self):
        self.closed = True


class FakeUploader:
    def __init__(self, path: Optional[str] = "u/j/page.png", raises: Exception | None = None) -> None:
        self.path = path
        self.raises = raises
        self.calls: list[dict[str, Any]] = []

    def upload_screenshot(self, *, user_id, job_id, filename, data, content_type):
        self.calls.append({"user_id": user_id, "job_id": job_id, "filename": filename, "bytes": len(data)})
        if self.raises:
            raise self.raises
        return self.path


def _ctx(client, *, effective_mode="dry_run"):
    return RunContext(client=client, log=_Log(), settings=make_settings(), effective_mode=effective_mode)


def _runner(observation, *, uploader=None, clicked=False, session=None):
    return ObserverRunner(
        uploader=uploader or FakeUploader(),
        session_factory=lambda _s: session or FakeSession(),
        open_url=lambda _p, _u, _t: None,
        click_apply=lambda _p, _u: clicked,
        observe=lambda _p: observation,
        screenshot=lambda _p: b"\x89PNG-bytes",
    )


# ── tests ─────────────────────────────────────────────────────────────────--
def test_dry_run_writes_observed_and_screenshot_and_returns_dry_run_done():
    obs = build_observation(greenhouse_raw())
    client = FakeReportClient()
    uploader = FakeUploader()
    runner = _runner(obs, uploader=uploader)

    result = runner.run(make_job(), _ctx(client))

    assert result.status == "dry_run_done"
    assert result.data == {"screenshot_path": "u/j/page.png"}
    assert client.steps() == ["observed", "screenshot_saved"]
    # The observed event carries the numbered field list.
    observed = next(e for e in client.events if e["step"] == "observed")
    assert observed["data"]["field_count"] == len(obs.elements)
    assert observed["data"]["elements"][0]["label"] == "First name *"
    # The screenshot was uploaded to the job's folder.
    assert uploader.calls == [
        {"user_id": "user-1", "job_id": "job-1", "filename": "page.png", "bytes": len(b"\x89PNG-bytes")}
    ]


def test_apply_button_click_is_logged():
    obs = build_observation(greenhouse_raw())
    client = FakeReportClient()
    runner = _runner(obs, clicked=True)
    runner.run(make_job(), _ctx(client))
    assert "apply_clicked" in client.steps()


def test_login_wall_returns_needs_human():
    raw = {
        "url": "https://acme.example/login",
        "title": "Sign in",
        "elements": [raw_el(id="login_password", type="password", label_for="Password")],
        "headings": ["Sign in to continue"],
        "password_fields": 1,
        "iframes": [],
        "scripts": [],
        "captcha": False,
    }
    obs = build_observation(raw)
    client = FakeReportClient()
    result = _runner(obs).run(make_job(), _ctx(client))

    assert result.status == "needs_human"
    assert "login_wall" in client.steps()
    assert "observed" in client.steps()


def test_captcha_returns_needs_human():
    raw = {
        "url": "https://acme.example/apply",
        "title": "Verify",
        "elements": [raw_el(id="full_name", label_for="Full name")],
        "headings": [],
        "password_fields": 0,
        "iframes": ["https://www.google.com/recaptcha/api2/anchor"],
        "scripts": [],
        "captcha": True,
    }
    obs = build_observation(raw)
    client = FakeReportClient()
    result = _runner(obs).run(make_job(), _ctx(client))

    assert result.status == "needs_human"
    assert "captcha" in client.steps()


def test_null_uploader_skips_the_screenshot_but_still_completes():
    obs = build_observation(greenhouse_raw())
    client = FakeReportClient()
    result = _runner(obs, uploader=NullUploader()).run(make_job(), _ctx(client))

    assert result.status == "dry_run_done"
    assert result.data is None  # no screenshot path recorded
    assert "screenshot_skipped" in client.steps()


def test_upload_failure_is_not_fatal():
    obs = build_observation(greenhouse_raw())
    client = FakeReportClient()
    uploader = FakeUploader(raises=ArtifactUploadError("signer down"))
    result = _runner(obs, uploader=uploader).run(make_job(), _ctx(client))

    assert result.status == "dry_run_done"
    assert result.data is None
    skipped = next(e for e in client.events if e["step"] == "screenshot_skipped")
    assert "signer down" in (skipped["message"] or "")


def test_submit_mode_logs_a_no_op_note():
    obs = build_observation(greenhouse_raw())
    client = FakeReportClient()
    _runner(obs).run(make_job(mode="submit"), _ctx(client, effective_mode="submit"))
    assert "submit_noop" in client.steps()


def test_session_is_always_closed():
    obs = build_observation(greenhouse_raw())
    session = FakeSession()
    _runner(obs, session=session).run(make_job(), _ctx(FakeReportClient()))
    assert session.started is True
    assert session.closed is True
