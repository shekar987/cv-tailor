"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeading from "@/components/ui/SectionHeading";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import StatusText from "@/components/ui/StatusText";
import { useConfirm } from "@/components/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import { ATS_LABELS, type Ats } from "@/lib/agent/ats";
import { workerPresence } from "@/lib/agent/deviceStatus";
import { formatDate } from "@/lib/formatDate";

// /agent — "Auto-apply" (Chunk 33). Queue job links here; a free worker on your
// own PC (Chunk 34) applies to them and reports back live. This chunk is the
// bridge only: the queue, the device token and the live table. No browser
// automation yet — the empty state says so.

const PAGE_TAGLINE = "Queue job links here; a free worker on your own PC fills them in. £0 per application.";

type JobEvent = { ts: string; level: string; step: string | null; message: string | null } | null;

type Job = {
  id: string;
  job_url: string;
  company: string | null;
  role: string | null;
  ats: Ats;
  status: string;
  mode: "dry_run" | "submit";
  attempts: number;
  last_error: string | null;
  confirmation_url: string | null;
  created_at: string;
  last_event: JobEvent;
};

type Device = {
  id: string;
  name: string;
  last_seen_at: string | null;
  revoked: boolean;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  claimed: "Claimed",
  processing: "Working…",
  needs_review: "Needs your review",
  needs_human: "Needs you",
  dry_run_done: "Dry run done",
  submitted: "Submitted",
  failed: "Failed",
  cancelled: "Cancelled",
};

// The colour family each status wears (reusing the design tokens via CSS).
const STATUS_TONE: Record<string, "neutral" | "amber" | "success" | "danger"> = {
  queued: "neutral",
  claimed: "amber",
  processing: "amber",
  needs_review: "amber",
  needs_human: "amber",
  dry_run_done: "success",
  submitted: "success",
  failed: "danger",
  cancelled: "neutral",
};

function jobTitle(j: Job): string {
  if (j.company && j.role) return `${j.company} — ${j.role}`;
  if (j.company) return j.company;
  if (j.role) return j.role;
  try {
    return new URL(j.job_url).hostname.replace(/^www\./, "") + new URL(j.job_url).pathname;
  } catch {
    return j.job_url;
  }
}

export default function AgentPage() {
  const [confirm, confirmDialog] = useConfirm();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsMigration, setNeedsMigration] = useState(false);
  // A ticking clock so "Worker last seen" and the online/offline pill update
  // without a reload — including flipping to "offline" after the worker stops.
  const [now, setNow] = useState(() => Date.now());

  // The paste box.
  const [urls, setUrls] = useState("");
  const [mode, setMode] = useState<"dry_run" | "submit">("dry_run");
  const [queuing, setQueuing] = useState(false);
  const [queueResult, setQueueResult] = useState<
    { queuedCount: number; duplicates: string[]; rejected: Array<{ url: string; reason: string }> } | null
  >(null);

  // The one-time device token.
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/jobs");
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Your session has expired — sign in again.");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not load your queue.");
        return;
      }
      if (data.needsMigration) setNeedsMigration(true);
      setJobs(Array.isArray(data.jobs) ? (data.jobs as Job[]) : []);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/devices");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.needsMigration) setNeedsMigration(true);
        setDevices(Array.isArray(data.devices) ? (data.devices as Device[]) : []);
      } else setDevices([]);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    void loadDevices();
  }, [loadJobs, loadDevices]);

  // Live updates: whenever this user's jobs or events change, re-read the queue.
  const loadJobsRef = useRef(loadJobs);
  loadJobsRef.current = loadJobs;
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!active || !uid) return;
      channel = supabase
        .channel("agent-queue")
        .on("postgres_changes", { event: "*", schema: "public", table: "apply_jobs", filter: `user_id=eq.${uid}` }, () => loadJobsRef.current())
        .on("postgres_changes", { event: "*", schema: "public", table: "apply_events", filter: `user_id=eq.${uid}` }, () => loadJobsRef.current())
        .subscribe();
    });
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  // Tick the clock and re-read devices every 15s. last_seen_at is only written
  // while the worker is running (it bumps it on every poll), so nothing pushes
  // an update when it stops — this timer is what flips the pill to "offline".
  const loadDevicesRef = useRef(loadDevices);
  loadDevicesRef.current = loadDevices;
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      void loadDevicesRef.current();
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  async function handleQueue(e: React.FormEvent) {
    e.preventDefault();
    if (queuing || !urls.trim()) return;
    setQueuing(true);
    setError("");
    setQueueResult(null);
    try {
      const res = await fetch("/api/agent/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.error === "needs_migration") {
        setNeedsMigration(true);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not queue those links.");
        return;
      }
      setQueueResult({
        queuedCount: data.queuedCount ?? 0,
        duplicates: Array.isArray(data.duplicates) ? data.duplicates : [],
        rejected: Array.isArray(data.rejected) ? data.rejected : [],
      });
      if ((data.queuedCount ?? 0) > 0) setUrls("");
      await loadJobs();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setQueuing(false);
    }
  }

  async function patchJob(id: string, action: string, extra: Record<string, unknown> = {}) {
    try {
      const res = await fetch("/api/agent/jobs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      if (res.ok) await loadJobs();
    } catch {
      /* the live table will catch up */
    }
  }

  async function switchToSubmit(job: Job) {
    const ok = await confirm({
      title: "Switch this job to submit mode?",
      message:
        "In submit mode the worker fills in the form AND presses submit for real. In dry run it stops before submitting so you can check everything first. You can switch back any time.",
      confirmLabel: "Switch to submit",
      cancelLabel: "Keep dry run",
      danger: true,
    });
    if (ok) await patchJob(job.id, "set_mode", { mode: "submit" });
  }

  async function createDevice() {
    if (creatingDevice) return;
    setCreatingDevice(true);
    setError("");
    setNewToken(null);
    setCopied(false);
    try {
      const res = await fetch("/api/agent/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "My PC" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.error === "needs_migration") {
        setNeedsMigration(true);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not create a device token.");
        return;
      }
      setNewToken(data.token as string);
      await loadDevices();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setCreatingDevice(false);
    }
  }

  async function revokeDevice(id: string) {
    const ok = await confirm({
      title: "Revoke this device?",
      message: "Its token stops working immediately. You can connect a new device whenever you like.",
      confirmLabel: "Revoke",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return;
    try {
      await fetch(`/api/agent/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadDevices();
    } catch {
      /* ignore */
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const loading = jobs === null && !error;
  const activeDevices = (devices ?? []).filter((d) => !d.revoked);

  return (
    <main className="page">
      <div className="container container--narrow">
        <AppHeader title="Auto-apply" tagline={PAGE_TAGLINE} />
        {confirmDialog}

        {error && <StatusText role="alert">{error}</StatusText>}
        {notice && <div className="limitNotice" role="status">{notice}</div>}
        {needsMigration && (
          <div className="limitNotice" role="status">
            Auto-apply isn&apos;t switched on yet for this account — the database update is still to be applied.
          </div>
        )}

        <p className="agentPitch" data-agent-pitch>
          <strong>£0 per application, runs on your PC.</strong> Paid tools charge per application and apply from their own
          servers. Jobhuntz queues the jobs here and a worker on your own computer fills them in — your login, your browser,
          no monthly fee.
        </p>

        {/* Paste & queue */}
        <Card variant="ruled" data-queue-form>
          <SectionHeading folio={1}>Queue job links</SectionHeading>
          <form onSubmit={handleQueue}>
            <label className="cvHelp" htmlFor="agent-urls">
              One job link per line. We read Greenhouse, Lever, Ashby, Workday, Pinpoint and Workable. LinkedIn isn&apos;t
              supported.
            </label>
            <textarea
              id="agent-urls"
              className="textInput agentUrls"
              rows={5}
              placeholder={"https://boards.greenhouse.io/acme/jobs/1234567\nhttps://jobs.lever.co/acme/…"}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              spellCheck={false}
            />
            <div className="agentQueueRow">
              <fieldset className="agentMode">
                <legend className="cvHelp">When the worker runs these:</legend>
                <label>
                  <input type="radio" name="mode" checked={mode === "dry_run"} onChange={() => setMode("dry_run")} /> Dry run —
                  fill in, stop before submit
                </label>
                <label>
                  <input type="radio" name="mode" checked={mode === "submit"} onChange={() => setMode("submit")} /> Submit for
                  real
                </label>
              </fieldset>
              <Button type="submit" disabled={queuing || !urls.trim()}>
                {queuing ? "Queuing…" : "Add to queue"}
              </Button>
            </div>
          </form>

          {queueResult && (
            <div className="agentQueueResult" role="status">
              {queueResult.queuedCount > 0 && (
                <p className="agentOk">
                  Added {queueResult.queuedCount} {queueResult.queuedCount === 1 ? "job" : "jobs"} to the queue.
                </p>
              )}
              {queueResult.duplicates.length > 0 && (
                <p className="cvHelp">
                  Already queued (skipped): {queueResult.duplicates.length}.
                </p>
              )}
              {queueResult.rejected.length > 0 && (
                <ul className="agentRejected">
                  {queueResult.rejected.map((r, i) => (
                    <li key={i}>
                      <span className="agentRejected__url">{r.url}</span>
                      <span className="agentRejected__why">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {/* The live queue */}
        <Card variant="ruled" data-queue-table>
          <SectionHeading folio={2}>Your queue</SectionHeading>
          {loading ? (
            <Skeleton lines={3} label="Loading your queue" />
          ) : !jobs || jobs.length === 0 ? (
            <EmptyState title="Nothing queued yet">
              Paste a few job links above. They&apos;ll wait here until the PC worker claims them. The worker itself arrives in
              the next update (Chunk 34) — this is the queue it reads from.
            </EmptyState>
          ) : (
            <div className="agentTableWrap">
              <table className="agentTable" data-agent-jobs>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Tries</th>
                    <th>Last update</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} data-job-row data-status={j.status}>
                      <td className="agentTable__job">
                        <a href={j.job_url} target="_blank" rel="noopener noreferrer" className="inlineLink" title={j.job_url}>
                          {jobTitle(j)}
                        </a>
                        {j.last_error && <span className="agentErr" title={j.last_error}>{j.last_error}</span>}
                      </td>
                      <td>
                        <span className="agentAts">{ATS_LABELS[j.ats] ?? j.ats}</span>
                      </td>
                      <td>
                        <span className="agentStatus" data-tone={STATUS_TONE[j.status] ?? "neutral"}>
                          {STATUS_LABELS[j.status] ?? j.status}
                        </span>
                      </td>
                      <td>
                        <span className={j.mode === "submit" ? "agentMode agentMode--submit" : "agentMode"}>
                          {j.mode === "submit" ? "Submit" : "Dry run"}
                        </span>
                      </td>
                      <td>{j.attempts}</td>
                      <td className="agentTable__event">
                        {j.last_event?.message ? (
                          <span title={`${formatDate(j.last_event.ts)} · ${j.last_event.step ?? ""}`}>{j.last_event.message}</span>
                        ) : (
                          <span className="cvHelp">—</span>
                        )}
                      </td>
                      <td className="agentTable__actions">
                        {j.status !== "cancelled" && j.status !== "submitted" && (
                          <button type="button" className="inlineLink" onClick={() => patchJob(j.id, "cancel")}>
                            Cancel
                          </button>
                        )}
                        {(j.status === "failed" || j.status === "cancelled" || j.status === "dry_run_done" || j.status === "needs_review" || j.status === "needs_human") && (
                          <button type="button" className="inlineLink" onClick={() => patchJob(j.id, "retry")}>
                            Retry
                          </button>
                        )}
                        {j.mode === "dry_run" ? (
                          <button type="button" className="inlineLink" onClick={() => switchToSubmit(j)}>
                            Switch to submit
                          </button>
                        ) : (
                          <button type="button" className="inlineLink" onClick={() => patchJob(j.id, "set_mode", { mode: "dry_run" })}>
                            Back to dry run
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Connect a device */}
        <Card variant="ruled" data-devices>
          <SectionHeading folio={3}>Connect a device</SectionHeading>
          <p className="cvHelp">
            The PC worker signs in with a one-time token, so it never needs your password. Create one here, paste it into the
            worker on your computer, and it starts claiming jobs from this queue.
          </p>

          {newToken && (
            <div className="agentToken" role="status" data-new-token>
              <p className="agentToken__label">Your device token — copy it now. You won&apos;t see it again.</p>
              <code className="agentToken__value">{newToken}</code>
              <div className="agentToken__row">
                <Button type="button" onClick={copyToken}>
                  {copied ? "Copied ✓" : "Copy token"}
                </Button>
                <span className="cvHelp">Paste it into the Jobhuntz worker when you set it up (Chunk 34).</span>
              </div>
            </div>
          )}

          <div className="agentDeviceRow">
            <Button type="button" onClick={createDevice} disabled={creatingDevice}>
              {creatingDevice ? "Creating…" : "Connect a device"}
            </Button>
          </div>

          {devices && devices.length > 0 && (
            <ul className="agentDevices" data-device-rows>
              {devices.map((d) => {
                const presence = workerPresence(d.last_seen_at, now);
                const lastSeen =
                  presence.state === "never"
                    ? "Never connected"
                    : `Worker last seen: ${presence.relative ?? formatDate(d.last_seen_at)}`;
                return (
                  <li key={d.id} data-device-row data-worker-state={d.revoked ? "revoked" : presence.state}>
                    <span>
                      <strong>{d.name}</strong>
                      {d.revoked ? (
                        <span className="agentStatus" data-tone="neutral"> Revoked</span>
                      ) : presence.state === "never" ? null : presence.online ? (
                        <span className="agentStatus" data-tone="success" data-worker-pill> Worker online</span>
                      ) : (
                        <span className="agentStatus" data-tone="neutral" data-worker-pill> Worker offline</span>
                      )}
                    </span>
                    <span className="cvHelp" data-worker-lastseen>
                      {lastSeen}
                    </span>
                    {!d.revoked && (
                      <button type="button" className="inlineLink" onClick={() => revokeDevice(d.id)}>
                        Revoke
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {devices && activeDevices.length === 0 && !newToken && (
            <p className="cvHelp">No device connected yet.</p>
          )}
        </Card>
      </div>
    </main>
  );
}
