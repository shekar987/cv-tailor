"""The Local Tailor summary task (Chunk TL-1), Python side.

A faithful mirror of src/lib/tailorJobs.ts: the same prompt, the same JSON
schema, and the same honesty number check (rule 4 — no figure the master CV
doesn't have). Kept in step by the shared tests on the TS side and by the
benchmark here. If you change one, change the other.
"""

from __future__ import annotations

import json
import re
from typing import Any

MAX_JD_CHARS = 20_000
MAX_CV_CHARS = 30_000
MAX_SUMMARY_LINES = 3
MAX_SUMMARY_CHARS = 600

# The schema Ollama is constrained to (passed as `format`).
SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
}

# The honesty contract, kept short but faithful to src/prompts/rules.ts.
_ABSOLUTE_RULES = (
    "ABSOLUTE RULES (never break these):\n"
    "1. No invention. Only use facts, skills, technologies, metrics and dates present in the master CV.\n"
    "4. Faithful metrics. Use only exact numbers from the master CV. Never round, combine, inflate or invent figures.\n"
    "6. Never graft job-description vocabulary onto work the candidate did not do.\n"
    "11. No placeholders. Never [X], by X%, TBC. State results plainly, with no number where the CV gives none."
)


def summary_system_prompt() -> str:
    return "\n".join(
        [
            "You write the Professional Summary at the top of a CV, tailored to one job.",
            "",
            "You are given the candidate's MASTER CV (the only source of truth) and a JOB DESCRIPTION.",
            "Write a Professional Summary of AT MOST three short lines that emphasises the parts of the",
            "candidate's real experience most relevant to the job.",
            "",
            "Hard requirements:",
            "- Use ONLY facts, skills, technologies and numbers found in the master CV.",
            "- Do NOT invent or borrow any number, percentage, figure or date not in the master CV.",
            "- No first person. No placeholders. No hedging. Plain British English. Three lines maximum.",
            "",
            _ABSOLUTE_RULES,
            "",
            'Return ONLY JSON of the form {"summary": "<the summary text>"}.',
        ]
    )


def summary_user_prompt(jd_text: str, master_cv: str) -> str:
    jd = (jd_text or "")[:MAX_JD_CHARS]
    cv = (master_cv or "")[:MAX_CV_CHARS]
    return "\n".join(
        [
            "=== MASTER CV (source of truth) ===",
            cv,
            "",
            "=== JOB DESCRIPTION ===",
            jd,
            "",
            "Write the tailored Professional Summary now.",
        ]
    )


def clean_summary(raw: str) -> str:
    stripped = re.sub(r"^\s*[-*•]\s+", "", (raw or "").replace("**", ""), flags=re.MULTILINE).strip()
    lines = [ln.strip() for ln in re.split(r"\r?\n+", stripped) if ln.strip()][:MAX_SUMMARY_LINES]
    return "\n".join(lines)[:MAX_SUMMARY_CHARS]


def summary_from_raw(raw: Any) -> str:
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            raw = parsed
        except Exception:
            return clean_summary(raw)
    if isinstance(raw, dict):
        if isinstance(raw.get("summary"), str):
            return clean_summary(raw["summary"])
        if isinstance(raw.get("lines"), list):
            return clean_summary("\n".join(x for x in raw["lines"] if isinstance(x, str)))
    return ""


# ── The honesty number check (rule 4) ──────────────────────────────────────────

_WORD_NUMBERS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11",
    "twelve": "12", "thirteen": "13", "fourteen": "14", "fifteen": "15", "sixteen": "16",
    "seventeen": "17", "eighteen": "18", "nineteen": "19", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80",
    "ninety": "90", "hundred": "100", "thousand": "1000", "million": "1000000",
}

_NUMBER_RE = re.compile(r"(?<![\w.])(?:[£$€]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k|m|bn|b|x|\+)?", re.IGNORECASE)


def normalize_number(raw: str) -> str:
    return re.sub(r"\s+", "", re.sub(r"[£$€]", "", raw.lower()).replace(",", "")).strip()


def _digit_tokens(text: str) -> set[str]:
    out: set[str] = set()
    for m in _NUMBER_RE.findall(text or ""):
        norm = normalize_number(m)
        if norm:
            out.add(norm)
            bare = re.sub(r"[%kmbnx+]+$", "", norm)
            if bare:
                out.add(bare)
    return out


def supported_numbers(master_cv: str) -> set[str]:
    out = _digit_tokens(master_cv)
    lower = (master_cv or "").lower()
    for word, digit in _WORD_NUMBERS.items():
        if re.search(rf"\b{word}\b", lower):
            out.add(digit)
    return out


def summary_numbers_supported(summary: str, master_cv: str) -> tuple[bool, list[str]]:
    supported = supported_numbers(master_cv)
    unsupported: list[str] = []
    seen: set[str] = set()
    for m in _NUMBER_RE.findall(summary or ""):
        norm = normalize_number(m)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        bare = re.sub(r"[%kmbnx+]+$", "", norm)
        if norm in supported or bare in supported:
            continue
        unsupported.append(m.strip())
    return (len(unsupported) == 0, unsupported)
