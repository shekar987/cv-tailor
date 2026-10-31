// A job link → the posting as plain text, server side (POST /api/jd/fetch,
// 31 Oct 2026, Chunk 6). The flow without the network: the route hands in
// `fetcher` (lib/fetchPage behind the SSRF guard and the allowed hosts), the
// tests hand in a mock per board.
//
// The link is parsed (lib/importJob/parse) and the request built on a fixed
// API host; a Workable short link is first followed on apply.workable.com to
// learn its account. Each failure has its own reason, which /app puts after
// "We couldn't read that link — paste the description instead."
//
// Relative .ts imports only, so it runs under node:test.
import { parseJobUrl, sourceApiUrl, workableShortLinkUrl, SOURCE_LABELS, SUPPORTED_SOURCES_TEXT, type JobRef } from "./parse.ts";
import { extractJob, type ImportedJob } from "./sources.ts";

export type FetchedJobPage = { status: number; body: string; url: string };
/** Reads one address; null when it could not be reached at all. */
export type JobFetcher = (url: string, opts: { maxBytes: number }) => Promise<FetchedJobPage | null>;

export type FetchJobResult =
  | { ok: true; job: ImportedJob }
  | { ok: false; status: 400 | 422; errorType: "missing_url" | "unsupported" | "fetch_failed" | "not_found" | "no_description"; error: string };

export const MAX_URL_CHARS = 2048;
// Ashby answers with the whole job board, descriptions included.
const MAX_BOARD_BYTES = 8_000_000;
const MAX_POSTING_BYTES = 2_000_000;
const MAX_REDIRECT_PAGE_BYTES = 1_000_000;

const fail = (status: 400 | 422, errorType: Extract<FetchJobResult, { ok: false }>["errorType"], error: string): FetchJobResult => ({ ok: false, status, errorType, error });

export async function fetchJobFromUrl(rawUrl: unknown, fetcher: JobFetcher): Promise<FetchJobResult> {
  const raw = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!raw) return fail(400, "missing_url", "Paste a job link first.");
  if (raw.length > MAX_URL_CHARS) return fail(400, "unsupported", "That link is too long to be a job posting.");

  let ref: JobRef | null = parseJobUrl(raw);
  if (!ref) return fail(400, "unsupported", `That isn't a link we can read yet. We read job links from ${SUPPORTED_SOURCES_TEXT}.`);
  const label = SOURCE_LABELS[ref.source];

  // A Workable short link: where apply.workable.com sends it names the account.
  if (ref.source === "workable" && !ref.board) {
    const landing = await fetcher(workableShortLinkUrl(ref), { maxBytes: MAX_REDIRECT_PAGE_BYTES });
    if (!landing) return fail(422, "fetch_failed", `We couldn't reach ${label} just now. Try again in a minute.`);
    if (landing.status === 404 || landing.status === 410) return fail(422, "not_found", `${label} has no posting at that link. It may have closed.`);
    const resolved = parseJobUrl(landing.url);
    if (!resolved || resolved.source !== "workable" || !resolved.board) {
      return fail(422, "no_description", `We found that link on ${label} but couldn't tell which company it belongs to.`);
    }
    ref = resolved;
  }

  const page = await fetcher(sourceApiUrl(ref), { maxBytes: ref.source === "ashby" ? MAX_BOARD_BYTES : MAX_POSTING_BYTES });
  if (!page) return fail(422, "fetch_failed", `We couldn't reach ${label} just now. Try again in a minute.`);
  if (page.status === 404 || page.status === 410) return fail(422, "not_found", `${label} has no posting at that link. It may have closed.`);
  if (page.status !== 200) {
    const refused = ref.source === "linkedin" && (page.status === 429 || page.status === 999 || page.status === 403);
    return fail(422, "fetch_failed", refused ? "LinkedIn wouldn't show us that posting just now." : `${label} answered with an error (HTTP ${page.status}).`);
  }
  const job = extractJob(ref, page.body);
  if (!job) return fail(422, "no_description", `We found that link on ${label} but couldn't read a job description from it.`);
  return { ok: true, job };
}
