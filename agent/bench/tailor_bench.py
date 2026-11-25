"""Local-model benchmark for the Professional Summary task (Chunk TL-1).

Runs a set of candidate open-weight models (ones that fit a 16 GB laptop, Q4
quantised) over a set of saved JDs, tailoring the summary from one master CV,
and records for each model:

  - tokens/sec (from Ollama's own eval_count / eval_duration)
  - time per summary (wall clock)
  - peak RAM while generating (resident memory of the ollama processes, via
    psutil if installed; otherwise the model size Ollama reports in /api/ps)
  - JSON-validity rate (did `format` mode return parseable JSON every time)
  - honesty rate (did every number in the summary exist in the master CV)

Writes a markdown table to agent/bench/results-2026-11-19.md and prints a
recommended default.

Usage (Ollama must be running, models pulled):

    python -m agent.bench.tailor_bench
    python -m agent.bench.tailor_bench --models qwen2.5:7b-instruct-q4_K_M llama3.1:8b-instruct-q4_K_M
    python -m agent.bench.tailor_bench --host http://127.0.0.1:11434

Nothing here calls a paid API; it only talks to local Ollama.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

# Allow `python agent/bench/tailor_bench.py` as well as `-m`.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agent.worker.ollama_client import OllamaClient, OllamaError  # noqa: E402
from agent.worker.tailor import (  # noqa: E402
    SUMMARY_SCHEMA,
    clean_summary,
    summary_from_raw,
    summary_numbers_supported,
    summary_system_prompt,
    summary_user_prompt,
)

HERE = Path(__file__).resolve().parent
DEFAULT_MODELS = [
    "qwen2.5:7b-instruct-q4_K_M",
    "llama3.1:8b-instruct-q4_K_M",
    "gemma2:9b-instruct-q4_K_M",
]
RESULTS_FILE = HERE / "results-2026-11-19.md"

try:
    import psutil  # type: ignore

    HAVE_PSUTIL = True
except Exception:
    HAVE_PSUTIL = False


def load_jds() -> list[tuple[str, str]]:
    jd_dir = HERE / "jds"
    out: list[tuple[str, str]] = []
    for path in sorted(jd_dir.glob("*.txt")):
        out.append((path.name, path.read_text(encoding="utf-8")))
    return out


def ollama_rss_mb() -> float:
    """Resident memory of the ollama processes, in MB (0 if psutil absent)."""
    if not HAVE_PSUTIL:
        return 0.0
    total = 0
    for proc in psutil.process_iter(["name", "memory_info"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if "ollama" in name:
                total += proc.info["memory_info"].rss
        except Exception:
            continue
    return total / (1024 * 1024)


def model_vram_mb(client: OllamaClient, model: str) -> float:
    for m in client.running_models():
        if m.get("name", "").startswith(model.split(":")[0]):
            size = m.get("size") or m.get("size_vram") or 0
            return float(size) / (1024 * 1024)
    return 0.0


def bench_model(client: OllamaClient, model: str, master_cv: str, jds: list[tuple[str, str]]) -> dict:
    tok_rates: list[float] = []
    times: list[float] = []
    peak_rss = 0.0
    json_valid = 0
    honest = 0
    runs = 0
    notes: list[str] = []

    for jd_name, jd_text in jds:
        runs += 1
        start = time.time()
        try:
            res = client.chat(
                model,
                summary_system_prompt(),
                summary_user_prompt(jd_text, master_cv),
                temperature=0.2,
                num_predict=512,
                fmt=SUMMARY_SCHEMA,
            )
        except OllamaError as exc:
            notes.append(f"{jd_name}: {exc}")
            continue
        elapsed = time.time() - start
        times.append(elapsed)
        if res.tokens_per_sec:
            tok_rates.append(res.tokens_per_sec)
        peak_rss = max(peak_rss, ollama_rss_mb(), model_vram_mb(client, model))

        # JSON validity: did `format` mode return something we can parse?
        valid = False
        try:
            json.loads(res.content)
            valid = True
        except Exception:
            valid = bool(summary_from_raw(res.content))
        if valid:
            json_valid += 1

        summary = clean_summary(summary_from_raw(res.content))
        ok, unsupported = summary_numbers_supported(summary, master_cv)
        if ok:
            honest += 1
        else:
            notes.append(f"{jd_name}: unsupported numbers {unsupported}")

    return {
        "model": model,
        "runs": runs,
        "tokens_per_sec": round(statistics.mean(tok_rates), 1) if tok_rates else 0.0,
        "time_per_summary": round(statistics.mean(times), 1) if times else 0.0,
        "peak_rss_mb": round(peak_rss),
        "json_rate": f"{json_valid}/{runs}",
        "honesty_rate": f"{honest}/{runs}",
        "notes": notes,
    }


def recommend(results: list[dict]) -> str:
    """Pick a default: the fastest model that was 100% JSON-valid and honest."""
    clean = [
        r
        for r in results
        if r["runs"] > 0
        and r["json_rate"] == f"{r['runs']}/{r['runs']}"
        and r["honesty_rate"] == f"{r['runs']}/{r['runs']}"
    ]
    pool = clean or [r for r in results if r["runs"] > 0]
    if not pool:
        return "No model completed a run — is Ollama running and are the models pulled?"
    best = max(pool, key=lambda r: r["tokens_per_sec"])
    why = "fastest model that returned valid JSON and invented no numbers" if clean else "only model that produced output"
    return f"**{best['model']}** — {why} ({best['tokens_per_sec']} tok/s, {best['time_per_summary']}s per summary, honesty {best['honesty_rate']})."


def write_results(host: str, results: list[dict], hardware: str) -> None:
    lines = [
        "# TL-1 local-model benchmark — Professional Summary",
        "",
        f"_Measured {time.strftime('%Y-%m-%d %H:%M')} on {hardware} against Ollama at {host}._",
        "",
        "Task: tailor the 3-line Professional Summary for 3 saved JDs from one master CV",
        "(`agent/bench/master_cv.txt`, `agent/bench/jds/`). JSON mode via Ollama `format`.",
        "",
        "| Model | tok/s | s/summary | peak RAM (MB) | JSON valid | honest (no invented number) |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        lines.append(
            f"| `{r['model']}` | {r['tokens_per_sec']} | {r['time_per_summary']} | "
            f"{r['peak_rss_mb'] or 'n/a'} | {r['json_rate']} | {r['honesty_rate']} |"
        )
    lines += ["", "## Recommended default", "", recommend(results), ""]
    notes = [n for r in results for n in r.get("notes", [])]
    if notes:
        lines += ["## Notes", ""] + [f"- {n}" for n in notes] + [""]
    if not HAVE_PSUTIL:
        lines += ["_psutil not installed, so peak RAM is from Ollama's /api/ps model size, not full RSS._", ""]
    RESULTS_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWrote {RESULTS_FILE}")


def bench_selection(host: str = "http://127.0.0.1:11434") -> dict:
    """TL-4: benchmark the retrieval / selection path.

    Runs RetrievalEngine.select_bullets over the bench CV and 10 fictional
    JDs (a subset of the selection test suite). No chat model needed; the
    embedding model (nomic-embed-text) is optional — when absent the engine
    falls back to pure rule scores and the result is marked PROJECTED.

    Returns a summary dict with keys: model, runs, coverage_80pct,
    avg_coverage, latency_ms, notes.
    """
    from agent.worker.retrieval import RetrievalEngine

    # Fictional bullets from the selection test suite (fictional Alex Tester).
    bullets = [
        ("R1.1", "Rebuilt the logistics dashboard in TypeScript used by 40 depots, cutting load time by 35%."),
        ("R1.2", "Built a REST API in Node.js and Express serving 1.2 million requests a day."),
        ("R1.3", "Shipped to AWS on ECS and RDS Postgres with GitHub Actions CI."),
        ("R1.4", "Added Jest and Playwright test suites, taking coverage from 20% to 85%."),
        ("R1.5", "Mentored 2 junior developers through weekly code reviews."),
        ("R2.1", "Built internal React tools used by 15 staff."),
        ("R2.2", "Wrote SQL reports over a PostgreSQL warehouse."),
    ]
    jds = [
        ["TypeScript", "React", "Node.js", "PostgreSQL"],
        ["Jest", "Playwright", "testing", "test coverage"],
        ["AWS", "Docker", "GitHub Actions", "CI/CD"],
        ["REST API", "Node.js", "Express"],
        ["React", "frontend", "JavaScript"],
        ["PostgreSQL", "SQL", "database"],
        ["Python", "FastAPI", "API development"],
        ["Node.js", "TypeScript", "testing"],
    ]

    ollama: OllamaClient | None = None
    model_label = "rule-only (no Ollama)"
    try:
        client = OllamaClient(host)
        # Quick reachability check: list models
        client._post("/api/tags", {})
        from agent.worker.retrieval import DEFAULT_EMBED_MODEL
        model_label = DEFAULT_EMBED_MODEL
        ollama = client
    except Exception:
        pass  # No Ollama available — rule-score fallback

    engine = RetrievalEngine(ollama=ollama)
    runs_above_80 = 0
    coverages: list[float] = []
    latencies_ms: list[float] = []

    for reqs in jds:
        t0 = time.time()
        scored = engine.select_bullets(bullets, reqs)
        latencies_ms.append((time.time() - t0) * 1000)
        # Coverage: fraction of requirements that appear in some bullet's covered_requirement
        covered = {sb.covered_requirement.lower() for sb in scored if sb.covered_requirement}
        pct = sum(1 for r in reqs if any(r.lower() in c for c in covered)) / len(reqs)
        coverages.append(pct)
        if pct >= 0.8:
            runs_above_80 += 1

    avg_cov = round(sum(coverages) / len(coverages), 3) if coverages else 0.0
    avg_lat = round(sum(latencies_ms) / len(latencies_ms), 1) if latencies_ms else 0.0

    notes = []
    if ollama is None:
        notes.append("PROJECTED — no Ollama available, rule-score fallback only. "
                     "Re-run with nomic-embed-text pulled for real embedding numbers.")

    return {
        "model": model_label,
        "runs": len(jds),
        "coverage_80pct": f"{runs_above_80}/{len(jds)}",
        "avg_coverage": avg_cov,
        "latency_ms": avg_lat,
        "notes": notes,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Benchmark local models for the summary task.")
    ap.add_argument("--models", nargs="*", default=DEFAULT_MODELS)
    ap.add_argument("--host", default=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"))
    ap.add_argument("--hardware", default=os.environ.get("BENCH_HARDWARE", "this PC"))
    ap.add_argument("--selection", action="store_true", help="Run the TL-4 selection benchmark instead.")
    args = ap.parse_args()

    if args.selection:
        print("TL-4 selection benchmark …")
        r = bench_selection(args.host)
        print(f"model={r['model']} · runs={r['runs']} · "
              f"≥80% coverage: {r['coverage_80pct']} · avg {r['avg_coverage']:.1%} · {r['latency_ms']}ms/JD")
        for n in r.get("notes", []):
            print(f"  NOTE: {n}")
        return

    client = OllamaClient(args.host)
    master_cv = (HERE / "master_cv.txt").read_text(encoding="utf-8")
    jds = load_jds()
    print(f"Benchmarking {len(args.models)} models over {len(jds)} JDs on {args.host}\n")

    results: list[dict] = []
    for model in args.models:
        print(f"→ {model} …")
        try:
            r = bench_model(client, model, master_cv, jds)
        except OllamaError as exc:
            print(f"   skipped: {exc}")
            r = {
                "model": model, "runs": 0, "tokens_per_sec": 0.0, "time_per_summary": 0.0,
                "peak_rss_mb": 0, "json_rate": "0/0", "honesty_rate": "0/0", "notes": [str(exc)],
            }
        print(f"   {r['tokens_per_sec']} tok/s · {r['time_per_summary']}s · JSON {r['json_rate']} · honest {r['honesty_rate']}")
        results.append(r)

    write_results(args.host, results, args.hardware)
    print("\nRecommended default: " + recommend(results))


if __name__ == "__main__":
    main()
