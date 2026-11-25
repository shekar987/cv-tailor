"use client";

// The "Local (£0)" comparison (Chunk TL-1). Shows the Professional Summary the
// free open-weight model on your own PC wrote, side by side with the paid one,
// so you can judge the quality for yourself. Presentational only — the panel
// (LocalTailorPanel) owns the queue state and passes results in here.

export type LocalSummaryState = {
  summary: string;
  model?: string | null;
  tokensPerSec?: number | null;
  numbersOk?: boolean;
  unsupportedNumbers?: string[];
};

export type LocalCompareStatus =
  | "idle"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "needs_migration";

export default function LocalSummaryCompare({
  paidSummary,
  local,
  status,
  savedGbp,
  error,
}: {
  paidSummary: string;
  local: LocalSummaryState | null;
  status: LocalCompareStatus;
  savedGbp?: number | null;
  error?: string;
}) {
  return (
    <div className="localCompare" data-local-compare data-status={status}>
      <div className="localCompare__col">
        <div className="localCompare__head">
          <span className="localCompare__tag localCompare__tag--paid">Premium (your key)</span>
        </div>
        <p className="localCompare__summary" data-paid-summary>
          {paidSummary || <span className="cvHelp">No summary yet.</span>}
        </p>
      </div>

      <div className="localCompare__col">
        <div className="localCompare__head">
          <span className="localCompare__tag localCompare__tag--local" data-local-badge>
            Local (£0)
          </span>
          {local?.model && <span className="localCompare__model">{local.model}</span>}
        </div>

        {status === "done" && local ? (
          <>
            <p className="localCompare__summary" data-local-summary>
              {local.summary || <span className="cvHelp">The model returned nothing.</span>}
            </p>
            <p
              className={local.numbersOk === false ? "localCompare__honesty localCompare__honesty--warn" : "localCompare__honesty localCompare__honesty--ok"}
              data-honesty={local.numbersOk === false ? "warn" : "ok"}
            >
              {local.numbersOk === false
                ? `⚠ Not in your CV: ${(local.unsupportedNumbers ?? []).join(", ")}`
                : "✓ Every number traces to your CV"}
            </p>
            <p className="localCompare__meta cvHelp">
              {typeof local.tokensPerSec === "number" && local.tokensPerSec > 0
                ? `${local.tokensPerSec.toFixed(1)} tokens/sec · `
                : ""}
              £0 this run{typeof savedGbp === "number" && savedGbp > 0 ? ` · £${savedGbp.toFixed(2)} saved so far` : ""}
            </p>
          </>
        ) : status === "failed" ? (
          <p className="localCompare__honesty localCompare__honesty--warn" data-local-error>
            {error || "The local run failed."}
          </p>
        ) : status === "needs_migration" ? (
          <p className="cvHelp" data-local-pending>
            Local tailoring isn&apos;t switched on for this account yet — the database update is still to be applied.
          </p>
        ) : status === "queued" || status === "processing" ? (
          <p className="cvHelp" data-local-pending>
            {status === "processing"
              ? "Your PC is writing it…"
              : "Queued — waiting for the worker on your PC to pick it up. Connect a device on the Auto-apply page."}
          </p>
        ) : (
          <p className="cvHelp" data-local-pending>
            Run the summary on your own PC for £0 to compare.
          </p>
        )}
      </div>
    </div>
  );
}
