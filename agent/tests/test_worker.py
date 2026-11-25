"""The claim → status → report loop, driven with a fake client."""

from __future__ import annotations

import pytest

from jobhuntz_agent.worker import Backoff, Worker

from conftest import FakeClient, FakeHeartbeat, make_job, make_settings


def _worker(client, *, settings=None, sleep=None, work_sleep=None, logger=None):
    hbs: list[FakeHeartbeat] = []

    def factory(_job_id: str) -> FakeHeartbeat:
        hb = FakeHeartbeat()
        hbs.append(hb)
        return hb

    w = Worker(
        client,
        settings or make_settings(),
        logger or _NULL,
        sleep=sleep or (lambda _s: None),
        work_sleep=work_sleep or (lambda _s: None),
        heartbeat_factory=factory,
    )
    return w, hbs


class _Null:
    def info(self, *a, **k): ...
    def warning(self, *a, **k): ...
    def error(self, *a, **k): ...
    def debug(self, *a, **k): ...


_NULL = _Null()


def test_claim_goes_processing_then_dry_run_done():
    job = make_job()
    client = FakeClient([job])
    worker, hbs = _worker(client)

    outcome = worker.run_once()

    assert outcome.claimed is True
    assert outcome.status == "dry_run_done"
    # The status moved processing → dry_run_done, in that order.
    assert [s for (_id, s, _e) in client.status_calls] == ["processing", "dry_run_done"]
    assert client.statuses[job.id] == "dry_run_done"
    # Events logged: claimed, then the dry-run note.
    assert [step for (_j, _l, step, _m) in client.events] == ["claimed", "dry_run"]
    # The heartbeat was started and stopped for the job.
    assert len(hbs) == 1 and hbs[0].started and hbs[0].stopped


def test_empty_queue_returns_not_claimed():
    client = FakeClient([])
    worker, _ = _worker(client)
    outcome = worker.run_once()
    assert outcome.claimed is False
    assert client.status_calls == []


def test_mode_override_dry_run_wins_over_a_submit_job():
    job = make_job(mode="submit")
    client = FakeClient([job])
    worker, _ = _worker(client, settings=make_settings(mode_override="dry_run"))

    outcome = worker.run_once()

    assert outcome.status == "dry_run_done"
    # It NEVER marked the job submitted.
    assert "submitted" not in [s for (_id, s, _e) in client.status_calls]
    # The note says the override ignored the submit mode.
    dry_run_msgs = [m for (_j, _l, step, m) in client.events if step == "dry_run"]
    assert dry_run_msgs and "override" in dry_run_msgs[0].lower()


def test_override_off_respects_submit_but_has_no_browser_yet():
    job = make_job(mode="submit")
    client = FakeClient([job])
    worker, _ = _worker(client, settings=make_settings(mode_override="off"))

    outcome = worker.run_once()

    # Even respecting submit mode, this chunk has no browser, so it records a
    # dry run and never submits for real.
    assert outcome.status == "dry_run_done"
    assert "submitted" not in [s for (_id, s, _e) in client.status_calls]


def test_exception_during_work_marks_failed_with_error():
    job = make_job()
    client = FakeClient([job])

    def boom(_s):
        raise RuntimeError("network died mid-form")

    worker, hbs = _worker(client, work_sleep=boom)
    status = worker.process_job(job)

    assert status == "failed"
    assert client.statuses[job.id] == "failed"
    # The error was recorded on the status write.
    failed = [e for (_id, s, e) in client.status_calls if s == "failed"]
    assert failed and "network died" in (failed[0] or "")
    # The heartbeat was stopped even on failure.
    assert hbs[0].stopped


def test_ctrl_c_during_a_job_writes_a_terminal_status_and_stops():
    job = make_job()
    client = FakeClient([job])

    def interrupt(_s):
        raise KeyboardInterrupt

    worker, hbs = _worker(client, work_sleep=interrupt)
    status = worker.process_job(job)

    assert status == "failed"
    assert client.statuses[job.id] == "failed"
    assert worker._stopping is True
    assert hbs[0].stopped
    failed = [e for (_id, s, e) in client.status_calls if s == "failed"]
    assert failed and "Ctrl+C" in (failed[0] or "")


def test_run_backs_off_on_an_empty_queue():
    client = FakeClient([])
    delays: list[float] = []

    def sleep(s):
        delays.append(s)
        if len(delays) >= 3:
            raise KeyboardInterrupt  # stop after three idle polls

    worker, _ = _worker(client, settings=make_settings(poll_seconds=10, max_backoff_seconds=60), sleep=sleep)
    worker.run()

    assert delays == [10, 20, 40]  # doubles from the poll interval, 60s cap not yet hit


def test_run_drains_the_queue_then_backs_off():
    jobs = [make_job(id="a"), make_job(id="b")]
    client = FakeClient(list(jobs))
    delays: list[float] = []

    def sleep(s):
        delays.append(s)
        raise KeyboardInterrupt  # the first idle sleep (after draining) stops us

    worker, _ = _worker(client, sleep=sleep)
    worker.run()

    # Both jobs reached dry_run_done, with no backoff sleep between them.
    assert client.statuses == {"a": "dry_run_done", "b": "dry_run_done"}
    # Only one sleep happened — the idle poll after the queue emptied, at base.
    assert delays == [10]


def test_backoff_sequence_and_reset():
    b = Backoff(base=10, maximum=60)
    seq = [b.next_delay() for _ in range(5)]
    assert seq == [10, 20, 40, 60, 60]
    b.reset()
    assert b.next_delay() == 10
