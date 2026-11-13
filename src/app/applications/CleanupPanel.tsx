"use client";

// The tracker clean-up's panel on /applications (6 Nov 2026, Chunk 19), owner only.
// It opens on the dry run (nothing is changed by opening it), lists what each
// rule would do, and applies only the rows ticked here, after a confirm that says
// what is irreversible. Every rule and guard is lib/trackerCleanup's; the server
// re-decides each ticked row before writing it.
import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/formatDate";
import { trackedFetch } from "@/lib/writeTracker";
import { statusLabel } from "@/lib/tracker";
import type { ConfirmOptions } from "@/lib/confirm";
import { CLEANUP_APPLY_CHUNK, CADENCE_DAYS, READY_STALE_DAYS, cleanupRequestBody, type CleanupPlan, type RuleCItem } from "@/lib/trackerCleanup";

type ApplyResult = { applied: { id: string; rule: "A" | "B" }[]; skipped: { id: string; reason: string }[]; warnings: { id: string; reason: string }[] };

async function post(body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await trackedFetch("/api/applications/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, data: { error: "Connection error. Please try again." } };
  }
}

function ReportList({ title, items, note }: { title: string; items: RuleCItem[]; note: string }) {
  return (
    <details className="cleanupReport" data-cleanup-report>
      <summary>
        {title} <span className="cleanupCount">{items.length}</span>
      </summary>
      <p className="cvHelp">{note}</p>
      <ul className="cleanupList">
        {items.map((i) => (
          <li key={i.id} className="cleanupItem">
            <span><strong>{i.company_name}</strong> — {i.role || "no role"}</span>
            <span className="cleanupMeta">{statusLabel(i.status)} · {formatDate(i.date_applied)}{i.days !== undefined ? ` · ${i.days} days` : ""}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function CleanupPanel({
  onClose,
  onApplied,
  confirm,
}: {
  onClose: () => void;
  onApplied: () => Promise<void> | void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}) {
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [error, setError] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    post(cleanupRequestBody(true)).then(({ ok, data }) => {
      if (cancelled) return;
      if (!ok) {
        setError(typeof data.error === "string" ? data.error : "The dry run failed.");
        return;
      }
      setPlan(data.plan as CleanupPlan);
      setTicked(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [round]);

  const mergeable = useMemo(() => (plan ? plan.ruleB.flatMap((g) => g.duplicates.filter((d) => !d.blocked).map((d) => ({ g, d }))) : []), [plan]);
  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allA = plan ? plan.ruleA.every((a) => ticked.has(a.id)) : false;
  const tickedA = plan ? plan.ruleA.filter((a) => ticked.has(a.id)).length : 0;
  const tickedB = mergeable.filter(({ d }) => ticked.has(d.id)).length;

  async function apply() {
    if (!plan || ticked.size === 0) return;
    const parts = [
      tickedA ? `clear the follow-up date on ${tickedA} row${tickedA === 1 ? "" : "s"} (the status stays Applied)` : "",
      tickedB ? `merge ${tickedB} duplicate${tickedB === 1 ? "" : "s"} into the row kept and delete ${tickedB === 1 ? "it" : "them"}` : "",
    ].filter(Boolean);
    const ok = await confirm({
      title: "Apply the clean-up?",
      message: `This will ${parts.join(", and ")}.${tickedB ? " A deleted row cannot be restored; its notes are kept on the row it merged into." : ""}`,
      confirmLabel: `Apply ${ticked.size}`,
      danger: tickedB > 0,
    });
    if (!ok) return;
    setApplying(true);
    setError("");
    // In chunks, so no one request runs long enough to time out half done; each chunk is
    // re-decided on the server, and a refusal stops the rest.
    const ids = [...ticked];
    const total: ApplyResult = { applied: [], skipped: [], warnings: [] };
    for (let i = 0; i < ids.length; i += CLEANUP_APPLY_CHUNK) {
      const { ok: done, status, data } = await post(cleanupRequestBody(false, ids.slice(i, i + CLEANUP_APPLY_CHUNK)));
      if (!done) {
        const done_ = total.applied.length ? ` ${total.applied.length} were applied before it stopped.` : "";
        setError((status === 409 ? String(data.error ?? "Some of those rows are at Screening or later; nothing in that batch was applied.") : String(data.error ?? "The clean-up failed.")) + done_);
        break;
      }
      const part = data as unknown as ApplyResult;
      total.applied.push(...(part.applied ?? []));
      total.skipped.push(...(part.skipped ?? []));
      total.warnings.push(...(part.warnings ?? []));
    }
    setApplying(false);
    setResult(total);
    await onApplied();
    setRound((r) => r + 1);
  }

  return (
    <Card className="cleanupPanel" data-cleanup aria-labelledby="cleanup-title">
      <div className="cleanupHead">
        <h2 id="cleanup-title" className="label">Clean-up · dry run</h2>
        <button type="button" className="linkBtn" onClick={onClose} data-cleanup-close>Close</button>
      </div>
      <p className="cvHelp">
        Nothing has changed. Tick what to apply; everything else stays exactly as it is. Rows at Screening or later are never touched.
      </p>
      {error && <p role="alert" className="keyError">{error}</p>}
      {result && (
        <p role="status" className="cleanupResult" data-cleanup-result>
          Applied {result.applied.length}.{result.skipped.length ? ` Skipped ${result.skipped.length}: ${[...new Set(result.skipped.map((s) => s.reason))].join("; ")}.` : ""}
          {result.warnings.length ? ` Check ${result.warnings.length}: ${[...new Set(result.warnings.map((s) => s.reason))].join("; ")}.` : ""}
        </p>
      )}
      {!plan && !error && <Skeleton lines={4} label="Reading your applications list" />}
      {plan && (
        <>
          <section className="cleanupSection" data-cleanup-rule="A">
            <div className="cleanupSectionHead">
              <h3 className="cleanupTitle">Close finished cadences <span className="cleanupCount">{plan.ruleA.length}</span></h3>
              {plan.ruleA.length > 0 && (
                <button
                  type="button"
                  className="linkBtn"
                  onClick={() => setTicked((t) => {
                    const next = new Set(t);
                    for (const a of plan.ruleA) {
                      if (allA) next.delete(a.id);
                      else next.add(a.id);
                    }
                    return next;
                  })}
                >
                  {allA ? "Untick all" : "Tick all"}
                </button>
              )}
            </div>
            <p className="cvHelp">
              Applied more than {CADENCE_DAYS} days ago, and the follow-up date has passed. Ticked: the follow-up date is cleared and the notes say “cadence closed {formatDate(plan.today)}”. The status stays Applied.
            </p>
            <ul className="cleanupList">
              {plan.ruleA.map((a) => (
                <li key={a.id} className="cleanupItem">
                  <label className="cleanupCheck">
                    <input type="checkbox" checked={ticked.has(a.id)} onChange={() => toggle(a.id)} data-cleanup-item={a.id} />
                    <span><strong>{a.company_name}</strong> — {a.role}</span>
                  </label>
                  <span className="cleanupMeta">applied {formatDate(a.date_applied)} ({a.days_since_applied} days) · follow-up {formatDate(a.followup_date)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="cleanupSection" data-cleanup-rule="B">
            <h3 className="cleanupTitle">Duplicates <span className="cleanupCount">{plan.ruleB.length}</span></h3>
            <p className="cvHelp">
              The same company and role. Ticked: its notes are joined into the row kept, which takes the most advanced status and the earliest applied date, and the duplicate is deleted.
            </p>
            {plan.ruleB.map((g) => (
              <div key={g.key} className="cleanupGroup" data-cleanup-group>
                <p className="cleanupKeep">
                  Keep <strong>{g.keep.company_name}</strong> — {g.keep.role} <span className="cleanupMeta">({statusLabel(g.keep.status)}, {formatDate(g.keep.date_applied)}; {g.keep.why})</span>
                </p>
                <ul className="cleanupList">
                  {g.duplicates.map((d) => (
                    <li key={d.id} className="cleanupItem">
                      {d.blocked ? (
                        <span className="cleanupBlocked">Merge by hand: {d.blocked}.</span>
                      ) : (
                        <label className="cleanupCheck">
                          <input type="checkbox" checked={ticked.has(d.id)} onChange={() => toggle(d.id)} data-cleanup-item={d.id} />
                          <span>Merge and delete</span>
                        </label>
                      )}
                      <span className="cleanupMeta">
                        {d.role} · {statusLabel(d.status)} · {formatDate(d.date_applied)}
                        {d.newKeepStatus ? ` · the kept row becomes ${statusLabel(d.newKeepStatus)}` : ""}
                        {d.newKeepDate ? ` · its date becomes ${formatDate(d.newKeepDate)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="cleanupSection" data-cleanup-rule="C">
            <h3 className="cleanupTitle">Report only</h3>
            <ReportList title="Ready to submit for more than 3 days" items={plan.ruleC.readyToSubmit} note={`Ready to submit for over ${READY_STALE_DAYS} days: submit them this week, or withdraw them.`} />
            <ReportList title="Generic roles" items={plan.ruleC.genericRoles} note="“Cold email…” and “Speculative…” rows: no role to search for." />
            <ReportList title="Role not shown" items={plan.ruleC.roleNotShown} note="Fill the role in from the portal, or leave it as unknown." />
          </section>

          <div className="actions">
            <Button variant="secondary" onClick={apply} disabled={applying || ticked.size === 0} data-cleanup-apply>
              {applying ? "Applying…" : ticked.size ? `Apply ${ticked.size} ticked` : "Tick rows to apply"}
            </Button>
            <button type="button" className="linkBtn" onClick={onClose}>Close without changes</button>
          </div>
        </>
      )}
    </Card>
  );
}
