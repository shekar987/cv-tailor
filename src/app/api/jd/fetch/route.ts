// POST /api/jd/fetch { url } — a job link → the posting as plain text for the
// JD box, plus its company, title, location and apply link, read server side
// (31 Oct 2026, Chunk 6; it was /api/import-job). Lever, Ashby, Greenhouse,
// Workable, SmartRecruiters, BambooHR and LinkedIn. No model call, no credit.
// The flow is lib/importJob/fetchJob (tested with a mock per board); this
// file is the route around it.
//
// SECURITY: the link never becomes the fetched address. lib/importJob/parse
// reads a board and a posting id off one of the job-board hosts and builds
// the request on a fixed API host (a BambooHR company's own
// <company>.bamboohr.com, one DNS label); fetchPage's SSRF guard runs as
// usual and `allowHost` refuses any other host, redirects included.
// Rate limit: 20 imports per user per hour (lib/apiRateLimit).

import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { fetchPage, FetchPageError, UnsafeUrlError } from "@/lib/fetchPage";
import { isImportFetchHost } from "@/lib/importJob/parse";
import { fetchJobFromUrl, type JobFetcher } from "@/lib/importJob/fetchJob";

export const runtime = "nodejs";
export const maxDuration = 30;

const IMPORT_LIMIT = { limit: 20, windowSeconds: 3600 };

// fetchPage behind the allowed hosts; a refused or unreachable address is
// null (the flow says the board could not be reached), anything else throws.
const fetcher: JobFetcher = async (url, { maxBytes }) => {
  try {
    const page = await fetchPage(url, { timeoutMs: 10_000, maxBytes, allowHost: isImportFetchHost });
    if (page.status !== 200) console.warn(`[jd/fetch] ${new URL(url).hostname} answered HTTP ${page.status}`);
    return { status: page.status, body: page.body, url: page.url };
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof FetchPageError) {
      console.warn(`[jd/fetch] ${new URL(url).hostname} fetch failed:`, e instanceof FetchPageError ? `${e.kind} ${e.code}` : e.message);
      return null;
    }
    throw e;
  }
};

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { userId } = caller;

    // The bucket keeps its old name, so a user's count carries across the rename.
    const limit = await checkBurstLimit(userId, "import-job", IMPORT_LIMIT);
    if (!limit.ok) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          error: `You've imported 20 job links in the last hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or paste the description instead.`,
          errorType: "rate_limited",
          retryAfter: limit.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const result = await fetchJobFromUrl(body.url, fetcher);
    if (!result.ok) return NextResponse.json({ error: result.error, errorType: result.errorType }, { status: result.status });
    return NextResponse.json(result.job);
  } catch (err) {
    console.error("[jd/fetch] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Importing that link failed on our side.", errorType: "server" }, { status: 500 });
  }
}
