// "Import job from link" on /app: a Lever, Ashby, Greenhouse or LinkedIn job
// link → the posting as plain text for the JD box, plus its company, title,
// location and apply link. No model call, no credit.
//
// SECURITY: the link never becomes the fetched address. lib/importJob/parse
// reads a board and a posting id off one of four job-board hosts and builds
// the request on a fixed API host; fetchPage's SSRF guard runs as usual and
// `allowHost` refuses any host outside IMPORT_FETCH_HOSTS, redirects included.
// Rate limit: 20 imports per user per hour (lib/apiRateLimit).

import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { fetchPage, FetchPageError, UnsafeUrlError } from "@/lib/fetchPage";
import { parseJobUrl, sourceApiUrl, IMPORT_FETCH_HOSTS, SOURCE_LABELS } from "@/lib/importJob/parse";
import { extractJob } from "@/lib/importJob/sources";

export const runtime = "nodejs";
export const maxDuration = 30;

const IMPORT_LIMIT = { limit: 20, windowSeconds: 3600 };
const MAX_URL_CHARS = 2048;
// Ashby answers with the whole job board, descriptions included.
const MAX_BOARD_BYTES = 8_000_000;
const MAX_POSTING_BYTES = 2_000_000;

// The reason only: /app puts "We couldn't read that link — paste the
// description instead." in front of it.

function failed(status: number, errorType: string, error: string) {
  return NextResponse.json({ error, errorType }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { userId } = caller;

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
    const raw = typeof body.url === "string" ? body.url.trim() : "";
    if (!raw) return failed(400, "missing_url", "Paste a job link first.");
    if (raw.length > MAX_URL_CHARS) return failed(400, "unsupported", "That link is too long to be a job posting.");

    const ref = parseJobUrl(raw);
    if (!ref) {
      return failed(
        400,
        "unsupported",
        "That isn't a link we can read yet. We read job links from Lever, Ashby, Greenhouse and LinkedIn."
      );
    }
    const label = SOURCE_LABELS[ref.source];

    let page;
    try {
      page = await fetchPage(sourceApiUrl(ref), {
        timeoutMs: 10_000,
        maxBytes: ref.source === "ashby" ? MAX_BOARD_BYTES : MAX_POSTING_BYTES,
        allowHost: (host) => IMPORT_FETCH_HOSTS.has(host),
      });
    } catch (e) {
      if (e instanceof UnsafeUrlError || e instanceof FetchPageError) {
        console.warn(`[import-job] ${ref.source} fetch failed:`, e instanceof FetchPageError ? `${e.kind} ${e.code}` : e.message);
        return failed(422, "fetch_failed", `We couldn't reach ${label} just now. Try again in a minute.`);
      }
      throw e;
    }

    if (page.status === 404 || page.status === 410) {
      return failed(422, "not_found", `${label} has no posting at that link. It may have closed.`);
    }
    if (page.status !== 200) {
      console.warn(`[import-job] ${ref.source} answered HTTP ${page.status}`);
      const refused = ref.source === "linkedin" && (page.status === 429 || page.status === 999 || page.status === 403);
      return failed(
        422,
        "fetch_failed",
        refused
          ? "LinkedIn wouldn't show us that posting just now."
          : `${label} answered with an error (HTTP ${page.status}).`
      );
    }

    const job = extractJob(ref, page.body);
    if (!job) {
      return failed(422, "no_description", `We found that link on ${label} but couldn't read a job description from it.`);
    }
    return NextResponse.json(job);
  } catch (err) {
    console.error("[import-job] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Importing that link failed on our side.", errorType: "server" }, { status: 500 });
  }
}
