# Jobhuntz local agent (Chunk TL-1)

The free, £0-per-run tailor: a worker on **your own PC** that reads jobs from the
Jobhuntz queue, runs an open-weight model through [Ollama](https://ollama.com),
and writes the result back. The website never calls Ollama — only this worker
does. Your CV text never leaves your machine beyond the Supabase row the website
already stored.

This is the minimal **summary** worker for TL-1 (it tailors the Professional
Summary). Later TL chunks and the Chunk 34 `/agent` project fold in the rest.

## One-time setup

1. **Install Ollama** and start it: <https://ollama.com> then `ollama serve`.
2. **Pull a model** (see the benchmark for which):
   ```
   ollama pull qwen2.5:7b-instruct-q4_K_M
   ```
3. **Apply the database migration** (owner, once): paste
   `supabase/migrations/20261125120000_tailor_jobs.sql` into the Supabase SQL
   editor. It depends on the Chunk 33 queue migration being applied first.
4. **Connect a device** in Jobhuntz → Auto-apply → "Connect a device", and copy
   the one-time token.
5. **(Optional) for the benchmark only:** `pip install -r agent/requirements.txt`.

## Run the worker

From the repo root:

```bash
export JOBHUNTZ_SUPABASE_URL="https://<project-ref>.supabase.co"
export JOBHUNTZ_SUPABASE_KEY="sb_publishable_..."   # the publishable key (safe to ship)
export JOBHUNTZ_DEVICE_TOKEN="<the token from step 4>"
export OLLAMA_MODEL="qwen2.5:7b-instruct-q4_K_M"     # optional; this is the default
python -m agent.worker.tailor_worker
```

On Windows PowerShell use `$env:JOBHUNTZ_SUPABASE_URL = "..."` etc.

The worker polls for queued tailor jobs, runs the summary locally, and reports
`done` (or `failed`) back. In Jobhuntz, the Tailor page shows the local summary
beside the paid one with a **Local (£0)** badge, and the honesty check — every
number in the summary must appear in your master CV — runs on the website.

## Run the benchmark

With Ollama running and the candidate models pulled:

```bash
python -m agent.bench.tailor_bench
# or a subset:
python -m agent.bench.tailor_bench --models qwen2.5:7b-instruct-q4_K_M llama3.1:8b-instruct-q4_K_M
```

It tailors the summary for the 3 saved JDs in `agent/bench/jds/` from
`agent/bench/master_cv.txt`, records tokens/sec, time, peak RAM, JSON-validity
rate and the honesty rate, writes the table to
`agent/bench/results-2026-11-19.md`, and prints a recommended default.

## Layout

```
agent/
  worker/
    config.py          env-var config (no secret hard-coded)
    ollama_client.py   tiny Ollama HTTP client (stdlib only)
    supabase_client.py the device-token RPCs over PostgREST (stdlib only)
    tailor.py          the summary prompt + honesty number check (mirrors src/lib/tailorJobs.ts)
    tailor_worker.py   the claim → run → report loop
  bench/
    tailor_bench.py    the model benchmark
    master_cv.txt      fictional Alex Tester CV
    jds/               three saved JDs
    results-2026-11-19.md
```
