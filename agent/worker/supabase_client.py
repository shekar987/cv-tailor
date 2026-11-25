"""The Supabase side of the worker (Chunk TL-1), stdlib only.

The worker never holds a Supabase session. It calls the device-token RPCs from
20261125120000_tailor_jobs.sql over PostgREST, sending the publishable key as
`apikey`/`Authorization` (safe to ship) and the one-time device token as the
real credential inside the body. A wrong token resolves to no device and the
RPC returns nothing.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class SupabaseError(RuntimeError):
    pass


class SupabaseClient:
    def __init__(self, url: str, key: str, device_token: str, timeout: float = 30.0) -> None:
        self.base = url.rstrip("/") + "/rest/v1/rpc/"
        self.key = key
        self.device_token = device_token
        self.timeout = timeout

    def _rpc(self, fn: str, args: dict[str, Any]) -> Any:
        data = json.dumps(args).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base}{fn}",
            data=data,
            headers={
                "content-type": "application/json",
                "apikey": self.key,
                "authorization": f"Bearer {self.key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise SupabaseError(f"{fn} failed ({exc.code}): {body[:300]}") from exc
        except urllib.error.URLError as exc:
            raise SupabaseError(f"Could not reach Supabase for {fn}: {exc}") from exc
        if not raw:
            return None
        return json.loads(raw)

    def claim_next_tailor_job(self) -> dict[str, Any] | None:
        """Claim this device's oldest queued tailor job, or None."""
        out = self._rpc("claim_next_tailor_job", {"p_device_token": self.device_token})
        # A function returning a single composite type comes back as the object,
        # or as a one-element list depending on PostgREST; an empty queue is null
        # or a row whose id is null.
        if isinstance(out, list):
            out = out[0] if out else None
        if not isinstance(out, dict) or not out.get("id"):
            return None
        return out

    def heartbeat(self, job_id: str) -> bool:
        return bool(self._rpc("tailor_heartbeat", {"p_device_token": self.device_token, "p_job_id": job_id}))

    def complete_tailor_job(
        self,
        job_id: str,
        status: str,
        *,
        output: dict[str, Any] | None = None,
        model: str | None = None,
        tokens_per_sec: float | None = None,
        error: str | None = None,
    ) -> bool:
        return bool(
            self._rpc(
                "complete_tailor_job",
                {
                    "p_device_token": self.device_token,
                    "p_job_id": job_id,
                    "p_status": status,
                    "p_output": output,
                    "p_model": model,
                    "p_tokens_per_sec": tokens_per_sec,
                    "p_error": error,
                },
            )
        )
