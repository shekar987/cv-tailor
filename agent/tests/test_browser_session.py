"""BrowserSession behaviour that needs no real browser: config-derived paths,
the polite pause, and the settle-timeout tolerance."""

from __future__ import annotations

import os

from jobhuntz_agent.browser.session import BrowserSession, open_and_settle
from jobhuntz_agent.config import default_profile_dir

from conftest import make_settings


def test_default_profile_dir_uses_localappdata(monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", os.path.join("C:", "tmp", "local"))
    path = default_profile_dir()
    assert path.endswith(os.path.join("Jobhuntz", "agent-profile"))
    assert "local" in path


def test_default_profile_dir_without_localappdata(monkeypatch):
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    path = default_profile_dir()
    assert "jobhuntz" in path.lower()
    assert path.endswith(os.path.join("jobhuntz", "agent-profile"))


def test_action_delay_range_never_inverts():
    s = make_settings(action_delay_min_ms=900, action_delay_max_ms=400)
    assert s.action_delay_range_ms == (900, 900)


def test_pause_sleeps_within_the_configured_range():
    waited: list[float] = []
    s = make_settings(action_delay_min_ms=100, action_delay_max_ms=200)
    session = BrowserSession(s, sleep=waited.append)
    session.pause()
    assert len(waited) == 1
    assert 0.1 <= waited[0] <= 0.2


def test_pause_is_a_no_op_when_disabled():
    waited: list[float] = []
    s = make_settings(action_delay_min_ms=0, action_delay_max_ms=0)
    BrowserSession(s, sleep=waited.append).pause()
    assert waited == []


def test_context_before_start_raises():
    session = BrowserSession(make_settings())
    try:
        _ = session.context
    except RuntimeError as exc:
        assert "not started" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected RuntimeError")


class _FakePage:
    def __init__(self) -> None:
        self.goto_args = None
        self.settle_called = False

    def goto(self, url, wait_until=None, timeout=None):
        self.goto_args = (url, wait_until, timeout)

    def wait_for_load_state(self, state, timeout=None):
        self.settle_called = True
        raise TimeoutError("networkidle never came")


def test_open_and_settle_tolerates_a_networkidle_timeout():
    page = _FakePage()
    # Must not raise even though wait_for_load_state times out.
    open_and_settle(page, "https://acme.example/jobs/1", timeout_ms=1234)
    assert page.goto_args == ("https://acme.example/jobs/1", "domcontentloaded", 1234)
    assert page.settle_called is True
