// A row's flags under its company name (3 Nov 2026): "Missing JD" / "Missing
// CV" on a row in Screening or Interview, "Not checked" with the action that
// checks it on a row made outside /app, and the triage's verdict once there is
// one. Since 12 Nov 2026 (Chunk 22) also "Logged by Claude sweep" on a row an
// automation logged for the user (lib/applicationFields loggedByBadge; the user's
// own rows carry none). Nothing here blocks. Renders nothing when a row has
// nothing to say.
//
// No next/* or @/ imports: tests/rowFlags renders it under node:test
// (tests/support/tsxLoader.mjs).
import { missingAttachments, rowCheck, type RowFlagFields } from "../../lib/tracker.ts";
import { TRIAGE_LABELS } from "../../lib/triage/jdTriage.ts";
import { loggedByBadge } from "../../lib/applicationFields.ts";

export default function RowFlags({
  row,
  checking,
  onRunCheck,
  onAddJd,
  quiet = false,
  showMissing = true,
}: {
  row: RowFlagFields & { company_name: string; logged_by?: string | null };
  checking: boolean;
  onRunCheck: () => void;
  onAddJd: () => void;
  // The list view says only what needs a look: a Review or Skip. Run check is in the row's menu.
  quiet?: boolean;
  showMissing?: boolean;
}) {
  const missing = showMissing ? missingAttachments(row) : [];
  const read = rowCheck(row);
  const check = quiet && (read?.kind !== "checked" || read.verdict === "apply") ? null : read;
  const loggedBy = loggedByBadge(row.logged_by);
  if (!missing.length && !check && !loggedBy) return null;
  return (
    <span className="rowFlags" data-row-flags="true">
      {loggedBy && (
        <span className="rowFlag" data-logged-by={row.logged_by ?? ""} title={`${loggedBy} through the API, not by you on this page`}>
          {loggedBy}
        </span>
      )}
      {missing.map((m) => (
        <span key={m} className="rowFlag rowFlag--missing" data-missing={m}>{m}</span>
      ))}
      {check?.kind === "checked" && (
        <span
          className={`rowFlag rowFlag--${check.verdict}`}
          data-row-triage={check.verdict}
          title={check.reasons.join("; ") || undefined}
        >
          {/* The column is narrow: "Skip: Go", with the note on hover and in the JD panel. */}
          {TRIAGE_LABELS[check.verdict]}{check.reasons[0] ? `: ${check.reasons[0].replace(/\s*\(.*$/, "")}` : ""}
        </span>
      )}
      {(check?.kind === "run" || check?.kind === "add_jd") && (
        <span className="rowFlag" data-not-checked="true">Not checked</span>
      )}
      {check?.kind === "run" && (
        <button type="button" className="inlineLink" onClick={onRunCheck} disabled={checking} aria-label={`Run check on ${row.company_name}`} data-run-check="true">
          {checking ? "Checking…" : "Run check"}
        </button>
      )}
      {check?.kind === "add_jd" && (
        <button type="button" className="inlineLink" onClick={onAddJd} aria-label={`Add a job description to check ${row.company_name}`} data-add-jd-check="true">
          Add JD to check
        </button>
      )}
    </span>
  );
}
