// Chunk 33: the Local Agent queue, website side. Queue jobs from pasted URLs,
// list them with their latest event, and cancel / retry / switch a job's mode.
// Every write is the signed-in user's own under RLS; the PC worker never comes
// through here (it uses the device-token RPCs).
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { detectAts, normaliseJobUrl, isLinkedIn } from "@/lib/agent/ats";
import { LINKEDIN_BLOCKED, LINKEDIN_BLOCKED_MESSAGE } from "@/lib/agent/guardrails";

const MAX_URLS_PER_REQUEST = 50;

type QueueMode = "dry_run" | "submit";

function splitUrls(input: unknown): string[] {
  if (Array.isArray(input)) return input.filter((u): u is string => typeof u === "string");
  if (typeof input === "string") return input.split(/[\r\n]+/);
  return [];
}

// ─── POST /api/agent/jobs — queue one or more URLs ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const burst = await checkBurstLimit(userId, "agent-queue", { limit: 30, windowSeconds: 60 });
    if (!burst.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again in a moment." },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds ?? 30) } }
      );
    }

    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    const mode: QueueMode = body.mode === "submit" ? "submit" : "dry_run";
    const lines = splitUrls(body.urls).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return NextResponse.json({ error: "Paste at least one job link." }, { status: 400 });
    }
    if (lines.length > MAX_URLS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many links at once — paste up to ${MAX_URLS_PER_REQUEST}.` },
        { status: 400 }
      );
    }

    // Classify each line. LinkedIn is rejected outright; everything else gets an
    // ATS tag (even "other"/"unknown"), and we dedupe within the paste by the
    // normalised URL before we ever touch the database.
    const rejected: Array<{ url: string; reason: string }> = [];
    const seen = new Set<string>();
    const candidates: Array<{ job_url: string; job_url_norm: string; ats: string }> = [];
    for (const url of lines) {
      if (LINKEDIN_BLOCKED && isLinkedIn(url)) {
        rejected.push({ url, reason: LINKEDIN_BLOCKED_MESSAGE });
        continue;
      }
      const ats = detectAts(url);
      if (ats === "unknown") {
        rejected.push({ url, reason: "That doesn't look like a job link — check the address." });
        continue;
      }
      const norm = normaliseJobUrl(url);
      if (seen.has(norm)) continue; // same link twice in one paste
      seen.add(norm);
      candidates.push({ job_url: url, job_url_norm: norm, ats });
    }

    const duplicates: string[] = [];
    let inserted: unknown[] = [];

    if (candidates.length > 0) {
      // Which of these are already queued for this user?
      const { data: existing, error: existErr } = await supabase
        .from("apply_jobs")
        .select("job_url_norm")
        .eq("user_id", userId)
        .in("job_url_norm", candidates.map((c) => c.job_url_norm));
      if (existErr) {
        if (existErr.code === "PGRST205" || existErr.code === "42P01") {
          return NextResponse.json(
            { error: "needs_migration", migration: "20261119120000_agent_queue.sql" },
            { status: 503 }
          );
        }
        console.error("agent jobs exist-check error:", existErr.message);
        return NextResponse.json({ error: "Failed to queue jobs" }, { status: 500 });
      }
      const existingNorms = new Set((existing ?? []).map((r) => r.job_url_norm as string));
      const toInsert = candidates.filter((c) => {
        if (existingNorms.has(c.job_url_norm)) {
          duplicates.push(c.job_url);
          return false;
        }
        return true;
      });

      if (toInsert.length > 0) {
        const rows = toInsert.map((c) => ({
          user_id: userId,
          job_url: c.job_url,
          job_url_norm: c.job_url_norm,
          ats: c.ats,
          mode,
          status: "queued",
        }));
        const { data, error: insErr } = await supabase.from("apply_jobs").insert(rows).select();
        if (insErr) {
          // A concurrent paste can still race the unique index.
          if (insErr.code === "23505") {
            return NextResponse.json(
              { error: "Some of those are already queued — refresh and try again." },
              { status: 409 }
            );
          }
          console.error("agent jobs insert error:", insErr.message);
          return NextResponse.json({ error: "Failed to queue jobs" }, { status: 500 });
        }
        inserted = data ?? [];
      }
    }

    return NextResponse.json({
      queued: inserted,
      queuedCount: inserted.length,
      duplicates,
      rejected,
    });
  } catch (err) {
    console.error("POST /api/agent/jobs error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── GET /api/agent/jobs — the user's queue with each job's latest event ──────
export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const { data: jobs, error } = await supabase
      .from("apply_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return NextResponse.json({ jobs: [], needsMigration: true });
      }
      console.error("agent jobs list error:", error.message);
      return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
    }

    // The newest event per job, attached for the "last event" column, plus the
    // newest "observed" event's data (the numbered field list the Fields drawer
    // renders — it travels in the event, no storage round-trip needed).
    const { data: events } = await supabase
      .from("apply_events")
      .select("job_id, ts, level, step, message, data")
      .eq("user_id", userId)
      .order("ts", { ascending: false })
      .limit(1000);
    const lastEvent = new Map<string, unknown>();
    const observer = new Map<string, unknown>();
    for (const e of events ?? []) {
      const jid = e.job_id as string;
      if (!lastEvent.has(jid)) {
        // The "last event" column shouldn't carry the big observer payload.
        const { data: _omit, ...lean } = e as Record<string, unknown>;
        lastEvent.set(jid, lean);
      }
      if (e.step === "observed" && !observer.has(jid) && e.data) observer.set(jid, e.data);
    }

    // A short-lived signed URL for each job's screenshot (read as the owner
    // under the bucket's SELECT policy). Missing bucket / column → no thumbnail.
    const screenshotUrl = new Map<string, string>();
    const paths = (jobs ?? [])
      .map((j) => (typeof j.screenshot_path === "string" ? j.screenshot_path : ""))
      .filter(Boolean);
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("agent-artifacts")
        .createSignedUrls(paths, 3600);
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) screenshotUrl.set(s.path, s.signedUrl);
      }
    }

    const withEvents = (jobs ?? []).map((j) => ({
      ...j,
      last_event: lastEvent.get(j.id as string) ?? null,
      observer: observer.get(j.id as string) ?? null,
      screenshot_url:
        typeof j.screenshot_path === "string" && j.screenshot_path
          ? screenshotUrl.get(j.screenshot_path) ?? null
          : null,
    }));
    return NextResponse.json({ jobs: withEvents });
  } catch (err) {
    console.error("GET /api/agent/jobs error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── PATCH /api/agent/jobs — cancel, retry, or switch a job's mode ────────────
export async function PATCH(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!id) return NextResponse.json({ error: "Missing job id" }, { status: 400 });

    let patch: Record<string, unknown>;
    if (action === "cancel") {
      patch = { status: "cancelled" };
    } else if (action === "retry") {
      // Back to the queue; keep the attempt count, clear the last run's marks.
      patch = { status: "queued", last_error: null, claimed_by: null, claimed_at: null, heartbeat_at: null };
    } else if (action === "set_mode") {
      const mode: QueueMode = body.mode === "submit" ? "submit" : "dry_run";
      patch = { mode };
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("apply_jobs")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    if (error) {
      console.error("agent jobs patch error:", error.message);
      return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ job: data });
  } catch (err) {
    console.error("PATCH /api/agent/jobs error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── DELETE /api/agent/jobs?id=… — remove a job from the queue ────────────────
export async function DELETE(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing job id" }, { status: 400 });
    const { error } = await supabase.from("apply_jobs").delete().eq("id", id).eq("user_id", userId);
    if (error) {
      console.error("agent jobs delete error:", error.message);
      return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/agent/jobs error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
