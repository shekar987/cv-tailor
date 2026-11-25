"""Uploading a job's artifacts (the full-page screenshot) to private storage.

The worker has no Supabase session, so it cannot write to a private Storage
bucket directly. It asks a small, device-token-authenticated **Supabase Edge
Function** (``artifact_sign_url``) for a short-lived signed upload URL for the
path ``<user_id>/<job_id>/<filename>`` in the private ``agent-artifacts``
bucket, then PUTs the bytes to that URL. The edge function — not the worker —
holds the privileged key, so no service-role key ever lives on the PC.

When ``artifact_sign_url`` is not configured, :class:`NullUploader` is used:
the worker still observes the page and records the field list (that travels in
the ``observed`` timeline event, needing no storage), and simply notes that the
screenshot upload was skipped. The observer, not the screenshot, is the point.

The observer JSON itself is small and bounded, so it is NOT uploaded here — it
is logged to ``apply_events`` via the existing device-token RPC.
"""

from __future__ import annotations

from typing import Optional, Protocol

import httpx


class ArtifactUploadError(RuntimeError):
    """A screenshot upload failed. Non-fatal — the job still completes."""


class ArtifactUploader(Protocol):
    def upload_screenshot(
        self, *, user_id: str, job_id: str, filename: str, data: bytes, content_type: str
    ) -> Optional[str]:
        """Store the bytes and return the storage path, or ``None`` if skipped."""
        ...


class NullUploader:
    """Does nothing — used when artifact uploading is not configured."""

    def upload_screenshot(
        self, *, user_id: str, job_id: str, filename: str, data: bytes, content_type: str
    ) -> Optional[str]:
        return None


class SignedUrlUploader:
    """Gets a signed upload URL from the edge function, then PUTs the bytes."""

    def __init__(
        self,
        sign_url: str,
        device_token: str,
        *,
        client: Optional[httpx.Client] = None,
        timeout: float = 30.0,
    ) -> None:
        self._sign_url = sign_url
        self._token = device_token
        self._owns_client = client is None
        self._http = client or httpx.Client(timeout=timeout)

    def close(self) -> None:
        if self._owns_client:
            self._http.close()

    def upload_screenshot(
        self, *, user_id: str, job_id: str, filename: str, data: bytes, content_type: str
    ) -> Optional[str]:
        try:
            signed = self._http.post(
                self._sign_url,
                json={"device_token": self._token, "job_id": job_id, "filename": filename},
            )
        except httpx.HTTPError as exc:
            raise ArtifactUploadError(f"Could not reach the artifact signer: {exc}") from exc
        if signed.status_code >= 400:
            raise ArtifactUploadError(f"Artifact signer refused ({signed.status_code}).")
        body = signed.json() if signed.content else {}
        upload_url = body.get("upload_url")
        path = body.get("path")
        if not upload_url or not path:
            raise ArtifactUploadError("Artifact signer returned no upload URL.")

        try:
            put = self._http.put(
                upload_url,
                content=data,
                headers={"content-type": content_type, "x-upsert": "true"},
            )
        except httpx.HTTPError as exc:
            raise ArtifactUploadError(f"Could not upload the screenshot: {exc}") from exc
        if put.status_code >= 400:
            raise ArtifactUploadError(f"Screenshot upload failed ({put.status_code}).")
        return str(path)
