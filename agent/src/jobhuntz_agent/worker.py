"""The claim → status → report loop.

This is the heart of the skeleton. It polls ``claim_next_job``; on a claim it
marks the job ``processing``, logs "claimed", runs a background heartbeat, does
a 3-second placeholder in place of a browser, then marks the job
``dry_run_done``. Any failure marks it ``failed`` with the error. The daily
submit cap and the attempt counter live server-side (in ``claim_next_job``);
the ``MODE_OVERRIDE=dry_run`` safety switch lives here, in code.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import structlog

from .config import Settings
from .models import Job
from .supabase import InvalidDeviceToken, SupabaseAgentClient, SupabaseError


class Backoff:
    """A poll delay that starts at ``base`` and doubles up to ``maximum`` on an
    empty queue or a failure, and resets to ``base`` after a job is claimed."""

    def __init__(self, base: int, maximum: int) -> None:
        self.base = max(1, int(base))
        self.maximum = max(self.base, int(maximum))
        self.current = self.base

    def reset(self) -> None:
        self.current = self.base

    def next_delay(self) -> int:
        """Return the delay to wait now, then grow it for next time."""
        delay = self.current
        self.current = min(self.current * 2, self.maximum)
        return delay


@dataclass
class ClaimOutcome:
    claimed: bool
    job: Optional[Job] = None
    status: Optional[str] = None


class HeartbeatTask:
    """Pings ``heartbeat`` on a background daemon thread until stopped."""

    def __init__(
        self,
        client: SupabaseAgentClient,
        job_id: str,
        interval: float,
        logger: structlog.stdlib.BoundLogger,
    ) -> None:
        self._client = client
        self._job_id = job_id
        self._interval = interval
        self._log = logger
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="jobhuntz-heartbeat", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._client.heartbeat(self._job_id)
            except Exception as exc:  # a missed heartbeat must never crash the run
                self._log.warning("heartbeat_failed", job_id=self._job_id, error=str(exc))

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)


HeartbeatFactory = Callable[[str], HeartbeatTask]


class Worker:
    def __init__(
        self,
        client: SupabaseAgentClient,
        settings: Settings,
        logger: structlog.stdlib.BoundLogger,
        *,
        sleep: Callable[[float], None] = time.sleep,
        work_sleep: Optional[Callable[[float], None]] = None,
        heartbeat_factory: Optional[HeartbeatFactory] = None,
    ) -> None:
        self.client = client
        self.settings = settings
        self.log = logger
        # Two seams: `_sleep` paces the poll loop; `_work_sleep` is the
        # placeholder "work" inside a job. They are the same real sleep, but
        # tests drive them apart.
        self._sleep = sleep
        self._work_sleep = work_sleep or sleep
        self._backoff = Backoff(settings.poll_seconds, settings.max_backoff_seconds)
        self._stopping = False
        self._current_job: Optional[Job] = None
        self._heartbeat_factory: HeartbeatFactory = heartbeat_factory or (
            lambda job_id: HeartbeatTask(client, job_id, settings.heartbeat_seconds, logger)
        )

    # ── mode safety ──────────────────────────────────────────────────────────
    def effective_mode(self, job: Job) -> str:
        """The mode the worker will actually act in. ``MODE_OVERRIDE=dry_run``
        forces a dry run even when the job row says submit."""
        if self.settings.forces_dry_run:
            return "dry_run"
        return job.mode

    def _placeholder_note(self, job: Job, effective: str) -> str:
        if self.settings.forces_dry_run and job.mode == "submit":
            return "Safety override is set to dry run — ignoring this job's submit mode. No browser yet (Chunk 35)."
        if effective == "submit":
            return "Submit mode has no browser yet (arrives in Chunk 35) — recorded as a dry run."
        return "Dry run: no browser yet."

    # ── processing one job ───────────────────────────────────────────────────
    def process_job(self, job: Job) -> str:
        """Take a just-claimed job through to a terminal status. Returns that
        status. Catches Ctrl+C so the job still gets a final status write."""
        self._current_job = job
        heartbeat: Optional[HeartbeatTask] = None
        try:
            self.client.update_job_status(job.id, "processing")
            self.client.log_event(job.id, "info", "claimed", f"Claimed by {self.settings.resolved_device_name}.")
            self.log.info("claimed", job_id=job.id, url=job.job_url, ats=job.ats, mode=job.mode)

            heartbeat = self._heartbeat_factory(job.id)
            heartbeat.start()

            effective = self.effective_mode(job)
            note = self._placeholder_note(job, effective)

            # The placeholder step — where the browser will go in Chunk 35.
            self._work_sleep(self.settings.placeholder_seconds)

            self.client.log_event(job.id, "info", "dry_run", note)
            self.client.update_job_status(job.id, "dry_run_done")
            self.log.info("dry_run_done", job_id=job.id, effective_mode=effective)
            return "dry_run_done"
        except KeyboardInterrupt:
            self._stopping = True
            self._terminal_quietly(job, "failed", "Stopped by Ctrl+C before finishing.")
            self.log.warning("interrupted", job_id=job.id)
            return "failed"
        except Exception as exc:
            message = str(exc)[:500]
            self._terminal_quietly(job, "failed", message)
            self.log.error("job_failed", job_id=job.id, error=message)
            return "failed"
        finally:
            if heartbeat is not None:
                heartbeat.stop()
            self._current_job = None

    def _terminal_quietly(self, job: Job, status: str, error: Optional[str]) -> None:
        """Write a final status + event, swallowing any further failure — the
        worker is already handling one problem and must not raise a second."""
        try:
            self.client.update_job_status(job.id, status, error=error)
            self.client.log_event(job.id, "error" if status == "failed" else "info", status, error)
        except Exception as exc:
            self.log.warning("terminal_write_failed", job_id=job.id, error=str(exc))

    # ── the loop ─────────────────────────────────────────────────────────────
    def run_once(self) -> ClaimOutcome:
        """Claim and process at most one job. Used by ``jobhuntz-agent once``."""
        job = self.client.claim_next_job()
        if job is None:
            self.log.info("queue_empty")
            return ClaimOutcome(claimed=False)
        status = self.process_job(job)
        return ClaimOutcome(claimed=True, job=job, status=status)

    def run(self) -> None:
        """Poll forever, draining the queue and backing off when it is empty.
        Ctrl+C stops cleanly after the current job's status is written."""
        self.log.info(
            "worker_started",
            device=self.settings.resolved_device_name,
            poll_seconds=self.settings.poll_seconds,
            mode_override=self.settings.mode_override,
        )
        try:
            while not self._stopping:
                try:
                    outcome = self.run_once()
                except InvalidDeviceToken:
                    # A token revoked mid-run: stop, don't spin.
                    self.log.error("token_rejected")
                    raise
                except SupabaseError as exc:
                    self.log.warning("poll_failed", error=str(exc))
                    self._sleep(self._backoff.next_delay())
                    continue

                if self._stopping:
                    break
                if outcome.claimed:
                    self._backoff.reset()  # drain: try the next one straight away
                    continue
                self._sleep(self._backoff.next_delay())
        except KeyboardInterrupt:
            self._stopping = True
        self.log.info("worker_stopped")

    def stop(self) -> None:
        self._stopping = True
