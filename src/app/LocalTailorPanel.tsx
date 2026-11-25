"use client";

// The "Local (£0)" panel on /app (Chunk TL-1). Beside the paid tailored result,
// it offers to run the Professional Summary on the free open-weight model on the
// user's own PC and show it for comparison. It only queues the job and polls the
// result — the website never calls Ollama; the PC worker does, through the
// device-token queue (tailor_jobs).

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import LocalSummaryCompare, { type LocalCompareStatus, type LocalSummaryState } from "./LocalSummaryCompare";

const POLL_MS = 2500;
const MAX_POLLS = 160; // ~6.5 minutes before we stop polling a stuck job.

export default function LocalTailorPanel({
  jobDescription,
  paidSummary,
}: {
  jobDescription: string;
  paidSummary: string;
}) {
  const [status, setStatus] = useState<LocalCompareStatus>("idle");
  const [local, setLocal] = useState<LocalSummaryState | null>(null);
  const [savedGbp, setSavedGbp] = useState<number | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polls = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const poll = useCallback(
    async (id: string) => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        setStatus("failed");
        setError("The local run is taking too long — check the worker on your PC.");
        return;
      }
      try {
        const res = await fetch(`/api/tailor-jobs?id=${encodeURIComponent(id)}`);
        const data = await res.json().catch(() => ({}));
        if (res.status === 503) {
          setStatus("needs_migration");
          return;
        }
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || "Couldn't read the local run.");
          return;
        }
        const job = data.job as { status: string; model?: string | null; tokensPerSec?: number | null; lastError?: string } | undefined;
        if (!job) return;
        if (job.status === "done") {
          const r = data.summaryResult as { summary: string; numbersOk?: boolean; unsupportedNumbers?: string[] } | null;
          setLocal({
            summary: r?.summary ?? "",
            model: job.model ?? null,
            tokensPerSec: job.tokensPerSec ?? null,
            numbersOk: r?.numbersOk,
            unsupportedNumbers: r?.unsupportedNumbers,
          });
          setStatus("done");
          // Refresh the running £-saved total.
          fetch("/api/tailor-jobs")
            .then((r2) => r2.json())
            .then((d) => typeof d.savedGbp === "number" && setSavedGbp(d.savedGbp))
            .catch(() => {});
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          setStatus("failed");
          setError(job.lastError || "The local run failed.");
          return;
        }
        setStatus(job.status === "processing" ? "processing" : "queued");
        timer.current = setTimeout(() => poll(id), POLL_MS);
      } catch {
        timer.current = setTimeout(() => poll(id), POLL_MS);
      }
    },
    []
  );

  async function run() {
    if (!jobDescription.trim()) return;
    stop();
    polls.current = 0;
    setLocal(null);
    setError("");
    setStatus("queued");
    try {
      const res = await fetch("/api/tailor-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jdText: jobDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.error === "needs_migration") {
        setStatus("needs_migration");
        return;
      }
      if (!res.ok) {
        setStatus("failed");
        setError(data.error || "Couldn't queue the local tailor.");
        return;
      }
      const id = data.job?.id as string | undefined;
      if (!id) {
        setStatus("failed");
        setError("No job id came back.");
        return;
      }
      timer.current = setTimeout(() => poll(id), POLL_MS);
    } catch {
      setStatus("failed");
      setError("Couldn't reach the server. Try again.");
    }
  }

  const running = status === "queued" || status === "processing";

  return (
    <div className="localTailor" data-local-tailor>
      <div className="localTailor__bar">
        <div>
          <p className="localTailor__title">Compare with Local (£0)</p>
          <p className="cvHelp">
            Run the summary on the free model on your own PC and see it beside the paid one. No key, no per-CV cost.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={run} disabled={running || !jobDescription.trim()}>
          {running ? "Running on your PC…" : status === "done" ? "Run again (£0)" : "Tailor the summary locally (£0)"}
        </Button>
      </div>

      {status !== "idle" && (
        <LocalSummaryCompare
          paidSummary={paidSummary}
          local={local}
          status={status}
          savedGbp={savedGbp}
          error={error}
        />
      )}
    </div>
  );
}
