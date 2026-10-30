// "Import job from link" on /app: which job links we can read, and the one
// public address each is read from. Import-free and network-free (tests/).
//
// SECURITY: the link is user input, but it never becomes the address we
// fetch. parseJobUrl() only pulls a board name and a posting id out of a link
// on one of four job-board hosts, each checked against a strict pattern, and
// sourceApiUrl() builds the request on a FIXED API host from those two
// values. Anything else is unsupported, so no user-chosen host is fetched.
// BambooHR is the one board served from the company's own subdomain
// (<company>.bamboohr.com): the subdomain is held to one DNS label of
// letters, digits and hyphens, so the host is always a bamboohr.com host.
//
// Workable, SmartRecruiters and BambooHR since 31 Oct 2026 (Chunk 6,
// /api/jd/fetch). A Workable short link (apply.workable.com/j/<code>) names
// no account: the route follows its redirect on apply.workable.com and
// parses the address it lands on (workableShortLinkUrl).

export type JobSource = "lever" | "ashby" | "greenhouse" | "linkedin" | "workable" | "smartrecruiters" | "bamboohr";

export type JobRef = {
  source: JobSource;
  /** Lever company, Ashby slug, Greenhouse board, Workable account, SmartRecruiters company, BambooHR subdomain; "" for LinkedIn and a Workable short link. */
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
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  bamboohr: "BambooHR",
};

/** The boards the import reads, for the "we read job links from …" sentence. */
export const SUPPORTED_SOURCES_TEXT = "Lever, Ashby, Greenhouse, Workable, SmartRecruiters, BambooHR and LinkedIn";

// Every host the import route may request — the fixed API hosts behind the
// four sources. The route refuses any other host, redirects included.
export const IMPORT_FETCH_HOSTS: ReadonlySet<string> = new Set([
  "api.lever.co",
  "api.eu.lever.co",
  "api.ashbyhq.com",
  "boards-api.greenhouse.io",
  "www.linkedin.com",
  "apply.workable.com",
  "api.smartrecruiters.com",
]);

// <company>.bamboohr.com: one DNS label, never a deeper name.
const BAMBOO_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bamboohr\.com$/;

/** Whether the import route may request this host (the fixed set, or a BambooHR company subdomain). */
export function isImportFetchHost(host: string): boolean {
  const h = host.toLowerCase();
  return IMPORT_FETCH_HOSTS.has(h) || BAMBOO_HOST_RE.test(h);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVER_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ASHBY_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const GREENHOUSE_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const GREENHOUSE_ID_RE = /^\d{1,20}$/;
const LINKEDIN_ID_RE = /^\d{6,20}$/;
const WORKABLE_ACCOUNT_RE = /^[a-z0-9][a-z0-9-]{0,99}$/i;
const WORKABLE_CODE_RE = /^[A-Z0-9]{6,16}$/i;
const SMARTRECRUITERS_COMPANY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const SMARTRECRUITERS_ID_RE = /^(\d{6,20})(?:-[A-Za-z0-9-]*)?$/;
const BAMBOO_ID_RE = /^\d{1,10}$/;

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

  // Workable: apply.workable.com/<account>/j/<code>[/apply], the short link
  // apply.workable.com/j/<code>, and the older <account>.workable.com/j/<code>.
  if (host === "apply.workable.com") {
    if (segs[0] === "j") {
      const [, code, rest, ...more] = segs;
      if (!code || more.length || (rest && rest !== "apply") || !WORKABLE_CODE_RE.test(code)) return null;
      return { source: "workable", board: "", id: code.toUpperCase() };
    }
    const [account, j, code, rest, ...more] = segs;
    if (!account || j !== "j" || !code || more.length || (rest && rest !== "apply")) return null;
    if (!WORKABLE_ACCOUNT_RE.test(account) || !WORKABLE_CODE_RE.test(code)) return null;
    return { source: "workable", board: account.toLowerCase(), id: code.toUpperCase() };
  }
  const legacyWorkable = /^([a-z0-9][a-z0-9-]{0,62})\.workable\.com$/.exec(host);
  if (legacyWorkable && !["apply", "www", "jobs"].includes(legacyWorkable[1])) {
    const [j, code, rest, ...more] = segs;
    if ((j !== "j" && j !== "jobs") || !code || more.length || (rest && rest !== "apply") || !WORKABLE_CODE_RE.test(code)) return null;
    return { source: "workable", board: legacyWorkable[1], id: code.toUpperCase() };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<Company>/<id>-<slug>.
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    const [company, posting, ...more] = segs;
    if (!company || !posting || more.length || !SMARTRECRUITERS_COMPANY_RE.test(company)) return null;
    const m = SMARTRECRUITERS_ID_RE.exec(posting);
    return m ? { source: "smartrecruiters", board: company, id: m[1] } : null;
  }

  // BambooHR: <company>.bamboohr.com/careers/<id>, or the older /jobs/view.php?id=<id>.
  if (BAMBOO_HOST_RE.test(host)) {
    const company = host.slice(0, -".bamboohr.com".length);
    if (company === "www" || company === "api") return null;
    if (segs[0] === "careers" && segs[1] && BAMBOO_ID_RE.test(segs[1]) && (segs.length === 2 || (segs.length === 3 && segs[2] === "detail"))) {
      return { source: "bamboohr", board: company, id: segs[1] };
    }
    const viewId = url.searchParams.get("id");
    if (segs.length === 2 && segs[0] === "jobs" && segs[1] === "view.php" && viewId && BAMBOO_ID_RE.test(viewId)) {
      return { source: "bamboohr", board: company, id: viewId };
    }
    return null;
  }

  return null;
}

/** Where a Workable short link (no account) is followed to find its account. */
export function workableShortLinkUrl(ref: JobRef): string {
  return `https://apply.workable.com/j/${encodeURIComponent(ref.id)}`;
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
    case "workable":
      return `https://apply.workable.com/api/v2/accounts/${board}/jobs/${id}`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${board}/postings/${id}`;
    case "bamboohr":
      return `https://${board}.bamboohr.com/careers/${id}/detail`;
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
    case "workable":
      return ref.board ? `https://apply.workable.com/${board}/j/${id}/` : `https://apply.workable.com/j/${id}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${board}/${id}`;
    case "bamboohr":
      return `https://${board}.bamboohr.com/careers/${id}`;
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
