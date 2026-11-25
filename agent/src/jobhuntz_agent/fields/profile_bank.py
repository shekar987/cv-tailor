"""Profile bank: load a user's contact profile and answer bank (Chunk 36).

The matcher never guesses — it reads values only from here (Guardrail 5).
Values come from two sources:
  - ``ContactProfile``: name, email, phone, LinkedIn, GitHub, portfolio,
    location — parsed from the profile JSON the app stores.
  - ``saved_answers``: the answer-bank keys the app exports (sponsorship,
    right_to_work, visa_details, start_date, full_time), taken verbatim.

``load_profile_bank`` is the main entry point.  For tests, build a
``ProfileBank`` directly.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class ContactProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    portfolio: Optional[str] = None
    location: Optional[str] = None


class ProfileBank(BaseModel):
    model_config = ConfigDict(extra="ignore")

    contact: ContactProfile = ContactProfile()
    # Verbatim answer-bank strings, keyed by their answer-bank key.
    # Only the five keys the app defines are ever populated here.
    saved_answers: dict[str, str] = {}

    # ── convenience ───────────────────────────────────────────────────────────
    def get(self, key: str) -> Optional[str]:
        """Return the string value for a contact key or answer-bank key.

        Returns None when the key is unknown or the value is not set.  Values
        come from the contact profile first, then saved_answers — the caller
        decides which applies for a given field, so this method is only for the
        contact fields that have no sensitive flag.
        """
        contact_val = getattr(self.contact, key, None)
        if contact_val is not None:
            return str(contact_val)
        return self.saved_answers.get(key)

    def has(self, key: str) -> bool:
        """True when a non-empty value exists for this key."""
        return bool(self.get(key))


# ── loader ─────────────────────────────────────────────────────────────────────

def _str(v: Any, max_len: int = 500) -> Optional[str]:
    if isinstance(v, str):
        s = v.strip()[:max_len]
        return s if s else None
    return None


def _contact_from_profile(profile: dict[str, Any]) -> ContactProfile:
    """Extract contact fields from the cv_profiles.data JSON structure.

    The app stores a ``Profile`` with these top-level fields (from
    lib/profile.ts normalizeProfile):
      name, email, phone, tagline, links (list of {label, url})

    The Local-Tailor StructuredProfile (lib/profile/schema.ts) does NOT carry
    contact fields — they remain in the cv_profiles row's top-level ``data``
    object alongside the ``structured`` key.
    """
    name_raw = _str(profile.get("name"))
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    if name_raw:
        full_name = name_raw
        parts = name_raw.split()
        if len(parts) >= 2:
            first_name = parts[0]
            last_name = " ".join(parts[1:])
        else:
            first_name = name_raw

    email = _str(profile.get("email"))
    phone = _str(profile.get("phone"))

    linkedin: Optional[str] = None
    github: Optional[str] = None
    portfolio: Optional[str] = None
    for link in profile.get("links") or []:
        if not isinstance(link, dict):
            continue
        label = (_str(link.get("label")) or "").lower()
        url = _str(link.get("url"))
        if not url:
            continue
        if "linkedin" in label or "linkedin.com" in url.lower():
            linkedin = linkedin or url
        elif "github" in label or "github.com" in url.lower():
            github = github or url
        else:
            portfolio = portfolio or url

    location = _str(profile.get("location"))

    return ContactProfile(
        first_name=first_name,
        last_name=last_name,
        full_name=full_name,
        email=email,
        phone=phone,
        linkedin=linkedin,
        github=github,
        portfolio=portfolio,
        location=location,
    )


# Valid answer-bank keys (matches lib/answerBank.ts AnswerKey).
_ANSWER_KEYS = frozenset(
    {"sponsorship", "right_to_work", "visa_details", "start_date", "full_time"}
)


def load_profile_bank(
    *,
    profile: Optional[dict[str, Any]] = None,
    answer_bank: Optional[dict[str, Any]] = None,
) -> ProfileBank:
    """Build a ProfileBank from the raw dicts the app stores.

    ``profile`` is the cv_profiles.data JSON (may be None when not yet set).
    ``answer_bank`` is the output of lib/answerBank.ts buildAnswerBank
    (key → string | null; unknown keys are ignored; Guardrail 5).
    """
    contact = _contact_from_profile(profile or {})

    saved: dict[str, str] = {}
    for k, v in (answer_bank or {}).items():
        if k in _ANSWER_KEYS and isinstance(v, str):
            s = v.strip()
            if s:
                saved[k] = s

    return ProfileBank(contact=contact, saved_answers=saved)
