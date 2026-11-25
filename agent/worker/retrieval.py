"""TL-4: embedding-based bullet retrieval (stdlib only, no AI dependencies).

RetrievalEngine selects experience bullets by cosine similarity to JD
requirements. When Ollama / nomic-embed-text is unavailable it falls back
to FT-1's rule score (keyword overlap), so the website always gets a result.

SQLite cache (stdlib only): keyed by SHA-256 of the text so equal texts
are never re-embedded.
"""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import tempfile
from pathlib import Path
from typing import NamedTuple, Sequence

from .ollama_client import OllamaClient, OllamaError

DEFAULT_EMBED_MODEL = "nomic-embed-text"

# Blend weights: embedding similarity vs rule score (must sum to ≤ 1).
# When embeddings are unavailable the rule score is used at full weight.
EMBED_WEIGHT = 0.7
RULE_WEIGHT = 0.3


class SelectBullet(NamedTuple):
    id: str
    score: float            # blended 0–1 (or pure rule score when no embeddings)
    covered_requirement: str  # the longest requirement this bullet explicitly names


class EmbeddingCache:
    """SQLite-backed vector cache, stdlib only.

    Keyed by SHA-256 of the input text so equal strings are never re-embedded
    across sessions or worker restarts.
    """

    def __init__(self, path: str | None = None) -> None:
        if path is None:
            path = str(Path(tempfile.gettempdir()) / "jobhuntz_embed_cache.db")
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS embeddings "
            "(hash TEXT PRIMARY KEY, vector TEXT NOT NULL)"
        )
        self._db.commit()

    def get(self, text_hash: str) -> list[float] | None:
        row = self._db.execute(
            "SELECT vector FROM embeddings WHERE hash = ?", (text_hash,)
        ).fetchone()
        if row:
            return json.loads(row[0])
        return None

    def set(self, text_hash: str, vector: list[float]) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO embeddings (hash, vector) VALUES (?, ?)",
            (text_hash, json.dumps(vector)),
        )
        self._db.commit()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length vectors, clamped to [-1, 1]."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if not mag_a or not mag_b:
        return 0.0
    return max(-1.0, min(1.0, dot / (mag_a * mag_b)))


def rule_score(text: str, requirements: list[str]) -> float:
    """FT-1-compatible keyword overlap score, normalised to 0–1.

    Case-insensitive substring match — the same conservative approach FT-1
    uses via atsMatch so Java never matches JavaScript.
    """
    if not requirements or not text:
        return 0.0
    text_lower = text.lower()
    matched = sum(1 for r in requirements if r.lower() in text_lower)
    return matched / len(requirements)


class RetrievalEngine:
    """Score and rank experience bullets against JD requirements.

    When Ollama is not available (or returns no embedding for a text) the
    engine falls back to FT-1's rule score, so the caller always receives a
    ranked list regardless of GPU / Ollama status.

    Thread-safety: the SQLite cache uses check_same_thread=False, so a single
    engine may be shared across threads in a single-process worker.
    """

    def __init__(
        self,
        ollama: OllamaClient | None = None,
        cache_path: str | None = None,
        embed_model: str = DEFAULT_EMBED_MODEL,
    ) -> None:
        self._ollama = ollama
        self._cache = EmbeddingCache(cache_path)
        self._model = embed_model

    def embed(self, text: str) -> list[float] | None:
        """Return embedding for text using the cache.

        Returns None if Ollama is not configured or the call fails.
        """
        if not self._ollama or not text.strip():
            return None
        h = _sha256(text)
        cached = self._cache.get(h)
        if cached is not None:
            return cached
        try:
            vec = self._ollama.embed(self._model, text)
        except OllamaError:
            return None
        self._cache.set(h, vec)
        return vec

    def select_bullets(
        self,
        bullets: Sequence[tuple[str, str]],
        requirements: list[str],
    ) -> list[SelectBullet]:
        """Score and rank bullets against JD requirements.

        Args:
            bullets: sequence of (bullet_id, bullet_text) pairs from the
                     master CV's experience section.
            requirements: list of requirement strings extracted from the JD
                          (the same list FT-1's parseJdKeywords produces).

        Returns:
            A list of SelectBullet (id, score, covered_requirement) sorted
            by score descending. Every input bullet ID is returned — the
            worker selection reorders, never filters.

        Fallback: if embeddings are unavailable, uses rule_score() alone and
        the blended score equals the rule score.
        """
        if not bullets:
            return []

        # Embed requirements once as a single concatenated query vector.
        req_text = " ".join(requirements)
        req_vec = self.embed(req_text) if requirements else None

        scored: list[SelectBullet] = []
        for bullet_id, bullet_text in bullets:
            rscore = rule_score(bullet_text, requirements)

            if req_vec is not None:
                b_vec = self.embed(bullet_text)
                if b_vec is not None and len(b_vec) == len(req_vec):
                    # Shift cosine similarity from [-1, 1] to [0, 1]
                    cs = (cosine_sim(req_vec, b_vec) + 1.0) / 2.0
                    blended = EMBED_WEIGHT * cs + RULE_WEIGHT * rscore
                else:
                    blended = rscore
            else:
                blended = rscore

            # Covered requirement: the longest requirement whose text appears
            # verbatim (case-insensitive) in the bullet. Longer = more specific.
            best_req = ""
            best_len = 0
            text_lower = bullet_text.lower()
            for req in requirements:
                if req.lower() in text_lower and len(req) > best_len:
                    best_len = len(req)
                    best_req = req

            scored.append(SelectBullet(id=bullet_id, score=blended, covered_requirement=best_req))

        scored.sort(key=lambda b: b.score, reverse=True)
        return scored
