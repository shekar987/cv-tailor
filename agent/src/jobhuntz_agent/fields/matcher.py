"""Field matcher — maps observed form elements to profile values (Chunk 36).

Guardrails:
  4. Sensitive questions (right to work, sponsorship, salary, equal
     opportunities, criminal record, own-words essays, date of birth, home
     address) always return ``"needs_you"`` — the matcher NEVER answers them.
  5. Every value comes from the profile or the answer bank; unknown fields are
     flagged ``"unknown"``, never guessed.

Matching order per element:
  1. Skip roles that are never filled (button, link, file, hidden).
  2. Sensitive check (Guardrail 4) — fires before anything else.
  3. HTML ``autocomplete`` attribute (exact lookup in AUTOCOMPLETE_TO_KEY).
  4. Label / name / placeholder synonym search (word-boundary).
  5. Unknown — confidence below 0.7 or key not found in the bank.

The result dict (FieldMatch) records:
  - result: "profile" | "sensitive" | "unknown" | "skip"
  - fill_tag: "will_fill" | "needs_you" | "unknown"
  - profile_key: the contact key (when result == "profile")
  - sensitive_topic: the topic name (when result == "sensitive")
  - confidence: 0.0–1.0
"""

from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, ConfigDict

from jobhuntz_agent.browser.observer import ObservedElement
from jobhuntz_agent.fields.profile_bank import ProfileBank
from jobhuntz_agent.fields.sensitive import check_sensitive
from jobhuntz_agent.fields.synonyms import AUTOCOMPLETE_TO_KEY, LABEL_SYNONYMS

# Roles that the filler never touches.
_SKIP_ROLES = frozenset({"button", "link", "file"})

# Minimum confidence to report "will_fill" rather than "unknown".
_CONFIDENCE_THRESHOLD = 0.7


class FieldMatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    index: int
    result: str  # "profile" | "sensitive" | "unknown" | "skip"
    fill_tag: str  # "will_fill" | "needs_you" | "unknown"
    profile_key: Optional[str] = None
    sensitive_topic: Optional[str] = None
    confidence: float = 0.0


def _normalize(text: str) -> str:
    """Lower-case, collapse whitespace."""
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def _word_boundary_contains(haystack: str, phrase: str) -> bool:
    """True when ``phrase`` appears in ``haystack`` as whole words."""
    escaped = re.escape(phrase)
    pattern = r"(?<![a-z0-9])" + escaped + r"(?![a-z0-9])"
    return bool(re.search(pattern, haystack, re.IGNORECASE))


def _label_synonym_match(
    label: str,
    name: str,
    placeholder: str,
) -> Optional[tuple[str, float]]:
    """Return (profile_key, confidence) for the best synonym match, or None.

    Searches label first (highest confidence), then name, then placeholder.
    Longer phrases score higher than shorter ones to avoid false positives.
    """
    texts = [
        (_normalize(label), 0.9),
        (_normalize(name), 0.75),
        (_normalize(placeholder), 0.72),
    ]
    best_key: Optional[str] = None
    best_confidence: float = 0.0
    best_phrase_len = 0

    for key, synonyms in LABEL_SYNONYMS.items():
        for phrase in synonyms:
            norm_phrase = _normalize(phrase)
            for text, base_conf in texts:
                if not text:
                    continue
                if _word_boundary_contains(text, norm_phrase):
                    phrase_len = len(norm_phrase.split())
                    if phrase_len > best_phrase_len or (
                        phrase_len == best_phrase_len and base_conf > best_confidence
                    ):
                        best_key = key
                        best_confidence = base_conf
                        best_phrase_len = phrase_len

    if best_key and best_confidence >= _CONFIDENCE_THRESHOLD:
        return best_key, best_confidence
    return None


def _match_element(el: ObservedElement, bank: ProfileBank) -> FieldMatch:
    """Match one element to a profile key or return a non-match reason."""
    idx = el.index

    # 1. Skip non-fillable roles.
    if el.role in _SKIP_ROLES:
        return FieldMatch(index=idx, result="skip", fill_tag="unknown", confidence=0.0)

    label = el.label or ""
    name = el.name or ""
    placeholder = el.placeholder or ""

    # 2. Sensitive check (Guardrail 4) — always wins.
    topic = check_sensitive(label=label, name=name, placeholder=placeholder)
    if topic:
        return FieldMatch(
            index=idx,
            result="sensitive",
            fill_tag="needs_you",
            sensitive_topic=topic,
            confidence=1.0,
        )

    # 3. HTML autocomplete attribute.
    if el.autocomplete:
        ac_key = AUTOCOMPLETE_TO_KEY.get(el.autocomplete.lower())
        if ac_key and bank.has(ac_key):
            return FieldMatch(
                index=idx,
                result="profile",
                fill_tag="will_fill",
                profile_key=ac_key,
                confidence=0.95,
            )

    # 4. Synonym match.
    hit = _label_synonym_match(label, name, placeholder)
    if hit:
        key, conf = hit
        if bank.has(key):
            return FieldMatch(
                index=idx,
                result="profile",
                fill_tag="will_fill",
                profile_key=key,
                confidence=conf,
            )
        # Key identified but no value in the bank — still unknown to the user.

    # 5. Unknown.
    return FieldMatch(index=idx, result="unknown", fill_tag="unknown", confidence=0.0)


def match_fields(
    elements: list[ObservedElement],
    bank: ProfileBank,
) -> dict[int, FieldMatch]:
    """Match every element in a page observation to the profile bank.

    Returns a dict keyed by element index.  Every element has an entry;
    ``fill_tag`` is the value the UI shows.
    """
    return {el.index: _match_element(el, bank) for el in elements}
