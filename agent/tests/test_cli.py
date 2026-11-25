"""The CLI wiring: argument parsing, check, and the revoked-token refusal."""

from __future__ import annotations

import pytest

from jobhuntz_agent import cli
from jobhuntz_agent.supabase import InvalidDeviceToken

from conftest import FakeClient, make_job, make_settings


def test_parser_requires_a_command():
    with pytest.raises(SystemExit):
        cli.build_parser().parse_args([])


def test_parser_accepts_the_three_commands():
    for cmd in ("run", "check", "once"):
        assert cli.build_parser().parse_args([cmd]).command == cmd


def test_main_returns_2_on_bad_config(monkeypatch):
    monkeypatch.setattr(cli, "_load", lambda: None)
    assert cli.main(["check"]) == 2


class _CheckClient:
    def __init__(self, *, reachable=True, revoked=False):
        self._reachable = reachable
        self._revoked = revoked
        self.claimed = False

    def reachable(self):
        return self._reachable

    def validate_token(self):
        if self._revoked:
            raise InvalidDeviceToken("revoked")
        return True

    def claim_next_job(self):
        self.claimed = True
        return None

    def close(self):
        ...


def test_check_ok(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_load", lambda: make_settings())
    client = _CheckClient()
    monkeypatch.setattr(cli, "_client", lambda _s: client)
    rc = cli.main(["check"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "accepted" in out
    assert client.claimed is False  # check never claims


def test_check_reports_a_revoked_token(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_load", lambda: make_settings())
    monkeypatch.setattr(cli, "_client", lambda _s: _CheckClient(revoked=True))
    rc = cli.main(["check"])
    assert rc == 1
    assert "REJECTED" in capsys.readouterr().out


def test_once_refuses_a_revoked_token(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(cli, "_load", lambda: make_settings())
    monkeypatch.setattr(cli, "_client", lambda _s: _CheckClient(revoked=True))
    monkeypatch.setattr(cli, "configure_logging", lambda **_k: _Null())
    rc = cli.main(["once"])
    assert rc == 1
    assert "rejected" in capsys.readouterr().out.lower()


class _Null:
    def info(self, *a, **k): ...
    def warning(self, *a, **k): ...
    def error(self, *a, **k): ...
    def debug(self, *a, **k): ...


def test_once_processes_one_job(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_load", lambda: make_settings())
    client = FakeClient([make_job()])
    monkeypatch.setattr(cli, "_client", lambda _s: client)
    monkeypatch.setattr(cli, "configure_logging", lambda **_k: _Null())
    rc = cli.main(["once"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "dry_run_done" in out
    assert client.statuses[make_job().id] == "dry_run_done"
