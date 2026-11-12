// Any job link → the posting as plain text (12 Nov 2026, Chunk 23), for
// POST /api/applications/jd-from-url. Network-free: the route hands in two fetchers.
//
// - `board`: a known board's link (lib/importJob/parse: Lever, Ashby, Greenhouse, Gem,
//   Workable, SmartRecruiters, Teamtailor, BambooHR, LinkedIn) is read from that board's
//   fixed public address, exactly as /app's "Import job from link" reads it
//   (fetchJobFromUrl). The fetcher only reaches those hosts.
// - `page`: any other link, and a known board that could not be read (not one that says
//   the posting is gone), is fetched as the page it is and read by lib/importJob/readable:
//   its JobPosting block, else its readable text. The fetcher is lib/fetchPage behind its
//   SSRF guard (public http(s) hosts on default ports only, every redirect re-checked).
//
// The text is capped at the tracker's JD limit (MAX_JD_CHARS, 15,000) with the title and
// company on top, as the JD box gets it.
//
// Relative .ts imports only, so it runs under node:test.
import { MAX_JD_CHARS } from "../limits.ts";
import { fetchJobFromUrl, MAX_URL_CHARS, type FetchJobResult, type JobFetcher } from "./fetchJob.ts";
import { parseJobUrl, type JobSource } from "./parse.ts";
import { readablePosting, type PageReading } from "./readable.ts";
import { composeJobText, type ImportedJob } from "./sources.ts";

/** How the text was read: a board's API, the page's JobPosting block, or the page's text. */
export type JobReading = "board" | PageReading;
export type ReadJob = Omit<ImportedJob, "source"> & { source: JobSource | "page"; via: JobReading };
type ReadFail = Extract<FetchJobResult, { ok: false }>;
export type ReadJobResult = { ok: true; job: ReadJob } | ReadFail;

export type PageFetcher = (url: string, opts: { maxBytes: number }) => Promise<{ status: number; body: string; url: string; contentType?: string } | null>;

const MAX_PAGE_BYTES = 3_000_000;
const oneLine = (s: string, max = 200): string => s.replace(/\s+/g, " ").trim().slice(0, max);
const fail = (status: 400 | 422, errorType: ReadFail["errorType"], error: string): ReadFail => ({ ok: false, status, errorType, error });

/** The link as a web address we may fetch, or why not. */
export function readLinkUrl(rawUrl: unknown): { url: URL } | { error: ReadFail } {
  const raw = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!raw) return { error: fail(400, "missing_url", "Send the job link as url.") };
  if (raw.length > MAX_URL_CHARS || /\s/.test(raw)) return { error: fail(400, "unsupported", "That isn't a job link we can read.") };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: fail(400, "unsupported", "That isn't a web address.") };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: fail(400, "unsupported", "Only http(s) job links can be read.") };
  return { url };
}

/** The page at `url` read as a posting. */
export async function readJobPage(url: string, fetcher: PageFetcher): Promise<ReadJobResult> {
  const page = await fetcher(url, { maxBytes: MAX_PAGE_BYTES });
  if (!page) return fail(422, "fetch_failed", "We couldn't reach that page. Check the link, or paste the description instead.");
  if (page.status === 404 || page.status === 410) return fail(422, "not_found", "That page is gone (HTTP " + page.status + "). The posting may have closed.");
  if (page.status !== 200) return fail(422, "fetch_failed", `That page answered with an error (HTTP ${page.status}).`);
  const type = (page.contentType ?? "").toLowerCase();
  if (type && !/html|xml|text\/plain/.test(type)) return fail(422, "no_description", `That link is not a web page we can read (${type.split(";")[0]}). Paste the description instead.`);
  const posting = readablePosting(page.body);
  if (!posting) {
    return fail(422, "no_description", "That page has no job description we can read: it may build the posting with JavaScript. Paste the description instead.");
  }
  const title = oneLine(posting.title);
  const company = oneLine(posting.company, 120);
  const location = oneLine(posting.location, 120);
  return {
    ok: true,
    job: {
      title,
      company,
      location,
      description: composeJobText({ title, company, location, body: posting.body }, MAX_JD_CHARS),
      applyUrl: page.url || url,
      source: "page",
      via: posting.via,
    },
  };
}

/**
 * A job link of any kind as a posting. A known board is read from its API; anything else,
 * or a board that couldn't be read, from the page itself. When both fail, the board's own
 * reason is the one given: it says more than the page's.
 */
export async function readJobFromAnyUrl(rawUrl: unknown, fetchers: { board: JobFetcher; page: PageFetcher }): Promise<ReadJobResult> {
  const link = readLinkUrl(rawUrl);
  if ("error" in link) return link.error;
  const href = link.url.toString();
  const ref = parseJobUrl(href);
  if (!ref) return readJobPage(href, fetchers.page);
  const board = await fetchJobFromUrl(href, fetchers.board);
  if (board.ok) return { ok: true, job: { ...board.job, via: "board" } };
  // The board says the posting is gone: the page would only say so again.
  if (board.errorType === "not_found" || board.errorType === "missing_url") return board;
  const page = await readJobPage(href, fetchers.page);
  return page.ok ? page : board;
}
