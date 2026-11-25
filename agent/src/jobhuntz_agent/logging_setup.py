"""Structured JSON logging for the worker.

Every log line is one JSON object, written to a dated file under ``logs/`` and
echoed to the console. A redaction processor runs on every line: any field
whose key contains "token", "key" or "password" is masked, and the device
token's literal value is scrubbed wherever it appears — so a log file is safe
to paste into a bug report.
"""

from __future__ import annotations

import datetime as _dt
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

import structlog

REDACTED = "***redacted***"
_SECRET_KEY_RE = re.compile(r"(token|key|password|secret)", re.IGNORECASE)


def _scrub_value(value: Any, secrets: Iterable[str]) -> Any:
    """Replace any known secret substring inside a string value."""
    if isinstance(value, str):
        out = value
        for s in secrets:
            if s and s in out:
                out = out.replace(s, REDACTED)
        return out
    if isinstance(value, dict):
        return {k: _scrub_value(v, secrets) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(_scrub_value(v, secrets) for v in value)
    return value


def make_redactor(secrets: Iterable[str]):
    """Build a structlog processor that masks secret-named keys and scrubs the
    given secret values from everywhere in the event dict."""
    secret_list = [s for s in secrets if s]

    def redactor(_logger: Any, _method: str, event_dict: dict[str, Any]) -> dict[str, Any]:
        for key in list(event_dict.keys()):
            if _SECRET_KEY_RE.search(key):
                event_dict[key] = REDACTED
            else:
                event_dict[key] = _scrub_value(event_dict[key], secret_list)
        return event_dict

    return redactor


class _Tee:
    """A write target that fans a line out to the log file and the console."""

    def __init__(self, *streams: Any) -> None:
        self._streams = streams

    def write(self, data: str) -> None:
        for s in self._streams:
            try:
                s.write(data)
            except Exception:
                pass

    def flush(self) -> None:
        for s in self._streams:
            try:
                s.flush()
            except Exception:
                pass


def log_file_path(log_dir: Path, today: _dt.date | None = None) -> Path:
    day = today or _dt.date.today()
    return log_dir / f"agent-{day.isoformat()}.log"


def configure_logging(
    *,
    secrets: Iterable[str] = (),
    log_dir: str | os.PathLike[str] = "logs",
    console: bool = True,
) -> structlog.stdlib.BoundLogger:
    """Configure structlog and return a ready logger.

    Writes JSON lines to ``<log_dir>/agent-YYYY-MM-DD.log`` and (by default)
    also to stdout. The log directory is created if missing.
    """
    directory = Path(log_dir)
    directory.mkdir(parents=True, exist_ok=True)
    handle = open(log_file_path(directory), "a", encoding="utf-8")
    target = _Tee(handle, sys.stdout) if console else _Tee(handle)

    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            make_redactor(secrets),
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.PrintLoggerFactory(file=target),
        cache_logger_on_first_use=True,
    )
    return structlog.get_logger("jobhuntz_agent")
