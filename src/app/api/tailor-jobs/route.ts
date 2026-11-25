// Chunk TL-1 (Local Tailor): the website side of the tailor queue. The user
// queues a "summary" tailor job for a JD here; a worker on their own PC claims
// it (the device-token RPCs in 20261125120000_tailor_jobs.sql), runs a local
// open-weight model through Ollama, and writes the result back. The website
// NEVER calls Ollama — it only reads and writes tailor_jobs as the signed-in
// user under RLS.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import {
  MAX_JD_CHARS,
  MAX_CV_CHARS,
  PREMIUM_SUMMARY_GBP,
  readSummaryResult,
  totalSavedGbp,
  type TailorJobInput,
} from "@/lib/tailorJobs";

const MIGRATION = "20261125120000_tailor_jobs.sql";

function isMissingTable(code?: string): boolean {
  return code === "PGRST205" || code === "42P01";
}

// ─── POST /api/tailor-jobs — queue a summary tailor job for a JD ──────────────
export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const burst = await checkBurstLimit(userId, "tailor-jobs", { limit: 30, windowSeconds: 60 });
    if (!burst.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again in a moment." },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds ?? 30) } }
      );
    }

    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";
    if (!jdText) return NextResponse.json({ error: "Paste a job description first." }, { status: 400 });
    const applicationId = typeof body.applicationId === "string" ? body.applicationId : null;

    // The master CV the summary is built from. Read server-side so the worker
    // needs no Supabase read of its own — it gets the text in the job's input.
    const { data: cvRow, error: cvErr } = await supabase
      .from("master_cvs")
      .select("text")
      .eq("user_id", userId)
      .maybeSingle();
    if (cvErr) {
      console.error("tailor-jobs master CV read error:", cvErr.message);
      return NextResponse.json({ error: "Couldn't read your CV." }, { status: 500 });
    }
    const masterCv = typeof cvRow?.text === "string" ? cvRow.text.trim() : "";
    if (!masterCv) {
      return NextResponse.json(
        { error: "Save your CV on the My CV page first — the local tailor needs it as the source." },
        { status: 400 }
      );
    }

    const input: TailorJobInput = {
      kind: "summary",
      jd_text: jdText.slice(0, MAX_JD_CHARS),
      master_cv: masterCv.slice(0, MAX_CV_CHARS),
      application_id: applicationId,
    };

    const { data, error } = await supabase
      .from("tailor_jobs")
      .insert({
        user_id: userId,
        application_id: applicationId,
        kind: "summary",
        status: "queued",
        input,
        estimated_gbp: PREMIUM_SUMMARY_GBP,
      })
      .select("id, status, created_at")
      .single();
    if (error) {
      if (isMissingTable(error.code)) {
        return NextResponse.json({ error: "needs_migration", migration: MIGRATION }, { status: 503 });
      }
      console.error("tailor-jobs insert error:", error.message);
      return NextResponse.json({ error: "Couldn't queue the local tailor." }, { status: 500 });
    }

    return NextResponse.json({ job: data, queued: true });
  } catch (err) {
    console.error("POST /api/tailor-jobs error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── GET /api/tailor-jobs?id=… — poll one job, or (no id) list recent + £ saved ─
export async function GET(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const id = new URL(req.url).searchParams.get("id");

    if (id) {
      const { data, error } = await supabase
        .from("tailor_jobs")
        .select("id, status, kind, model, tokens_per_sec, estimated_gbp, output, input, last_error, created_at, updated_at")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        if (isMissingTable(error.code)) {
          return NextResponse.json({ needsMigration: true, migration: MIGRATION }, { status: 503 });
        }
        console.error("tailor-jobs get error:", error.message);
        return NextResponse.json({ error: "Couldn't read that job." }, { status: 500 });
      }
      if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      // The honesty verdict is computed here, from the master CV the job was
      // tailored from — never trusted from the worker's own output.
      const masterCv = typeof (data.input as { master_cv?: unknown })?.master_cv === "string"
        ? ((data.input as { master_cv: string }).master_cv)
        : "";
      const summaryResult =
        data.status === "done" && data.output ? readSummaryResult(data.output, masterCv) : null;

      return NextResponse.json({
        job: {
          id: data.id,
          status: data.status,
          kind: data.kind,
          model: data.model,
          tokensPerSec: data.tokens_per_sec,
          estimatedGbp: data.estimated_gbp,
          lastError: data.last_error,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
        summaryResult,
      });
    }

    const { data, error } = await supabase
      .from("tailor_jobs")
      .select("id, status, kind, model, estimated_gbp, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (isMissingTable(error.code)) {
        return NextResponse.json({ jobs: [], savedGbp: 0, needsMigration: true });
      }
      console.error("tailor-jobs list error:", error.message);
      return NextResponse.json({ error: "Couldn't load your local tailors." }, { status: 500 });
    }
    const rows = data ?? [];
    return NextResponse.json({ jobs: rows, savedGbp: totalSavedGbp(rows) });
  } catch (err) {
    console.error("GET /api/tailor-jobs error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
