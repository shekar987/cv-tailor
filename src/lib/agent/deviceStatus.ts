// Local Agent (Chunk 34): is the PC worker online right now? The worker bumps
// agent_devices.last_seen_at on every poll (claim_next_job) and every heartbeat
// (≤ 20s while a job runs, ≤ 60s while idle), so a device last seen within two
// minutes is treated as online; older than that is "offline". Import-free and
// pure (tests/agentDeviceStatus) — the component supplies `nowMs` so the clock
// is testable and the server's time never has to be trusted.

export const WORKER_OFFLINE_MS = 2 * 60 * 1000; // 2 minutes

export type WorkerState = "online" | "offline" | "never";

export type WorkerPresence = {
  state: WorkerState;
  online: boolean;
  /** A short "last seen" phrase for recent times, or null when it's old/never
   *  (the caller shows an absolute date via formatDate then). */
  relative: string | null;
  ageMs: number | null;
};

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function relativeLabel(ageMs: number): string | null {
  if (ageMs < 10_000) return "just now"; // also covers small clock skew
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return null; // older than a day — show the date instead
}

export function workerPresence(
  lastSeenAt: string | null | undefined,
  nowMs: number
): WorkerPresence {
  const seen = parseMs(lastSeenAt);
  if (seen === null) {
    return { state: "never", online: false, relative: null, ageMs: null };
  }
  const ageMs = Math.max(0, nowMs - seen);
  const online = ageMs <= WORKER_OFFLINE_MS;
  return {
    state: online ? "online" : "offline",
    online,
    relative: relativeLabel(ageMs),
    ageMs,
  };
}
