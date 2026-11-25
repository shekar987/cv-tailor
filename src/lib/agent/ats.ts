// Local Agent (Chunk 33): which applicant-tracking system a job URL belongs to,
// and the normalised form of a URL the queue dedupes on. Import-free and
// network-free (tests/agentAts) — the URL is just classified by its host and
// path, never fetched here.
//
// detectAts returns one of eight: the six systems the worker will learn to
// drive, "other" for a valid job URL on a host we don't recognise (a careers
// page, or an ATS we haven't added), and "unknown" when the text isn't even a
// usable http(s) URL.

export type Ats =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "pinpoint"
  | "workable"
  | "other"
  | "unknown";

export const ATS_LABELS: Record<Ats, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  pinpoint: "Pinpoint",
  workable: "Workable",
  other: "Other site",
  unknown: "Unknown",
};

/** Parse a URL, allowing a bare host with no scheme ("jobs.lever.co/acme/…"). */
function parseUrl(raw: string): URL | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    // No scheme: try again with https, but only when it looks like a host.
    if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/|$|\?|#)/i.test(text)) return null;
    try {
      const url = new URL(`https://${text}`);
      if (!url.hostname.includes(".")) return null;
      return url;
    } catch {
      return null;
    }
  }
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/** LinkedIn is blocked at queue time (guardrails.LINKEDIN_BLOCKED). */
export function isLinkedIn(raw: string): boolean {
  const url = parseUrl(raw);
  if (!url) return false;
  const host = hostOf(url);
  return host === "linkedin.com" || host.endsWith(".linkedin.com") || host === "lnkd.in";
}

export function detectAts(raw: string): Ats {
  const url = parseUrl(raw);
  if (!url) return "unknown";
  const host = hostOf(url);

  // Greenhouse: boards / job-boards / embed, the EU hosts, and the grnh.se short link.
  if (
    host === "grnh.se" ||
    host.endsWith("greenhouse.io") ||
    host.endsWith(".greenhouse.io")
  ) {
    return "greenhouse";
  }

  // Lever: jobs.lever.co and jobs.eu.lever.co.
  if (host === "lever.co" || host.endsWith(".lever.co")) return "lever";

  // Ashby: jobs.ashbyhq.com.
  if (host === "ashbyhq.com" || host.endsWith(".ashbyhq.com")) return "ashby";

  // Workday: every tenant is <name>.<dc>.myworkdayjobs.com.
  if (host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com") || host.endsWith(".workday.com")) {
    return "workday";
  }

  // Pinpoint: <company>.pinpointhq.com (and the app host).
  if (host === "pinpointhq.com" || host.endsWith(".pinpointhq.com")) return "pinpoint";

  // Workable: apply.workable.com, jobs.workable.com, <company>.workable.com.
  if (host === "workable.com" || host.endsWith(".workable.com")) return "workable";

  return "other";
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
  "referrer",
  "source",
  "src",
  "lever-source",
  "lever-origin",
  "gh_src",
  "trk",
  "trackingid",
]);

/**
 * The form the duplicate check keys on. Lowercases the host, drops "www.",
 * forces https, strips the fragment and tracking query parameters, sorts the
 * rest, and drops a trailing slash — so two links to the same posting that
 * differ only by a utm tag or a scheme count as one. An unparseable string is
 * returned trimmed and lowercased, so even junk dedupes against itself.
 */
export function normaliseJobUrl(raw: string): string {
  const url = parseUrl(raw);
  if (!url) return (raw || "").trim().toLowerCase();
  const host = hostOf(url);
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `https://${host}${path}${query}`;
}
