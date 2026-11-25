"""Sensitive-field detection — Guardrail 4 (Chunk 36).

The topics listed here are NEVER answered automatically.  Whenever a field
matches one of these patterns the matcher returns ``"needs_you"`` and the topic
name, so the user can fill in the answer themselves or choose not to apply.

Pattern rules:
  - Patterns are anchored to whole words / phrases (word-boundary regex).
  - They must be narrow enough not to fire on innocent labels (e.g.
    "salary scale" on a benefits page should not fire, but "expected salary",
    "current salary" and "salary expectations" must).
  - A field is sensitive if its label, name attribute, or placeholder matches
    ANY one of a topic's patterns.
"""

from __future__ import annotations

import re
from typing import Optional


# ── topic → list[pattern_string] ─────────────────────────────────────────────
# Patterns are case-insensitive.  Word boundaries (\b) prevent partial matches.
_TOPIC_PATTERNS: dict[str, list[str]] = {
    "right_to_work": [
        r"\bright\s+to\s+work\b",
        r"\bwork\s+authoris(ation|ation)\b",
        r"\bwork\s+authoriz(ation|ation)\b",
        r"\bright\s+to\s+work\s+in\b",
        r"\blegal(ly)?\s+authoris(ed|ed)\b",
        r"\blegal(ly)?\s+authoriz(ed|ed)\b",
        r"\beligible\s+to\s+work\b",
        r"\bpermission\s+to\s+work\b",
        r"\bwork\s+permit\b",
        r"\bvisa\s+status\b",
        r"\bimmigration\s+status\b",
        r"\brequire\s+(a\s+)?visa\b",
        r"\bdo\s+you\s+(currently\s+)?require\b.*\bsponsor(ship)?\b",
    ],
    "sponsorship": [
        r"\bsponsor(ship)?\b",
        r"\bvisa\s+sponsor(ship)?\b",
        r"\brequire\s+sponsorship\b",
        r"\bneed\s+sponsorship\b",
        r"\bwork\s+visa\b",
        r"\btier\s+[0-9]\s+visa\b",
        r"\bskilledworker\b",
    ],
    "salary": [
        r"\bsalary\s+expectation\b",
        r"\bexpected\s+salary\b",
        r"\bcurrent\s+salary\b",
        r"\bdesired\s+salary\b",
        r"\bsalary\s+requirement\b",
        r"\bcompensation\s+expectation\b",
        r"\bdesired\s+compensation\b",
        r"\bpay\s+expectation\b",
        r"\brate\s+expectation\b",
        r"\bday\s+rate\b",
    ],
    "equal_opportunities": [
        r"\bgender\b",
        r"\bsex\b",
        r"\bsexual\s+orientation\b",
        r"\brace\b",
        r"\bethnicity\b",
        r"\bethnic\s+(origin|background|group)\b",
        r"\bdisabilit(y|ies)\b",
        r"\bdisabled\b",
        r"\breligion\b",
        r"\bbelief\b",
        r"\bnationality\b",
        r"\bage\s+(group|range|band)\b",
        r"\bmarital\s+status\b",
        r"\bpregnancy\b",
        r"\bmaternity\b",
        r"\bpaternity\b",
        r"\bdiversit(y|ies)\b",
        r"\bequal\s+opportunit(y|ies)\b",
        r"\bpositive\s+action\b",
        r"\bmonitoring\s+form\b",
    ],
    "criminal_record": [
        r"\bcriminal\s+(record|background|history|conviction)\b",
        r"\bDBS\s+(check|disclosure)\b",
        r"\bpolice\s+(check|clearance|vetting)\b",
        r"\bbackground\s+(check|screening|clearance|investigation)\b",
        r"\bprevious\s+conviction\b",
        r"\bunspent\s+conviction\b",
        r"\brehabilitation\b",
        r"\bsecurity\s+clearance\b",
        r"\bSC\s+cleared\b",
        r"\bDV\s+cleared\b",
        r"\bchecked\s+conviction\b",
    ],
    "own_words_essay": [
        r"\bcover\s+letter\b",
        r"\bpersonal\s+statement\b",
        r"\bwhy\s+(do\s+you\s+want|are\s+you\s+applying|this\s+(role|job|position))\b",
        r"\btell\s+us\s+(about|why|more)\b",
        r"\bdescribe\s+(yourself|your\s+experience|a\s+time)\b",
        r"\bwhat\s+interests\s+you\b",
        r"\bhow\s+would\s+you\b",
        r"\bplease\s+describe\b",
        r"\badditional\s+(information|comments|notes|message)\b",
        r"\banything\s+else\b",
    ],
    "date_of_birth": [
        r"\bdate\s+of\s+birth\b",
        r"\bdob\b",
        r"\bbirthday\b",
        r"\bbirthdate\b",
        r"\bage\b(?!\s*(group|range|band))",  # bare "age" but not "age group"
    ],
    "home_address": [
        r"\bhome\s+address\b",
        r"\bstreet\s+address\b",
        r"\baddress\s+line\b",
        r"\baddress\s+1\b",
        r"\bpostal\s+address\b",
        r"\bfull\s+address\b",
        r"\bhouse\s+number\b",
        r"\bflat\s+number\b",
    ],
}

# Pre-compile once.
_COMPILED: dict[str, list[re.Pattern[str]]] = {
    topic: [re.compile(p, re.IGNORECASE) for p in patterns]
    for topic, patterns in _TOPIC_PATTERNS.items()
}


def check_sensitive(
    label: str = "",
    name: str = "",
    placeholder: str = "",
) -> Optional[str]:
    """Return the topic name when any pattern fires, else None.

    Checks label, name attribute and placeholder in that order; returns the
    topic of the FIRST match (earlier topics in the dict take priority).
    """
    texts = [
        (label or "").lower(),
        (name or "").lower(),
        (placeholder or "").lower(),
    ]
    for topic, patterns in _COMPILED.items():
        for pattern in patterns:
            for text in texts:
                if text and pattern.search(text):
                    return topic
    return None
