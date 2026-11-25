"""The Jobhuntz Local Tailor worker (Chunk TL-1) — minimal stub.

Loop: claim this device's next queued tailor job, run the summary on the local
open-weight model through Ollama, and write the JSON result back. £0 per run.
The website never calls Ollama — this worker does, on the user's own PC.

This is the minimal stub the chunk calls for; the full /agent Python project
(Chunk 34) will fold it in alongside the apply worker. Run it with:

    JOBHUNTZ_SUPABASE_URL=...  JOBHUNTZ_SUPABASE_KEY=sb_publishable_...  \
    JOBHUNTZ_DEVICE_TOKEN=...  OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M   \
    python -m agent.worker.tailor_worker

See agent/README.md for the full setup.
"""

from __future__ import annotations

import time

from .config import Config
from .ollama_client import OllamaClient, OllamaError
from .supabase_client import SupabaseClient, SupabaseError
from .tailor import (
    SUMMARY_SCHEMA,
    clean_summary,
    summary_from_raw,
    summary_numbers_supported,
    summary_system_prompt,
    summary_user_prompt,
)


def run_one(cfg: Config, sb: SupabaseClient, ollama: OllamaClient, job: dict) -> None:
    job_id = job["id"]
    job_input = job.get("input") or {}
    jd_text = job_input.get("jd_text", "")
    master_cv = job_input.get("master_cv", "")
    print(f"[tailor] claimed job {job_id} (kind={job.get('kind')})")

    try:
        sb.complete_tailor_job(job_id, "processing")
        result = ollama.chat(
            cfg.model,
            summary_system_prompt(),
            summary_user_prompt(jd_text, master_cv),
            temperature=cfg.temperature,
            num_predict=512,
            fmt=SUMMARY_SCHEMA,
        )
        summary = clean_summary(summary_from_raw(result.content))
        if not summary:
            sb.complete_tailor_job(job_id, "failed", model=cfg.model, error="The model returned an empty summary.")
            print(f"[tailor] job {job_id} produced nothing")
            return

        ok, unsupported = summary_numbers_supported(summary, master_cv)
        # The website recomputes this honesty verdict itself; we send the summary
        # and a hint, never a trusted verdict.
        output = {
            "summary": summary,
            "numbersOk": ok,
            "unsupportedNumbers": unsupported,
        }
        sb.complete_tailor_job(
            job_id,
            "done",
            output=output,
            model=cfg.model,
            tokens_per_sec=round(result.tokens_per_sec, 2) or None,
        )
        flag = "ok" if ok else f"UNSUPPORTED {unsupported}"
        print(f"[tailor] job {job_id} done · {result.tokens_per_sec:.1f} tok/s · numbers {flag}")
    except OllamaError as exc:
        sb.complete_tailor_job(job_id, "failed", model=cfg.model, error=str(exc)[:500])
        print(f"[tailor] job {job_id} failed (ollama): {exc}")
    except SupabaseError as exc:
        # Can't report back — just log and move on; the job's heartbeat going
        # stale lets the website show it as stuck.
        print(f"[tailor] job {job_id} report failed (supabase): {exc}")


def main() -> None:
    cfg = Config.from_env()
    sb = SupabaseClient(cfg.supabase_url, cfg.supabase_key, cfg.device_token)
    ollama = OllamaClient(cfg.ollama_host)
    print(f"[tailor] worker up · model={cfg.model} · ollama={cfg.ollama_host} · polling every {cfg.poll_seconds}s")
    while True:
        try:
            job = sb.claim_next_tailor_job()
        except SupabaseError as exc:
            print(f"[tailor] claim failed: {exc}")
            job = None
        if job:
            run_one(cfg, sb, ollama, job)
            continue  # drain the queue before sleeping
        time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[tailor] stopped")
