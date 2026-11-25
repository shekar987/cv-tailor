"""The worker's only link to Supabase: the four Chunk 33 device-token RPCs,
called over the PostgREST ``/rest/v1/rpc/`` endpoint with the publishable key.

The worker has no Supabase session. The device token is the whole credential:
it is passed as the first argument to every RPC, and a wrong or revoked token
matches no device and is rejected. These four functions, plus a reachability
check, are the entire surface — the worker never reads or writes the tables
directly.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from .models import Job

# A valid UUID that matches no job: used to validate the token (and bump the
# device's last_seen) without claiming anything.
NIL_UUID = "00000000-0000-0000-0000-000000000000"


class SupabaseError(RuntimeError):
    """An RPC or network failure the worker should back off and retry."""


class InvalidDeviceToken(SupabaseError):
    """The device token was rejected — empty, wrong, or revoked. Fatal."""


def _error_message(resp: httpx.Response) -> tuple[str, Optional[str]]:
    """Pull PostgREST's error message and SQLSTATE code out of a 4xx/5xx body."""
    try:
        body = resp.json()
    except Exception:
        return (resp.text or f"HTTP {resp.status_code}", None)
    if isinstance(body, dict):
        msg = body.get("message") or body.get("error") or body.get("hint") or f"HTTP {resp.status_code}"
        return (str(msg), body.get("code"))
    return (str(body), None)


class SupabaseAgentClient:
    """Calls the device-token RPCs. One instance per worker run."""

    def __init__(
        self,
        base_url: str,
        anon_key: str,
        device_token: str,
        *,
        client: Optional[httpx.Client] = None,
        timeout: float = 20.0,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._anon = anon_key
        self._token = device_token
        self._owns_client = client is None
        self._http = client or httpx.Client(timeout=timeout)

    # ── lifecycle ────────────────────────────────────────────────────────────
    def close(self) -> None:
        if self._owns_client:
            self._http.close()

    def __enter__(self) -> "SupabaseAgentClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ── low-level ────────────────────────────────────────────────────────────
    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self._anon,
            "Authorization": f"Bearer {self._anon}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _rpc(self, name: str, args: dict[str, Any]) -> Any:
        url = f"{self._base}/rest/v1/rpc/{name}"
        try:
            resp = self._http.post(url, json=args, headers=self._headers())
        except httpx.HTTPError as exc:
            raise SupabaseError(f"Could not reach Supabase for {name}: {exc}") from exc
        if resp.status_code >= 400:
            msg, code = _error_message(resp)
            if code == "28000" or "invalid_device_token" in msg:
                raise InvalidDeviceToken("The device token was rejected (it may be revoked).")
            raise SupabaseError(f"{name} failed ({resp.status_code}): {msg}")
        if not resp.content:
            return None
        try:
            return resp.json()
        except Exception as exc:  # pragma: no cover - PostgREST always sends JSON
            raise SupabaseError(f"{name} returned a non-JSON body") from exc

    # ── the four RPCs ────────────────────────────────────────────────────────
    def claim_next_job(self) -> Optional[Job]:
        """Claim the oldest queued job for this device, or ``None`` if the queue
        is empty / capped. Also bumps the device's last_seen on the server."""
        data = self._rpc("claim_next_job", {"p_device_token": self._token})
        if isinstance(data, list):  # defensive: some PostgREST versions wrap it
            data = data[0] if data else None
        if not isinstance(data, dict) or not data.get("id"):
            return None
        return Job.model_validate(data)

    def heartbeat(self, job_id: str) -> bool:
        """Tell the server a claimed job is still alive; returns whether a row
        was stamped. Validates the token (raises ``InvalidDeviceToken``)."""
        return bool(self._rpc("heartbeat", {"p_device_token": self._token, "p_job_id": job_id}))

    def update_job_status(
        self,
        job_id: str,
        status: str,
        error: Optional[str] = None,
        data: Optional[dict[str, Any]] = None,
    ) -> bool:
        return bool(
            self._rpc(
                "update_job_status",
                {
                    "p_device_token": self._token,
                    "p_job_id": job_id,
                    "p_status": status,
                    "p_error": error,
                    "p_data": data,
                },
            )
        )

    def log_event(
        self,
        job_id: str,
        level: str,
        step: Optional[str],
        message: Optional[str],
        data: Optional[dict[str, Any]] = None,
    ) -> Optional[str]:
        result = self._rpc(
            "log_event",
            {
                "p_device_token": self._token,
                "p_job_id": job_id,
                "p_level": level,
                "p_step": step,
                "p_message": message,
                "p_data": data,
            },
        )
        return result if isinstance(result, str) else None

    # ── diagnostics (no claim) ───────────────────────────────────────────────
    def reachable(self) -> bool:
        """Can we reach the PostgREST endpoint at all? A 5xx or a network error
        is unreachable; anything else means the server answered."""
        try:
            resp = self._http.get(
                f"{self._base}/rest/v1/",
                headers={"apikey": self._anon, "Authorization": f"Bearer {self._anon}"},
            )
        except httpx.HTTPError:
            return False
        return resp.status_code < 500

    def validate_token(self) -> bool:
        """Prove the token is accepted without claiming a job. Raises
        ``InvalidDeviceToken`` when it is wrong or revoked; ``SupabaseError`` on
        a network problem."""
        self.heartbeat(NIL_UUID)
        return True
