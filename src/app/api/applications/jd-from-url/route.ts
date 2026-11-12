// POST /api/applications/jd-from-url { url, id?, replace? } (12 Nov 2026, Chunk 23): a job
// link read server side into the posting's plain text, saved on a tracker row when `id` is
// given. On 12 Nov the morning sweep could not save Gem and SmartRecruiters postings in
// full: it read boards from the browser, where only Ashby, Greenhouse and Lever allow it,
// and pasted a hand summary instead (one row: 1,042 characters).
//
// Reading (lib/importJob/readJob): a known board's link (Lever, Ashby, Greenhouse, Gem,
// Workable, SmartRecruiters, Teamtailor, BambooHR, LinkedIn) from that board's fixed public
// address, as /app's import does; any other link, or a board that could not be read, from
// the page itself (its JobPosting block, else its readable text), through lib/fetchPage's
// SSRF guard. The answer says which (`via`: board / json_ld / page_text).
//
// Without `id`: { ok, saved: false, description, title, company, location, chars, source, via, applyUrl }.
// With `id`: the text is written to the row's job_description through the tracker's own
// PUT (../route), so the row's JD triage is recomputed as for any JD edit, and the answer
// is { ok, saved: true, id, updated_at, chars, … } without the text. A row that already
// has a different JD keeps it unless `replace: true` is sent (409 jd_exists, both lengths
// given): a tailored row's JD is the text its CV was tailored against.
//
// 100 reads an hour per user. No model call, no credit. Send an Idempotency-Key with an id.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { idempotent, jsonBodyOf } from "@/lib/idempotentRoute";
import { fetchPage, FetchPageError, UnsafeUrlError } from "@/lib/fetchPage";
import { isImportFetchHost } from "@/lib/importJob/parse";
import type { JobFetcher } from "@/lib/importJob/fetchJob";
import { readJobFromAnyUrl, type PageFetcher } from "@/lib/importJob/readJob";
import { PUT } from "../route";

export const runtime = "nodejs";
export const maxDuration = 60;

const PATH = "/api/applications/jd-from-url";
const READ_LIMIT = { limit: 100, windowSeconds: 3600 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["url", "id", "replace"]);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
};

// A board's fixed public address only (lib/importJob/parse isImportFetchHost), redirects included.
const boardFetcher: JobFetcher = async (url, { maxBytes }) => {
  try {
    const page = await fetchPage(url, { timeoutMs: 10_000, maxBytes, allowHost: isImportFetchHost });
    return { status: page.status, body: page.body, url: page.url };
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof FetchPageError) {
      console.warn(`[jd-from-url] ${hostOf(url)} board fetch failed:`, e instanceof FetchPageError ? `${e.kind} ${e.code}` : e.message);
      return null;
    }
    throw e;
  }
};

// Any public page, behind fetchPage's SSRF guard (no private address, default ports, each hop re-checked).
const pageFetcher: PageFetcher = async (url, { maxBytes }) => {
  try {
    const page = await fetchPage(url, { timeoutMs: 12_000, maxBytes });
    return { status: page.status, body: page.body, url: page.url, contentType: page.contentType };
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof FetchPageError) {
      console.warn(`[jd-from-url] ${hostOf(url)} page fetch failed:`, e instanceof FetchPageError ? `${e.kind} ${e.code}` : e.message);
      return null;
    }
    throw e;
  }
};

export async function POST(req: NextRequest) {
  return idempotent(req, PATH, jsonBodyOf(req), () => importJd(req));
}

async function importJd(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const unknown = Object.keys(body).find((k) => !KEYS.has(k));
    if (unknown) return NextResponse.json({ error: `Unknown field "${unknown.slice(0, 40)}". Send url, and id to save it on a row.` }, { status: 400 });
    const hasId = body.id !== undefined && body.id !== null && body.id !== "";
    if (hasId && (typeof body.id !== "string" || !UUID_RE.test(body.id))) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (body.replace !== undefined && typeof body.replace !== "boolean") return NextResponse.json({ error: "replace must be true or false." }, { status: 400 });
    const id = hasId ? (body.id as string) : null;

    const burst = await checkBurstLimit(userId, "jd-from-url", READ_LIMIT);
    if (!burst.ok) {
      const minutes = Math.max(1, Math.ceil(burst.retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `That's 100 job links read in the last hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, errorType: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    // The row first: a link for a row that isn't the caller's is never fetched.
    let stored: string | null = null;
    if (id) {
      const { data: row, error } = await supabase.from("applications").select("id, job_description").eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) {
        console.error("jd-from-url row read error:", error.code ?? "unknown");
        return NextResponse.json({ error: "Could not read that application" }, { status: 500 });
      }
      if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      stored = typeof row.job_description === "string" && row.job_description.trim() ? row.job_description : null;
    }

    const read = await readJobFromAnyUrl(body.url, { board: boardFetcher, page: pageFetcher });
    if (!read.ok) return NextResponse.json({ error: read.error, errorType: read.errorType }, { status: read.status });
    const { job } = read;
    const facts = { chars: job.description.length, title: job.title, company: job.company, location: job.location, source: job.source, via: job.via, applyUrl: job.applyUrl };
    if (!id) return NextResponse.json({ ok: true, saved: false, ...facts, description: job.description });

    if (stored !== null && stored.trim() === job.description.trim()) return NextResponse.json({ ok: true, saved: false, unchanged: true, id, ...facts });
    if (stored !== null && body.replace !== true) {
      return NextResponse.json(
        {
          error: "jd_exists",
          errorType: "jd_exists",
          message: `This row already has a job description (${stored.length.toLocaleString("en-GB")} characters); the posting's is ${job.description.length.toLocaleString("en-GB")}. Nothing was saved. Send replace: true to replace it.`,
          existing_chars: stored.length,
          ...facts,
        },
        { status: 409 }
      );
    }
    // The tracker's own PUT, so the JD is checked and its triage recomputed as for any edit.
    const res = await PUT(
      new NextRequest(new URL("/api/applications", req.url), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, job_description: job.description }) })
    );
    const saved = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status !== 200 || saved?.ok !== true) {
      return NextResponse.json({ ...(saved ?? { error: "Could not save that job description" }), ...facts, saved: false }, { status: res.status === 200 ? 500 : res.status });
    }
    return NextResponse.json({ ok: true, saved: true, id, updated_at: saved.updated_at ?? null, ...(saved.gates !== undefined ? { gates: saved.gates } : {}), ...(stored !== null ? { replaced_chars: stored.length } : {}), ...facts });
  } catch (err) {
    console.error("jd-from-url error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Reading that job link failed on our side.", errorType: "server" }, { status: 500 });
  }
}
