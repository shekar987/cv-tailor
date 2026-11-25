"""Shared test helpers: a fake Supabase client, a null logger, a settings factory."""

from __future__ import annotations

from typing import Any, Optional

import pytest

from jobhuntz_agent.config import Settings
from jobhuntz_agent.models import Job


class NullLogger:
    """A structlog-shaped logger that does nothing (keeps tests quiet)."""

    def info(self, *_a: Any, **_k: Any) -> None: ...
    def warning(self, *_a: Any, **_k: Any) -> None: ...
    def error(self, *_a: Any, **_k: Any) -> None: ...
    def debug(self, *_a: Any, **_k: Any) -> None: ...


class FakeClient:
    """Records every RPC the worker makes, and serves a scripted queue."""

    def __init__(self, jobs: Optional[list[Job]] = None) -> None:
        self.queue: list[Job] = list(jobs or [])
        self.status_calls: list[tuple[str, str, Optional[str]]] = []
        self.events: list[tuple[str, str, Optional[str], Optional[str]]] = []
        self.heartbeats: list[str] = []
        self.statuses: dict[str, str] = {}
        self.claim_count = 0

    def claim_next_job(self) -> Optional[Job]:
        self.claim_count += 1
        if not self.queue:
            return None
        return self.queue.pop(0)

    def update_job_status(
        self, job_id: str, status: str, error: Optional[str] = None, data: Optional[dict] = None
    ) -> bool:
        self.status_calls.append((job_id, status, error))
        self.statuses[job_id] = status
        return True

    def log_event(
        self, job_id: str, level: str, step: Optional[str], message: Optional[str], data: Optional[dict] = None
    ) -> Optional[str]:
        self.events.append((job_id, level, step, message))
        return "evt-id"

    def heartbeat(self, job_id: str) -> bool:
        self.heartbeats.append(job_id)
        return True

    def validate_token(self) -> bool:
        return True

    def reachable(self) -> bool:
        return True

    def close(self) -> None: ...


class FakeHeartbeat:
    def __init__(self) -> None:
        self.started = False
        self.stopped = False

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True


class FakeRunner:
    """Stands in for the browser observer in worker-loop tests.

    It logs one ``observed`` event (so the worker's event-logging path is
    exercised) and returns a scripted :class:`RunResult`, or raises when given a
    ``raises`` exception — to drive the failure / Ctrl+C paths without a browser.
    """

    def __init__(self, status: str = "dry_run_done", *, message: str = "done", raises: Exception | None = None):
        from jobhuntz_agent.runner import RunResult

        self._result = RunResult(status=status, message=message)
        self._raises = raises
        self.calls: list[tuple[str, str]] = []

    def run(self, job: Job, ctx: Any):
        self.calls.append((job.id, ctx.effective_mode))
        if self._raises is not None:
            raise self._raises
        ctx.client.log_event(job.id, "info", "observed", "Read the application form: 3 fields.")
        return self._result


def make_job(**over: Any) -> Job:
    base: dict[str, Any] = {
        "id": "job-1",
        "user_id": "user-1",
        "job_url": "https://boards.greenhouse.io/acme/jobs/123",
        "ats": "greenhouse",
        "status": "claimed",
        "mode": "dry_run",
        "attempts": 1,
    }
    base.update(over)
    return Job.model_validate(base)


def make_settings(**over: Any) -> Settings:
    base: dict[str, Any] = {
        "supabase_url": "https://example.supabase.co",
        "supabase_anon_key": "sb_publishable_testkey",
        "device_token": "jhd_test_token_abc",
        "poll_seconds": 10,
        "mode_override": "dry_run",
        "placeholder_seconds": 0,
        "heartbeat_seconds": 1,
        "max_backoff_seconds": 60,
    }
    base.update(over)
    # _env_file=None so a developer's real agent/.env never leaks into a test.
    return Settings(_env_file=None, **base)


@pytest.fixture
def null_logger() -> NullLogger:
    return NullLogger()
