"""The Supabase client over a fake HTTP transport (httpx.MockTransport).

This exercises the real client code — URL, headers, argument names, response
parsing and error mapping — against a tiny in-memory stand-in for the Chunk 33
RPCs, so no real Supabase project is needed.
"""

from __future__ import annotations

import json

import httpx
import pytest

from jobhuntz_agent.supabase import InvalidDeviceToken, SupabaseAgentClient, SupabaseError

TOKEN = "jhd_right_token"
BASE = "https://example.supabase.co"


class FakeQueue:
    """Mimics claim_next_job / heartbeat / update_job_status / log_event."""

    def __init__(self, jobs=None, *, revoked=False):
        self.jobs = list(jobs or [])
        self.revoked = revoked
        self.statuses = {}
        self.events = []
        self.heartbeats = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        args = json.loads(request.content or b"{}")
        # Every RPC validates the token first.
        if args.get("p_device_token") != TOKEN or self.revoked:
            return httpx.Response(403, json={"code": "28000", "message": "invalid_device_token"})
        if name == "claim_next_job":
            job = self.jobs.pop(0) if self.jobs else None
            return httpx.Response(200, json=job)
        if name == "heartbeat":
            jid = args["p_job_id"]
            self.heartbeats.append(jid)
            return httpx.Response(200, json=jid in self.statuses)
        if name == "update_job_status":
            self.statuses[args["p_job_id"]] = args["p_status"]
            return httpx.Response(200, json=True)
        if name == "log_event":
            self.events.append((args["p_job_id"], args["p_step"], args["p_message"]))
            return httpx.Response(200, json="event-uuid-1")
        return httpx.Response(404, json={"message": "no such function"})


def _client(queue: FakeQueue) -> SupabaseAgentClient:
    http = httpx.Client(transport=httpx.MockTransport(queue.handler))
    return SupabaseAgentClient(BASE, "sb_publishable_x", TOKEN, client=http)


def test_claim_parses_a_job():
    job_row = {"id": "j1", "job_url": "https://jobs.lever.co/acme/1", "ats": "lever", "status": "claimed", "mode": "dry_run"}
    client = _client(FakeQueue([job_row]))
    job = client.claim_next_job()
    assert job is not None
    assert job.id == "j1"
    assert job.ats == "lever"


def test_claim_on_empty_queue_is_none():
    client = _client(FakeQueue([]))
    assert client.claim_next_job() is None


def test_status_heartbeat_and_event_wiring():
    client = _client(FakeQueue([]))
    assert client.update_job_status("j1", "processing") is True
    assert client.log_event("j1", "info", "claimed", "hello") == "event-uuid-1"
    # heartbeat returns True only once the job has a status row.
    assert client.heartbeat("j1") is True


def test_invalid_status_is_still_sent_as_an_argument():
    # The server validates the status; the client just forwards it.
    client = _client(FakeQueue([]))
    assert client.update_job_status("j1", "dry_run_done") is True


def test_revoked_token_raises_invalid_device_token():
    client = _client(FakeQueue([], revoked=True))
    with pytest.raises(InvalidDeviceToken):
        client.claim_next_job()


def test_wrong_token_raises_invalid_device_token():
    http = httpx.Client(transport=httpx.MockTransport(FakeQueue([]).handler))
    client = SupabaseAgentClient(BASE, "sb_publishable_x", "jhd_wrong", client=http)
    with pytest.raises(InvalidDeviceToken):
        client.validate_token()


def test_server_500_raises_supabase_error():
    def boom(_request):
        return httpx.Response(500, json={"message": "boom"})

    http = httpx.Client(transport=httpx.MockTransport(boom))
    client = SupabaseAgentClient(BASE, "sb_publishable_x", TOKEN, client=http)
    with pytest.raises(SupabaseError):
        client.claim_next_job()


def test_network_error_raises_supabase_error():
    def dead(_request):
        raise httpx.ConnectError("no route to host")

    http = httpx.Client(transport=httpx.MockTransport(dead))
    client = SupabaseAgentClient(BASE, "sb_publishable_x", TOKEN, client=http)
    with pytest.raises(SupabaseError):
        client.claim_next_job()
