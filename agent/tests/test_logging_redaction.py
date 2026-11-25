"""Secrets never reach the log file."""

from __future__ import annotations

import json
from pathlib import Path

from jobhuntz_agent.logging_setup import REDACTED, configure_logging, log_file_path, make_redactor


def test_redactor_masks_secret_named_keys():
    redact = make_redactor([])
    out = redact(None, "info", {"event": "hi", "device_token": "jhd_x", "api_key": "abc", "password": "p"})
    assert out["device_token"] == REDACTED
    assert out["api_key"] == REDACTED
    assert out["password"] == REDACTED
    assert out["event"] == "hi"


def test_redactor_scrubs_the_token_value_anywhere():
    redact = make_redactor(["jhd_supersecret"])
    out = redact(None, "info", {"event": "claimed with jhd_supersecret", "note": ["jhd_supersecret inside a list"]})
    assert "jhd_supersecret" not in out["event"]
    assert REDACTED in out["event"]
    assert "jhd_supersecret" not in out["note"][0]


def test_configure_logging_writes_redacted_json_lines(tmp_path: Path):
    log = configure_logging(secrets=["jhd_supersecret"], log_dir=tmp_path, console=False)
    log.info("claimed", device_token="jhd_supersecret", url="https://jobs.lever.co/x", message="using jhd_supersecret")

    path = log_file_path(tmp_path)
    assert path.exists()
    line = path.read_text(encoding="utf-8").strip().splitlines()[-1]
    record = json.loads(line)  # it really is one JSON object per line
    assert record["event"] == "claimed"
    assert record["device_token"] == REDACTED
    assert "jhd_supersecret" not in line
    assert record["url"] == "https://jobs.lever.co/x"
    assert "level" in record and "timestamp" in record
