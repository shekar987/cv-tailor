// "Import job from link" on /app: which job links we can read, and the one
// public address each is read from. Import-free and network-free (tests/).
//
// SECURITY: the link is user input, but it never becomes the address we
// fetch. parseJobUrl() only pulls a board name and a posting id out of a link
// on one of four job-board hosts, each checked against a strict pattern, and
// sourceApiUrl() builds the request on a FIXED API host from those two
// values. Anything else is unsupported, so no user-chosen host is fetched.

export type JobSource = "lever" | "ashby" | "greenhouse" | "linkedin";

export type JobRef = {
  source: JobSource;
  /** Lever company, Ashby slug, Greenhouse board; "" for LinkedIn. */
  board: string;
  /** The posting's id as the board writes it. */
  id: string;
  /** Lever's EU board (jobs.eu.lever.co) is served by api.eu.lever.co. */
  eu?: boolean;
};

export const SOURCE_LABELS: Record<JobSource, string> = {
  lever: "Lever",
  ashby: "Ashby",
  greenhouse: "Greenhouse",
  linkedin: "LinkedIn",
};

// Every host the import route may request — the fixed API hosts behind the
// four sources. The route refuses any other host, redirects included.
export const IMPORT_FETCH_HOSTS: ReadonlySet<string> = new Set([
  "api.lever.co",
  "api.eu.lever.co",
  "api.ashbyhq.com",
  "boards-api.greenhouse.io",
  "www.linkedin.com",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVER_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ASHBY_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const GREENHOUSE_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const GREENHOUSE_ID_RE = /^\d{1,20}$/;
const LINKEDIN_ID_RE = /^\d{6,20}$/;

function segmentsOf(url: URL): string[] | null {
  const out: string[] = [];
  for (const part of url.pathname.split("/")) {
    if (!part) continue;
    try {
      out.push(decodeURIComponent(part));
    } catch {
      return null;
    }
  }
  return out;
}

function isLinkedInHost(host: string): boolean {
  return host === "linkedin.com" || host === "www.linkedin.com" || /^[a-z]{2}\.linkedin\.com$/.test(host);
}

/** The board and posting a supported job link names, or null. */
export function parseJobUrl(raw: string): JobRef | null {
  let text = (raw || "").trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segs = segmentsOf(url);
  if (!segs) return null;

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [board, id, rest, ...more] = segs;
    if (!board || !id || more.length || (rest && rest !== "apply")) return null;
    if (!LEVER_BOARD_RE.test(board) || !UUID_RE.test(id)) return null;
    return { source: "lever", board, id: id.toLowerCase(), ...(host === "jobs.eu.lever.co" ? { eu: true } : {}) };
  }

  if (host === "jobs.ashbyhq.com") {
    const [board, id, rest, ...more] = segs;
    if (!board || !id || more.length || (rest && rest !== "application")) return null;
    if (!ASHBY_BOARD_RE.test(board) || !UUID_RE.test(id)) return null;
    return { source: "ashby", board, id: id.toLowerCase() };
  }

  if (host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") {
    const [board, jobs, id, ...more] = segs;
    if (!board || jobs !== "jobs" || !id || more.length) return null;
    if (!GREENHOUSE_BOARD_RE.test(board) || !GREENHOUSE_ID_RE.test(id)) return null;
    return { source: "greenhouse", board, id };
  }

  if (isLinkedInHost(host)) {
    const path = segs[0] === "comm" ? segs.slice(1) : segs;
    if (path[0] !== "jobs") return null;
    const current = url.searchParams.get("currentJobId");
    if (current !== null) {
      return LINKEDIN_ID_RE.test(current) ? { source: "linkedin", board: "", id: current } : null;
    }
    if (path[1] !== "view" || !path[2] || path.length > 3) return null;
    // /jobs/view/4012345678 or /jobs/view/software-engineer-at-acme-4012345678
    const m = /(?:^|-)(\d{6,20})$/.exec(path[2]);
    return m ? { source: "linkedin", board: "", id: m[1] } : null;
  }

  return null;
}

/** The one public address the posting is read from — always a fixed host. */
export function sourceApiUrl(ref: JobRef): string {
  const board = encodeURIComponent(ref.board);
  const id = encodeURIComponent(ref.id);
  switch (ref.source) {
    case "lever":
      return `https://api${ref.eu ? ".eu" : ""}.lever.co/v0/postings/${board}/${id}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${board}`;
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`;
    case "linkedin":
      return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
  }
}

/** The posting's own public page, for when the source gives no apply link. */
export function postingPageUrl(ref: JobRef): string {
  const board = encodeURIComponent(ref.board);
  const id = encodeURIComponent(ref.id);
  switch (ref.source) {
    case "lever":
      return `https://jobs${ref.eu ? ".eu" : ""}.lever.co/${board}/${id}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${board}/${id}`;
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${board}/jobs/${id}`;
    case "linkedin":
      return `https://www.linkedin.com/jobs/view/${id}/`;
  }
}

/** A board slug as a readable name ("acme-labs" → "Acme Labs"). */
export function boardDisplayName(board: string): string {
  return board
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
