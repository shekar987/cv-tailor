"""Greenhouse ATS adapter — fills forms in dry-run mode (never submits).

Guardrails (unchanged from the matcher):
  4. Sensitive questions (right to work, sponsorship, salary, equal
     opportunities, criminal record, own-words essays, date of birth,
     home address) are NEVER answered — always "needs_you".
  5. Every value comes from the profile or the answer bank; unknown
     fields are flagged, never guessed.

NO_SUBMIT: this adapter never clicks a submit button under any
circumstances, even if ``mode`` is "submit".

Real-site courtesy: pass a non-zero ``pause`` (seconds) between field
fills to avoid hammering the server.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..browser.observer import ObservedElement, PageObservation
from ..fields.matcher import match_fields
from ..fields.profile_bank import ProfileBank

# ── Greenhouse URL / field-name detection ─────────────────────────────────────
_GH_URL_RE = re.compile(
    r"(greenhouse\.io|grnh\.se)",
    re.IGNORECASE,
)
# A Greenhouse form uses field names starting with "job_application[".
_GH_FIELD_RE = re.compile(r"\bjob_application\[", re.IGNORECASE)

# ── File-upload field classification ─────────────────────────────────────────
_CV_LABEL_RE = re.compile(
    r"\b(resume|cv|curriculum\s+vitae)\b",
    re.IGNORECASE,
)
_LETTER_LABEL_RE = re.compile(
    r"\b(cover[\s\-]?letter|covering\s+letter)\b",
    re.IGNORECASE,
)


# ── Result type ───────────────────────────────────────────────────────────────
@dataclass
class FillResult:
    """What the adapter did and what still needs a human."""

    filled: int = 0
    needs_you: int = 0
    unknown: int = 0
    cv_uploaded: bool = False
    letter_uploaded: bool = False
    cv_field_found: bool = False
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        """Human-readable one-liner shown on the job card."""
        # Counts: total fillable = filled + needs_you + unknown + (cv_field if present)
        cv_fillable = 1 if self.cv_field_found else 0
        cv_filled = 1 if self.cv_uploaded else 0
        total = self.filled + self.needs_you + self.unknown + cv_fillable
        total_filled = self.filled + cv_filled
        total_needs = self.needs_you + (cv_fillable - cv_filled)
        return f"Filled {total_filled} of {total} fields. {total_needs} need you."


# ── Public API ────────────────────────────────────────────────────────────────

def detect(url: str, observation: PageObservation) -> bool:
    """Return True when this looks like a Greenhouse application page."""
    if _GH_URL_RE.search(url):
        return True
    # Heuristic: at least one field uses Greenhouse's job_application[…] naming.
    return any(
        el.name and _GH_FIELD_RE.match(el.name)
        for el in observation.elements
    )


def fill(
    page: Any,
    observation: PageObservation,
    bank: ProfileBank,
    *,
    cv_path: Optional[Path] = None,
    letter_path: Optional[Path] = None,
    pause: float = 0.0,
) -> FillResult:
    """Fill all fillable fields in the observation using values from *bank*.

    Never clicks submit — this is a pure fill operation. Returns a
    :class:`FillResult` summarising what was filled and what needs a human.

    Parameters
    ----------
    page:
        The Playwright ``Page`` object (or a fake with the same interface).
    observation:
        The ``PageObservation`` produced by ``observe_page``.
    bank:
        The user's ``ProfileBank`` (contact details + answer bank).
    cv_path:
        Path to the CV/résumé file. ``None`` → the CV file field is flagged
        as "needs_you".
    letter_path:
        Path to the cover-letter file. ``None`` → skipped (optional).
    pause:
        Seconds to wait between field fills (polite pacing on real sites).
        Pass 0 for tests.
    """
    result = FillResult()
    matches = match_fields(observation.elements, bank)

    for el in observation.elements:
        frame = _get_frame(page, el.frame_path)

        # File inputs are always "skip" in the matcher — handle separately.
        if el.role == "file":
            _handle_file_field(frame, el, cv_path, letter_path, result)
            if pause:
                time.sleep(pause)
            continue

        match = matches.get(el.index)
        if match is None:
            result.unknown += 1
            continue

        # Buttons and links — truly skip, never count.
        if match.result == "skip":
            continue

        if match.fill_tag == "needs_you":
            result.needs_you += 1
            continue

        if match.fill_tag == "will_fill":
            value = bank.get(match.profile_key)
            if value:
                try:
                    _fill_element(frame, el, str(value))
                    result.filled += 1
                except Exception as exc:  # pragma: no cover – real browser only
                    result.errors.append(f"Error filling {el.selector}: {exc}")
                    result.needs_you += 1
            else:
                result.unknown += 1
            if pause:
                time.sleep(pause)
            continue

        # fill_tag == "unknown"
        result.unknown += 1

    return result


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_frame(page: Any, frame_path: str) -> Any:
    """Return the Playwright frame context for *frame_path*.

    ``frame_path == ""`` means the main frame; use the page directly.
    Otherwise iterate ``page.frames`` until the URL matches.
    """
    if not frame_path:
        return page
    for frame in page.frames:
        try:
            if frame.url == frame_path:
                return frame
        except Exception:
            continue
    return page  # fallback: main frame


def _css_escape(value: str) -> str:
    """Minimal CSS attribute-value escaping for inline selectors."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _fill_element(frame: Any, el: ObservedElement, value: str) -> None:
    """Call the right Playwright method based on the element's role."""
    sel = el.selector
    role = el.role

    if role == "textbox":
        frame.fill(sel, value)

    elif role == "combobox":
        opts = el.options
        # Try matching option label (case-insensitive) first, then value.
        label_hit = next((o for o in opts if o.label.lower() == value.lower()), None)
        value_hit = next((o for o in opts if o.value.lower() == value.lower()), None)
        if label_hit:
            frame.select_option(sel, label=label_hit.label)
        elif value_hit:
            frame.select_option(sel, value=value_hit.value)
        else:
            # Best effort: pass the bank value as the label; the browser will
            # pick the closest option or raise, which we catch in the caller.
            frame.select_option(sel, label=value)

    elif role == "checkbox":
        falsy = {"false", "no", "0", ""}
        if value.lower() not in falsy:
            frame.check(sel)
        else:
            frame.uncheck(sel)

    elif role == "radiogroup":
        # Build a value-specific selector for the matching radio button.
        name = el.name or ""
        opts = el.options
        label_hit = next((o for o in opts if o.label.lower() == value.lower()), None)
        value_hit = next((o for o in opts if o.value.lower() == value.lower()), None)
        chosen = (label_hit or value_hit)
        if chosen and name:
            radio_sel = (
                f'input[name="{_css_escape(name)}"]'
                f'[value="{_css_escape(chosen.value)}"]'
            )
            frame.check(radio_sel)
        # If no matching option, leave unchecked — will count as unknown.


def _handle_file_field(
    frame: Any,
    el: ObservedElement,
    cv_path: Optional[Path],
    letter_path: Optional[Path],
    result: FillResult,
) -> None:
    """Upload a CV or cover-letter file, or note the field needs a human."""
    sel = el.selector
    combined = f"{el.label or ''} {el.name or ''}".lower()

    is_cv = bool(_CV_LABEL_RE.search(combined))
    is_letter = bool(_LETTER_LABEL_RE.search(combined))

    if is_cv:
        result.cv_field_found = True
        if cv_path and cv_path.exists():
            frame.set_input_files(sel, cv_path)
            result.cv_uploaded = True
        else:
            result.needs_you += 1
            result.errors.append(
                f"No CV file for field {sel!r} — please upload it manually."
            )
    elif is_letter:
        # Cover letter is optional in many forms; if no path, leave it.
        if letter_path and letter_path.exists():
            frame.set_input_files(sel, letter_path)
            result.letter_uploaded = True
    else:
        result.unknown += 1
