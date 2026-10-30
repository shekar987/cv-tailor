// "Referral asks" above the tracker sheet (31 Oct 2026, Chunk 6): every
// application whose referral is still to ask or asked and waiting, the one
// that has waited longest first (lib/referrals referralAsks). Each line says
// who to ask and the req ID they will need, with the next step as text
// links. Renders nothing when no ask is open.
//
// No next/* or @/ imports: tests/referralAsks renders it under node:test
// (tests/support/tsxLoader.mjs).
import { useState } from "react";
import {
  nextReferralSteps,
  referralAsks,
  REFERRAL_STATUSES,
  REFERRAL_STATUS_LABELS,
  MAX_REFERRER_NAME,
  MAX_REQ_ID,
  type ReferralFields,
  type ReferralRow,
  type ReferralStatus,
} from "../../lib/referrals.ts";

const STEP_LABELS: Record<ReferralStatus, string> = {
  to_ask: "Back to to ask",
  asked: "Mark asked",
  referred: "Referred",
  declined: "Declined",
};

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function ReferralAsks({
  rows,
  onStep,
  busyId = null,
}: {
  rows: readonly ReferralRow[];
  onStep: (row: ReferralRow, status: ReferralStatus) => void;
  busyId?: string | null;
}) {
  const asks = referralAsks(rows);
  if (asks.length === 0) return null;
  return (
    <section className="referralAsks" aria-labelledby="referral-asks-title" data-referral-asks>
      <h2 id="referral-asks-title" className="referralAsks__title">
        Referral asks <span className="referralAsks__count">{asks.length}</span>
      </h2>
      <ul className="referralAsks__list">
        {asks.map((row) => {
          const status = (row.referral_status ?? "to_ask") as ReferralStatus;
          return (
            <li key={row.id} className="referralAsks__item" data-referral-row={row.id} data-referral-status={status}>
              <span className="referralAsks__what">
                <strong>{row.company_name}</strong> · {row.role}
              </span>
              <span className="referralAsks__who">
                {row.referrer_name ? <>Ask {row.referrer_name}</> : <>Find someone who can refer you</>}
                {row.req_id ? <> · Req ID {row.req_id}</> : null}
                <> · Applied {formatDay(row.date_applied)}</>
              </span>
              <span className="referralAsks__status">{REFERRAL_STATUS_LABELS[status]}</span>
              <span className="referralAsks__actions">
                {nextReferralSteps(status).map((next) => (
                  <button
                    key={next}
                    type="button"
                    className="linkBtn"
                    data-referral-step={next}
                    disabled={busyId === row.id}
                    onClick={() => onStep(row, next)}
                  >
                    {STEP_LABELS[next]}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The row's referral, edited in its Notes panel: whether to ask, who, the
// req ID and where the ask stands. Saved with one PUT (lib/referrals
// validates it on the server).
export function ReferralEditor({
  row,
  onSave,
}: {
  row: ReferralRow;
  onSave: (fields: ReferralFields) => Promise<string | null>;
}) {
  const [referral, setReferral] = useState(row.referral === true);
  const [referrer, setReferrer] = useState(row.referrer_name ?? "");
  const [reqId, setReqId] = useState(row.req_id ?? "");
  const [status, setStatus] = useState<ReferralStatus>((row.referral_status as ReferralStatus | null) ?? "to_ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const message = await onSave({
      referral,
      referrer_name: referrer.trim() || null,
      req_id: reqId.trim() || null,
      referral_status: referral ? status : null,
    });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="referralEditor" data-referral-editor>
      <label className="referralEditor__toggle">
        <input type="checkbox" checked={referral} onChange={(e) => setReferral(e.target.checked)} disabled={busy} data-referral-toggle />
        Ask for a referral
      </label>
      {referral && (
        <div className="referralEditor__fields">
          <label>
            <span>Who could refer you</span>
            <input className="textInput" value={referrer} maxLength={MAX_REFERRER_NAME} onChange={(e) => setReferrer(e.target.value)} disabled={busy} data-referrer-name />
          </label>
          <label>
            <span>Req ID</span>
            <input className="textInput" value={reqId} maxLength={MAX_REQ_ID} onChange={(e) => setReqId(e.target.value)} disabled={busy} data-req-id />
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as ReferralStatus)} disabled={busy} data-referral-status-select>
              {REFERRAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REFERRAL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="referralEditor__actions">
        <button type="button" className="appsActionBtn" onClick={() => void save()} disabled={busy} data-referral-save>
          {busy ? "Saving…" : "Save referral"}
        </button>
        {error && (
          <span className="statusText" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
