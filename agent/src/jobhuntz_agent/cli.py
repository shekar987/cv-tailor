"""``jobhuntz-agent`` command line: run, check, once.

- ``run``   — poll the queue forever, claiming and processing jobs.
- ``check`` — print whether Supabase is reachable and the token accepted. No claim.
- ``once``  — claim and process at most one job, then exit (for testing).
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from pydantic import ValidationError

from .artifacts import NullUploader, SignedUrlUploader
from .config import Settings, load_settings
from .logging_setup import configure_logging
from .runner import ObserverRunner
from .supabase import InvalidDeviceToken, SupabaseAgentClient, SupabaseError
from .worker import Worker


def _print(msg: str) -> None:
    print(msg, flush=True)


def _load() -> Optional[Settings]:
    try:
        return load_settings()
    except ValidationError as exc:
        _print("Jobhuntz agent: configuration problem —")
        for err in exc.errors():
            _print(f"  • {err.get('msg')}")
        _print("\nEdit agent/.env (copy agent/.env.example if you haven't) and try again.")
        return None


def _client(settings: Settings) -> SupabaseAgentClient:
    return SupabaseAgentClient(settings.supabase_url, settings.supabase_anon_key, settings.device_token)


def _runner(settings: Settings) -> ObserverRunner:
    """The browser observer, with a screenshot uploader when one is configured."""
    uploader = (
        SignedUrlUploader(settings.artifact_sign_url, settings.device_token)
        if settings.has_artifact_upload
        else NullUploader()
    )
    return ObserverRunner(uploader=uploader)


def cmd_check(settings: Settings) -> int:
    client = _client(settings)
    try:
        reachable = client.reachable()
        _print(f"Supabase: {'reachable' if reachable else 'NOT reachable'} ({settings.supabase_url})")
        _print(f"Device:   {settings.resolved_device_name}")
        if not reachable:
            _print("Could not reach Supabase — check SUPABASE_URL and your connection.")
            return 1
        try:
            client.validate_token()
            _print("Token:    accepted ✓")
            _print(f"Mode:     {settings.mode_override} (dry_run means it will never submit for real)")
            return 0
        except InvalidDeviceToken:
            _print("Token:    REJECTED — it may be revoked. Create a new one on /agent and update agent/.env.")
            return 1
        except SupabaseError as exc:
            _print(f"Token:    could not be checked — {exc}")
            return 1
    finally:
        client.close()


def cmd_once(settings: Settings) -> int:
    log = configure_logging(secrets=[settings.device_token])
    client = _client(settings)
    try:
        try:
            client.validate_token()
        except InvalidDeviceToken:
            _print("Device token rejected (it may be revoked). Create a new one on /agent and update agent/.env.")
            return 1
        except SupabaseError as exc:
            _print(f"Couldn't reach Supabase: {exc}")
            return 1
        worker = Worker(client, settings, log, runner=_runner(settings))
        outcome = worker.run_once()
        if outcome.claimed and outcome.job is not None:
            _print(f"Processed 1 job: {outcome.job.label} → {outcome.status}")
        else:
            _print("Queue empty — nothing to do.")
        return 0
    finally:
        client.close()


def cmd_run(settings: Settings) -> int:
    log = configure_logging(secrets=[settings.device_token])
    client = _client(settings)
    try:
        # Refuse to start on a revoked/empty token; a transient network error is
        # not fatal — the loop will back off and keep trying.
        try:
            client.validate_token()
        except InvalidDeviceToken:
            _print("Device token rejected (it may be revoked). Create a new one on /agent and update agent/.env.")
            return 1
        except SupabaseError as exc:
            _print(f"Couldn't reach Supabase yet ({exc}) — starting anyway and will keep trying.")

        _print(
            f"Jobhuntz worker started as '{settings.resolved_device_name}'. "
            f"Polling every {settings.poll_seconds}s. Mode override: {settings.mode_override}. "
            "Press Ctrl+C to stop."
        )
        worker = Worker(client, settings, log, runner=_runner(settings))
        worker.run()
        _print("Worker stopped.")
        return 0
    finally:
        client.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jobhuntz-agent", description="Jobhuntz Local Agent (Chunk 35: read-only browser observer).")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run", help="Poll the queue and process jobs until Ctrl+C.")
    sub.add_parser("check", help="Print Supabase reachability and the device name. No claim.")
    sub.add_parser("once", help="Claim and process at most one job, then exit.")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    settings = _load()
    if settings is None:
        return 2
    if args.command == "check":
        return cmd_check(settings)
    if args.command == "once":
        return cmd_once(settings)
    return cmd_run(settings)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
