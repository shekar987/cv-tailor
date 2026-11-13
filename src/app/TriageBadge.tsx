// The JD triage badge (1 Nov 2026, Chunk 8): "Skip: 5+ years", "Review:
// Java", "Apply" — lib/triage/jdTriage read off the posting — with the
// sentences each reason was read from below it, open by default. Shown in /app's
// job-description card (live, as the posting is pasted or imported) and in
// the tracker's JD panel (as stored on the row).
//
// No next/* or @/ imports: tests/jdTriage renders it under node:test
// (tests/support/tsxLoader.mjs).
import { TRIAGE_LABELS, TRIAGE_RULE_LABELS, type JdTriage } from "../lib/triage/jdTriage.ts";

const APPLY_NOTE = "Nothing in this job description rules you out. We checked years of experience, security clearance, right to work, contract type and programming languages.";
// A company's own rule or the user's tracker (lib/companyRules) is not the posting speaking.
const COMPANY_RULES = new Set(["company_cooldown", "company_closed", "same_role", "same_role_before"]);

export default function TriageBadge({ triage }: { triage: JdTriage | null }) {
  if (!triage) return null;
  const { verdict, reasons, hits } = triage;
  return (
    <div className={`triage triage--${verdict}`} data-triage={verdict}>
      <p className="triage__line" role="status">
        <span className="triage__label">Job check</span>{" "}
        <span className="triage__verdict">{TRIAGE_LABELS[verdict]}{reasons.length ? ":" : ""}</span>
        {reasons.length > 0 ? <span className="triage__reasons" data-triage-reasons="true"> {reasons.join("; ")}</span> : <span className="triage__note"> {APPLY_NOTE}</span>}
      </p>
      {hits.length > 0 && (
        <details className="triage__where" open>
          <summary>{hits.some((h) => COMPANY_RULES.has(h.rule)) ? "Where each reason comes from" : "Where the job description says so"}</summary>
          <ul>
            {hits.map((h, i) => (
              <li key={i} data-triage-rule={h.rule} data-triage-level={h.level}>
                <strong>{TRIAGE_RULE_LABELS[h.rule]}{h.level === "review" ? " (review)" : ""}:</strong> &ldquo;{h.sentence}&rdquo;
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
