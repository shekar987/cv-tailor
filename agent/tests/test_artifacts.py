"""The signed-URL screenshot uploader, with a mocked HTTP transport."""

from __future__ import annotations

import json

import httpx
import pytest

from jobhuntz_agent.artifacts import ArtifactUploadError, NullUploader, SignedUrlUploader


def _uploader(handler):
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    return SignedUrlUploader("https://edge.example/sign", "jhd_token", client=client)


def test_null_uploader_returns_none():
    assert NullUploader().upload_screenshot(
        user_id="u", job_id="j", filename="page.png", data=b"x", content_type="image/png"
    ) is None


def test_signed_upload_happy_path():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/sign":
            body = json.loads(request.content)
            seen["sign"] = body
            return httpx.Response(
                200,
                json={"path": "u/j/page.png", "upload_url": "https://storage.example/upload/u/j/page.png?token=abc"},
            )
        seen["put"] = {"url": str(request.url), "body_len": len(request.content), "ctype": request.headers.get("content-type")}
        return httpx.Response(200, json={"Key": "u/j/page.png"})

    path = _uploader(handler).upload_screenshot(
        user_id="u", job_id="j", filename="page.png", data=b"\x89PNG", content_type="image/png"
    )
    assert path == "u/j/page.png"
    # The device token and job were sent to the signer; the bytes were PUT.
    assert seen["sign"] == {"device_token": "jhd_token", "job_id": "j", "filename": "page.png"}
    assert seen["put"]["body_len"] == 4
    assert seen["put"]["ctype"] == "image/png"


def test_signer_error_raises_artifact_error():
    def handler(_request):
        return httpx.Response(403, json={"error": "bad token"})

    with pytest.raises(ArtifactUploadError):
        _uploader(handler).upload_screenshot(
            user_id="u", job_id="j", filename="page.png", data=b"x", content_type="image/png"
        )


def test_missing_upload_url_raises():
    def handler(request):
        if request.url.path == "/sign":
            return httpx.Response(200, json={"path": "u/j/page.png"})  # no upload_url
        return httpx.Response(200)

    with pytest.raises(ArtifactUploadError):
        _uploader(handler).upload_screenshot(
            user_id="u", job_id="j", filename="page.png", data=b"x", content_type="image/png"
        )


def test_upload_put_failure_raises():
    def handler(request):
        if request.url.path == "/sign":
            return httpx.Response(200, json={"path": "p", "upload_url": "https://storage.example/upload/p"})
        return httpx.Response(500)

    with pytest.raises(ArtifactUploadError):
        _uploader(handler).upload_screenshot(
            user_id="u", job_id="j", filename="page.png", data=b"x", content_type="image/png"
        )
