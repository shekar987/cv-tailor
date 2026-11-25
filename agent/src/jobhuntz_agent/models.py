"""Typed shapes for a queued job and a timeline event.

These mirror the Chunk 33 ``apply_jobs`` and ``apply_events`` tables. The job
model tolerates extra columns the server may add later and missing optional
ones, so a schema that grows never breaks the worker.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict

JobStatus = str  # the server owns the full set; the worker only sets a known few.
JobMode = Literal["dry_run", "submit"]
EventLevel = Literal["debug", "info", "warn", "error"]

# The statuses the worker is allowed to set (mirrors update_job_status in the
# migration — queued/claimed/cancelled are the website's and the claim's own).
WORKER_STATUSES: frozenset[str] = frozenset(
    {"processing", "needs_review", "needs_human", "dry_run_done", "submitted", "failed"}
)


class Job(BaseModel):
    """One row of ``apply_jobs`` as returned by ``claim_next_job``."""

    model_config = ConfigDict(extra="ignore")

    id: str
    user_id: Optional[str] = None
    application_id: Optional[str] = None
    job_url: str
    job_url_norm: Optional[str] = None
    company: Optional[str] = None
    role: Optional[str] = None
    ats: str = "unknown"
    status: JobStatus = "claimed"
    mode: JobMode = "dry_run"
    priority: int = 0
    attempts: int = 0
    claimed_by: Optional[str] = None
    last_error: Optional[str] = None
    confirmation_url: Optional[str] = None
    screenshot_path: Optional[str] = None

    @property
    def label(self) -> str:
        """A short human label for logs: 'Company — Role', else the URL."""
        if self.company and self.role:
            return f"{self.company} — {self.role}"
        return self.company or self.role or self.job_url


class AgentEvent(BaseModel):
    """One line the worker appends to a job's timeline via ``log_event``."""

    model_config = ConfigDict(extra="ignore")

    level: EventLevel = "info"
    step: Optional[str] = None
    message: Optional[str] = None
    data: Optional[dict[str, Any]] = None
