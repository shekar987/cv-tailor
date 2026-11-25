"""End-to-end runner test: a real browser against a local static server, with a
mocked Supabase client and a fake uploader.

Serves the HTML fixtures over http://127.0.0.1, drives the real
``ObserverRunner`` (real ``BrowserSession`` + observer + screenshot) and checks
that the artifact was uploaded and the timeline events were written. Skipped
where Playwright / Chromium is not installed.
"""

from __future__ import annotations

import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("playwright.sync_api")

from jobhuntz_agent.runner import ObserverRunner, RunContext  # noqa: E402

from conftest import make_job, make_settings  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


class _Log:
    def info(self, *a, **k): ...
    def warning(self, *a, **k): ...
    def error(self, *a, **k): ...
    def debug(self, *a, **k): ...


class RecordingClient:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def log_event(self, job_id, level, step, message, data=None):
        self.events.append({"step": step, "data": data})
        return "evt"

    def steps(self):
        return [e["step"] for e in self.events]


class RecordingUploader:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def upload_screenshot(self, *, user_id, job_id, filename, data, content_type):
        self.calls.append(len(data))
        return f"{user_id}/{job_id}/{filename}"


@pytest.fixture(scope="module")
def server():
    handler = partial(SimpleHTTPRequestHandler, directory=str(FIXTURES))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address
    yield f"http://{host}:{port}"
    httpd.shutdown()


@pytest.fixture()
def settings(tmp_path):
    return make_settings(
        browser_headless=True,
        browser_profile_dir=str(tmp_path / "profile"),
        action_delay_min_ms=0,
        action_delay_max_ms=0,
        nav_timeout_ms=20_000,
    )


def _run(server, settings, uploader, client, page_name="greenhouse_form.html", mode="dry_run"):
    runner = ObserverRunner(uploader=uploader)
    job = make_job(job_url=f"{server}/{page_name}")
    ctx = RunContext(client=client, log=_Log(), settings=settings, effective_mode=mode)
    try:
        return runner.run(job, ctx)
    except RuntimeError as exc:  # Playwright present but no browser binary
        if "not installed" in str(exc).lower() or "executable" in str(exc).lower():
            pytest.skip(f"Chromium not available: {exc}")
        raise


def test_full_dry_run_uploads_and_reports(server, settings):
    client = RecordingClient()
    uploader = RecordingUploader()
    result = _run(server, settings, uploader, client)

    assert result.status == "dry_run_done"
    assert result.data and result.data["screenshot_path"].endswith("/page.png")
    # The artifact was uploaded with real PNG bytes.
    assert uploader.calls and uploader.calls[0] > 100
    # Events were written, including the field list.
    assert "observed" in client.steps()
    assert "screenshot_saved" in client.steps()
    observed = next(e for e in client.events if e["step"] == "observed")
    assert observed["data"]["field_count"] >= 6


def test_full_run_flags_a_login_wall(server, settings):
    client = RecordingClient()
    result = _run(server, settings, RecordingUploader(), client, page_name="login_wall.html")
    assert result.status == "needs_human"
    assert "login_wall" in client.steps()
