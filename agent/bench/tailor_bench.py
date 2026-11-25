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


def main() -> None:
    ap = argparse.ArgumentParser(description="Benchmark local models for the summary task.")
    ap.add_argument("--models", nargs="*", default=DEFAULT_MODELS)
    ap.add_argument("--host", default=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"))
    ap.add_argument("--hardware", default=os.environ.get("BENCH_HARDWARE", "this PC"))
    args = ap.parse_args()

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
