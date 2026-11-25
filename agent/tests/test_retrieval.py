"""TL-4: tests for agent.worker.retrieval.

All fixtures are fictional (Alex Tester). No Ollama required — the engine
falls back to rule scores when ollama=None. Tests are written first.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from agent.worker.retrieval import (
    EmbeddingCache,
    RetrievalEngine,
    SelectBullet,
    cosine_sim,
    rule_score,
)

# ── Fictional CV bullets for Alex Tester ────────────────────────────────────────

BULLETS: list[tuple[str, str]] = [
    ("R1.1", "Rebuilt the logistics dashboard in TypeScript used by 40 depots, cutting load time by 35%."),
    ("R1.2", "Built a REST API in Node.js and Express serving 1.2 million requests a day."),
    ("R1.3", "Shipped to AWS on ECS and RDS Postgres with GitHub Actions CI."),
    ("R1.4", "Added Jest and Playwright test suites, taking coverage from 20% to 85%."),
    ("R1.5", "Mentored 2 junior developers through weekly code reviews."),
    ("R2.1", "Built internal React tools used by 15 staff."),
    ("R2.2", "Wrote SQL reports over a PostgreSQL warehouse."),
]

REQUIREMENTS_TS = ["TypeScript", "React", "Node.js", "PostgreSQL"]
REQUIREMENTS_TESTING = ["Jest", "Playwright", "testing", "test coverage"]
REQUIREMENTS_JAVA = ["Java", "Spring Boot", "Hibernate"]  # not in fictional CV


# ── cosine_sim ───────────────────────────────────────────────────────────────────

class TestCosineSim:
    def test_identical(self):
        v = [1.0, 0.0, 0.0]
        assert abs(cosine_sim(v, v) - 1.0) < 1e-6

    def test_orthogonal(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert abs(cosine_sim(a, b)) < 1e-6

    def test_opposite(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert abs(cosine_sim(a, b) + 1.0) < 1e-6

    def test_zero_vector_returns_zero(self):
        assert cosine_sim([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_clamped_to_minus_one_plus_one(self):
        # Floating-point imprecision should not push outside [-1, 1]
        v = [1.0] * 100
        result = cosine_sim(v, v)
        assert -1.0 <= result <= 1.0


# ── rule_score ───────────────────────────────────────────────────────────────────

class TestRuleScore:
    def test_full_match(self):
        score = rule_score(
            "Node.js REST API PostgreSQL React",
            ["Node.js", "PostgreSQL", "React"],
        )
        assert abs(score - 1.0) < 1e-6

    def test_partial_match_half(self):
        score = rule_score("Node.js is great", ["Node.js", "PostgreSQL"])
        assert abs(score - 0.5) < 1e-6

    def test_no_match_returns_zero(self):
        score = rule_score("Python and Django", ["Java", "Spring Boot"])
        assert score == 0.0

    def test_empty_requirements_returns_zero(self):
        assert rule_score("anything here", []) == 0.0

    def test_empty_text_returns_zero(self):
        assert rule_score("", ["Node.js"]) == 0.0

    def test_case_insensitive(self):
        score = rule_score("REACT and TYPESCRIPT", ["React", "TypeScript"])
        assert abs(score - 1.0) < 1e-6

    def test_score_bounded_zero_one(self):
        score = rule_score("x", ["x", "y", "z"])
        assert 0.0 <= score <= 1.0


# ── EmbeddingCache ───────────────────────────────────────────────────────────────

class TestEmbeddingCache:
    def test_miss_returns_none(self, tmp_path):
        cache = EmbeddingCache(str(tmp_path / "test.db"))
        assert cache.get("nonexistent_hash_xyz") is None

    def test_round_trip(self, tmp_path):
        cache = EmbeddingCache(str(tmp_path / "cache.db"))
        vec = [0.1, 0.2, 0.3, 0.4, 0.5]
        cache.set("abc123", vec)
        result = cache.get("abc123")
        assert result is not None
        assert len(result) == 5
        assert abs(result[0] - 0.1) < 1e-6
        assert abs(result[4] - 0.5) < 1e-6

    def test_overwrite_existing(self, tmp_path):
        cache = EmbeddingCache(str(tmp_path / "cache.db"))
        cache.set("key1", [0.1, 0.2])
        cache.set("key1", [0.9, 0.8])  # overwrite
        result = cache.get("key1")
        assert result is not None
        assert abs(result[0] - 0.9) < 1e-6

    def test_multiple_entries(self, tmp_path):
        cache = EmbeddingCache(str(tmp_path / "cache.db"))
        cache.set("h1", [1.0])
        cache.set("h2", [2.0])
        assert cache.get("h1") == [1.0]
        assert cache.get("h2") == [2.0]
        assert cache.get("h3") is None

    def test_default_path_does_not_crash(self):
        """EmbeddingCache without explicit path uses a temp file."""
        cache = EmbeddingCache()  # uses tempdir
        cache.set("test_default", [0.5])
        result = cache.get("test_default")
        assert result is not None


# ── RetrievalEngine ───────────────────────────────────────────────────────────────

class TestRetrievalEngineRuleOnly:
    """All tests run with ollama=None — pure rule-score fallback."""

    def _engine(self, tmp_path) -> RetrievalEngine:
        return RetrievalEngine(ollama=None, cache_path=str(tmp_path / "cache.db"))

    def test_returns_all_ids(self, tmp_path):
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        assert len(result) == len(BULLETS)
        result_ids = {b.id for b in result}
        expected_ids = {b[0] for b in BULLETS}
        assert result_ids == expected_ids

    def test_all_returned_ids_are_valid(self, tmp_path):
        engine = self._engine(tmp_path)
        valid_ids = {b[0] for b in BULLETS}
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        for sb in result:
            assert sb.id in valid_ids, f"Invalid ID returned: {sb.id!r}"

    def test_sorted_descending_by_score(self, tmp_path):
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        scores = [sb.score for sb in result]
        assert scores == sorted(scores, reverse=True), (
            f"Results not sorted descending: {scores}"
        )

    def test_80_pct_requirements_covered(self, tmp_path):
        """80%+ of TypeScript/React/Node.js/PostgreSQL requirements should be covered."""
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        covered = {sb.covered_requirement for sb in result if sb.covered_requirement}
        reqs_covered = sum(
            1 for r in REQUIREMENTS_TS
            if any(r.lower() in c.lower() for c in covered)
        )
        pct = reqs_covered / len(REQUIREMENTS_TS)
        assert pct >= 0.8, (
            f"Only {reqs_covered}/{len(REQUIREMENTS_TS)} ({pct:.0%}) requirements covered. "
            f"covered={covered}"
        )

    def test_testing_jd_coverage(self, tmp_path):
        """Jest and Playwright are in BULLETS[3] — should appear in covered_requirement."""
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TESTING)
        covered = {sb.covered_requirement for sb in result if sb.covered_requirement}
        has_jest = any("jest" in c.lower() for c in covered)
        has_playwright = any("playwright" in c.lower() for c in covered)
        assert has_jest or has_playwright, (
            f"Neither Jest nor Playwright covered. covered={covered}"
        )

    def test_java_jd_no_false_coverage(self, tmp_path):
        """Java/Spring Boot not in CV — no bullet should claim to cover them."""
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_JAVA)
        covered = {sb.covered_requirement.lower() for sb in result if sb.covered_requirement}
        java_found = any("java" in c or "spring" in c or "hibernate" in c for c in covered)
        assert not java_found, f"Unexpected Java/Spring coverage: {covered}"

    def test_deterministic_same_input(self, tmp_path):
        """Same input → same output every time."""
        engine = self._engine(tmp_path)
        r1 = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        r2 = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        assert [(b.id, b.score, b.covered_requirement) for b in r1] == \
               [(b.id, b.score, b.covered_requirement) for b in r2]

    def test_empty_bullets_returns_empty(self, tmp_path):
        engine = self._engine(tmp_path)
        result = engine.select_bullets([], REQUIREMENTS_TS)
        assert result == []

    def test_empty_requirements_all_scores_zero(self, tmp_path):
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, [])
        assert len(result) == len(BULLETS)
        for sb in result:
            assert sb.score == 0.0, f"Expected 0.0 score with no requirements, got {sb.score}"

    def test_result_type_is_select_bullet(self, tmp_path):
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS[:1], ["Node.js"])
        assert len(result) == 1
        sb = result[0]
        assert isinstance(sb, SelectBullet)
        assert isinstance(sb.id, str)
        assert isinstance(sb.score, float)
        assert isinstance(sb.covered_requirement, str)

    def test_scores_are_non_negative(self, tmp_path):
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        for sb in result:
            assert sb.score >= 0.0, f"Negative score for {sb.id}: {sb.score}"

    def test_scores_bounded(self, tmp_path):
        """Scores should be in [0, 1] when no embeddings are used."""
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, REQUIREMENTS_TS)
        for sb in result:
            assert 0.0 <= sb.score <= 1.0, f"Score out of [0,1]: {sb.id}={sb.score}"

    def test_embed_returns_none_without_ollama(self, tmp_path):
        engine = self._engine(tmp_path)
        vec = engine.embed("some text")
        assert vec is None

    def test_node_bullet_ranks_highly_for_node_jd(self, tmp_path):
        """BULLETS[1] (Node.js/Express) should rank above BULLETS[4] (mentoring) for Node.js JD."""
        engine = self._engine(tmp_path)
        result = engine.select_bullets(BULLETS, ["Node.js", "Express"])
        ids = [sb.id for sb in result]
        node_idx = ids.index("R1.2")  # Node.js/Express bullet
        mentor_idx = ids.index("R1.5")  # Mentoring bullet
        assert node_idx < mentor_idx, (
            f"Node.js bullet should rank above mentoring bullet: "
            f"node_idx={node_idx}, mentor_idx={mentor_idx}"
        )
