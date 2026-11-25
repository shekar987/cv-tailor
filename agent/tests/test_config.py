"""Configuration validation and the derived safety helpers."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from jobhuntz_agent.config import Settings

from conftest import make_settings


def _settings(**over):
    base = {
        "supabase_url": "https://example.supabase.co",
        "supabase_anon_key": "sb_publishable_x",
        "device_token": "jhd_token",
    }
    base.update(over)
    return Settings(_env_file=None, **base)


def test_empty_device_token_is_rejected_with_a_clear_message():
    with pytest.raises(ValidationError) as exc:
        _settings(device_token="  ")
    assert "DEVICE_TOKEN is empty" in str(exc.value)


def test_missing_url_and_key_are_rejected():
    with pytest.raises(ValidationError):
        _settings(supabase_url="")
    with pytest.raises(ValidationError):
        _settings(supabase_anon_key="")


def test_a_secret_key_is_refused():
    with pytest.raises(ValidationError) as exc:
        _settings(supabase_anon_key="sb_secret_abc")
    assert "publishable" in str(exc.value).lower()


def test_defaults():
    s = _settings()
    assert s.poll_seconds == 10
    assert s.mode_override == "dry_run"
    assert s.forces_dry_run is True


def test_mode_override_off_does_not_force_dry_run():
    s = _settings(mode_override="off")
    assert s.forces_dry_run is False


def test_resolved_device_name_prefers_the_configured_name():
    assert make_settings(device_name="Shekar's laptop").resolved_device_name == "Shekar's laptop"
    # With none set, it falls back to a non-empty machine name.
    assert make_settings(device_name="").resolved_device_name


def test_trailing_slash_stripped_from_url():
    assert _settings(supabase_url="https://example.supabase.co/").supabase_url == "https://example.supabase.co"


def test_browser_defaults():
    s = _settings()
    assert s.browser_headless is False  # headed by default so the user can watch / sign in
    assert s.action_delay_range_ms == (400, 900)
    assert s.browser_profile_dir  # a non-empty path
    assert s.has_artifact_upload is False  # no signer configured by default


def test_has_artifact_upload_true_when_a_signer_is_set():
    s = _settings(artifact_sign_url="https://edge.example/functions/v1/agent-artifact-sign")
    assert s.has_artifact_upload is True
