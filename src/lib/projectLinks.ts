// Project links — the repository and live-site addresses shown under each
// project on the tailored CV (preview, Word, PDF and the Applied snapshot).
//
// Per project, in order:
//   1. what the user saved on /customize (Preferences.projectLinks, keyed by
//      projectKey) — an entry wins even with an empty field, so a link the
//      user removed stays removed;
//   2. the project's own lines in the master CV, then in the project pool
//      ("Live: https://… · GitHub: https://…");
//   3. the extracted profile's links, when they are real web addresses.
// Any other link the CV gives a project (a paper, a video) is kept after
// those two. Anything that is not a web address is dropped: the extraction
// wrote {url: "GitHub"} for a CV whose link sat behind the word, and every
// renderer turned it into a link to https://GitHub.
//
// The text shown is the address itself (no protocol, no "www."), never a
// bare word such as "GitHub": a recruiter's system that keeps only the text
// of a CV still has the link. Links are the user's own data, never model
// output.
//
// Import-free: runs in the browser, the routes and under node:test.

export type ProjectLinkLike = { label?: unknown; url?: unknown; text?: unknown };
export type ShownLink = { label: string; url: string; text: string };
export type LinkPair = { github: string; live: string };
export type SavedProjectLinks = Record<string, LinkPair>;
export type LinkPart = { label: string; display: string; href: string };

export const MAX_LINK_URL = 300;
export const MAX_SAVED_PROJECTS = 30;

// File extensions and tech names shaped like a domain ("Next.js",
// "config.yml") — never a web address.
const NOT_A_TLD = new Set([
  "js", "ts", "jsx", "tsx", "mjs", "cjs", "py", "rb", "rs", "java", "kt", "cs", "cpp", "css", "scss",
  "html", "htm", "json", "md", "yml", "yaml", "sql", "txt", "pdf", "doc", "docx", "png", "jpg", "jpeg",
  "gif", "svg", "csv", "xml", "lock", "env", "ipynb",
]);
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const REPO_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

// A web address as an absolute http(s) URL, or "" when the value is not one:
// a bare word ("GitHub", "Ridex"), another scheme (javascript:, mailto:),
// credentials in the URL, or a file name. "jobhuntz.app" becomes
// "https://jobhuntz.app/".
export function cleanUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .trim()
    .replace(/^[<(["'“‘]+/, "")
    .replace(/[>)\]"'”’.,;:!?]+$/, "");
  if (!s || s.length > MAX_LINK_URL || /\s/.test(s)) return "";
  const explicit = /^https?:\/\//i.test(s);
  if (!explicit && /^[a-z][a-z0-9+.-]*:/i.test(s)) return "";
  let u: URL;
  try {
    u = new URL(explicit ? s : `https://${s}`);
  } catch {
    return "";
  }
  if (u.username || u.password) return "";
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host) || NOT_A_TLD.has(host.slice(host.lastIndexOf(".") + 1))) return "";
  return u.href;
}

// The address as the CV shows it: "https://www.jobhuntz.app/" → "jobhuntz.app".
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isRepoUrl(url: string): boolean {
  return REPO_HOSTS.has(hostOf(url));
}

// "GitHub" / "GitLab" / "Bitbucket" by host; "Code" for any other repository.
export function repoLabel(url: string): string {
  const host = hostOf(url);
  if (host === "github.com") return "GitHub";
  if (host === "gitlab.com") return "GitLab";
  if (host === "bitbucket.org") return "Bitbucket";
  return "Code";
}

// The project's own name, without its date or descriptor:
// "RideX — Full-Stack Ride-Hailing Platform (…) · 2025" → "RideX",
// "Jobhuntz – Full-Stack AI Application | 2026" → "Jobhuntz".
export function projectCoreName(name: unknown): string {
  let s = typeof name === "string" ? name : "";
  s = s.split(/\t|\s{3,}/)[0];
  s = s.split(/\s+[|·]\s+/)[0];
  s = s.split(/\s+[—–-]\s+|:\s|\s+\(/)[0];
  s = s.replace(/\s+(?:19|20)\d{2}(?:\s*[–-]\s*(?:(?:19|20)\d{2}|present))?$/i, "");
  return s.trim().replace(/[\s,;]+$/, "");
}

// The key a saved entry is stored under: the core name, letters and digits.
// "Tech Stack", "Technologies", "Tools", "Links": a line that only labels
// what follows, which extraction and the project-line reader both took for a
// project's title (30 Sep: "Tech Stack" appeared under Project links with
// the Jobhuntz address). Never a project name.
const LABEL_ONLY_RE = /^(?:tech(?:nology|nologies)?(?:\s*stack)?|tech\s*stack|technology\s*stack|stack|tools?|tooling|toolkit|links?|skills?|key\s+skills|built\s+with|languages?|frameworks?|libraries|highlights?|overview|summary|details?)$/i;
export function isLabelOnlyProjectName(name: unknown): boolean {
  const core = projectCoreName(name).replace(/[:\s]+$/, "").trim();
  return !!core && LABEL_ONLY_RE.test(core);
}

export function projectKey(name: unknown): string {
  return projectCoreName(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const BULLET_RE = /^\s*(?:[-–•▪◦*·●■]|\d+[.)])\s+/;
const REPO_LABEL_RE = /^(?:github|gitlab|bitbucket|repo|repository|code|source|source code)$/i;
const LIVE_LABEL_RE = /^(?:live|live site|live demo|live app|demo|website|site|web app|webapp|app|url|link|deployed|deployment|production)$/i;
const CANDIDATE_RE =
  /\bhttps?:\/\/[^\s<>()[\]{}|·•,"'“”]+|(?<![@\w./-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>()[\]{}|·•,"'“”]*)?/gi;

function labelBefore(line: string, at: number): string {
  const m = line.slice(0, at).match(/([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*$/);
  return m ? m[1].trim() : "";
}

// The repository and live addresses one line names. A bare "name.tld" counts
// only after a link label ("Live: jobhuntz.app") or on a repository host, so
// "Next.js" in a tech line or a domain in a sentence is never a link.
export function linksInLine(line: string): LinkPair {
  const out: LinkPair = { github: "", live: "" };
  for (const m of line.matchAll(CANDIDATE_RE)) {
    const url = cleanUrl(m[0]);
    if (!url || hostOf(url) === "linkedin.com") continue;
    const label = labelBefore(line, m.index ?? 0);
    const repo = isRepoUrl(url) || REPO_LABEL_RE.test(label);
    if (!/^https?:\/\//i.test(m[0]) && !repo && !LIVE_LABEL_RE.test(label)) continue;
    if (repo) out.github ||= url;
    else out.live ||= url;
  }
  return out;
}

// The links under a project's header in a CV or pool text: the header line
// and the lines after it, up to its first bullet, a blank line, another
// project's header or five lines — where "Live: … · GitHub: …" sits.
export function linksFromText(
  text: string | null | undefined,
  name: string,
  otherNames: readonly string[] = []
): LinkPair {
  const out: LinkPair = { github: "", live: "" };
  const key = projectKey(name);
  if (!key || !text) return out;
  const others = new Set(otherNames.map(projectKey).filter((k) => k && k !== key));
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => !BULLET_RE.test(l) && projectKey(l) === key);
  if (start < 0) return out;
  for (let i = start; i < lines.length && i <= start + 5; i++) {
    const line = lines[i];
    if (i > start && (!line.trim() || BULLET_RE.test(line) || others.has(projectKey(line)))) break;
    const found = linksInLine(line);
    out.github ||= found.github;
    out.live ||= found.live;
  }
  return out;
}

type Kind = "repo" | "live" | "other";

function kindOf(l: ProjectLinkLike, url: string): Kind {
  const label = typeof l.label === "string" ? l.label.trim().replace(/:\s*$/, "") : "";
  if (isRepoUrl(url) || REPO_LABEL_RE.test(label)) return "repo";
  if (!label || LIVE_LABEL_RE.test(label) || cleanUrl(label)) return "live";
  return "other";
}

// One link as every renderer draws it, or null when it goes nowhere. The label
// is shown unless it is empty or itself an address.
export function linkParts(l: ProjectLinkLike | null | undefined): LinkPart | null {
  if (!l || typeof l !== "object") return null;
  const href = cleanUrl(l.url) || cleanUrl(l.text);
  if (!href) return null;
  const display = displayUrl(href);
  const raw = typeof l.label === "string" ? l.label.trim().replace(/:\s*$/, "").slice(0, 40) : "";
  const label = raw && !cleanUrl(raw) && raw.toLowerCase() !== display.toLowerCase() ? raw : "";
  return { label, display, href };
}

// The links line as text ("Live: jobhuntz.app | GitHub: github.com/…"): what
// the page estimates measure, so a project's links line is counted.
export function linksText(links: unknown): string {
  if (!Array.isArray(links)) return "";
  return links
    .map((l) => linkParts(l as ProjectLinkLike))
    .filter((p): p is LinkPart => p !== null)
    .map((p) => (p.label ? `${p.label}: ${p.display}` : p.display))
    .join(" | ");
}

export function pairToLinks(pair: LinkPair): ShownLink[] {
  const out: ShownLink[] = [];
  const live = cleanUrl(pair.live);
  const github = cleanUrl(pair.github);
  if (live) out.push({ label: "Live", url: live, text: displayUrl(live) });
  if (github) out.push({ label: repoLabel(github), url: github, text: displayUrl(github) });
  return out;
}

function hasEntry(saved: SavedProjectLinks | null | undefined, key: string): boolean {
  return !!saved && !!key && Object.prototype.hasOwnProperty.call(saved, key);
}

// What the CV itself gives a project: the text first (master CV, then pool),
// then the extraction's real addresses; plus any other link it lists.
export function autoProjectLinks(
  name: string,
  own: readonly ProjectLinkLike[] | null | undefined,
  sources: readonly (string | null | undefined)[],
  otherNames: readonly string[] = []
): { pair: LinkPair; others: ShownLink[] } {
  const pair: LinkPair = { github: "", live: "" };
  for (const src of sources) {
    const found = linksFromText(src, name, otherNames);
    pair.github ||= found.github;
    pair.live ||= found.live;
  }
  const others: ShownLink[] = [];
  for (const l of Array.isArray(own) ? own : []) {
    const parts = linkParts(l);
    if (!parts) continue;
    const kind = kindOf(l, parts.href);
    if (kind === "repo") pair.github ||= parts.href;
    else if (kind === "live") pair.live ||= parts.href;
    else if (others.length < 2) others.push({ label: parts.label, url: parts.href, text: parts.display });
  }
  return { pair, others };
}

// The links a project shows: the saved pair when there is one, else what the
// CV gives; other links after, never repeating an address.
export function linksForProject(
  name: string,
  own: readonly ProjectLinkLike[] | null | undefined,
  saved: SavedProjectLinks | null | undefined,
  sources: readonly (string | null | undefined)[],
  otherNames: readonly string[] = []
): ShownLink[] {
  const auto = autoProjectLinks(name, own, sources, otherNames);
  const key = projectKey(name);
  const main = pairToLinks(hasEntry(saved, key) ? saved![key] : auto.pair);
  const seen = new Set(main.map((l) => l.url));
  return [...main, ...auto.others.filter((l) => !seen.has(l.url))];
}

// A link written as words inside a project's own text — "GitHub | Live:
// Ridex" on the tech line, a "Live: https://…" bullet — which every renderer
// drew verbatim next to the resolved links line, so the same project showed
// both (30 Sep). The segments that are a link label, with or without an
// address, and bare addresses go; "" when nothing else is left. A label
// followed by words ("Deployed on Vercel") is prose and stays.
const LINK_SEGMENT_RE =
  /^(?:github|gitlab|bitbucket|repo|repository|live|live site|live demo|live app|demo|website|url|link|deployed|deployment)\s*(?::\s*[^\s|]*)?$/i;
export function stripLinkText(text: string): string {
  if (!text) return text;
  const segments = text.split(/\s*(?:\||·|•|—|–)\s*/);
  const kept = segments.filter((seg) => {
    const t = seg.trim();
    if (!t) return false;
    if (LINK_SEGMENT_RE.test(t)) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(t)) return false;
    return true;
  });
  return kept.length === segments.filter((x) => x.trim()).length ? text : kept.join(" | ");
}

// Every project with its links attached (a copy; the input is never mutated),
// and the link text its own tech line and original bullets carried removed —
// the links line is the one place a link is drawn.
export function attachProjectLinks<P extends { name: string; links?: readonly ProjectLinkLike[]; tech?: string; originalBullets?: string[] }>(
  projects: readonly P[],
  saved: SavedProjectLinks | null | undefined,
  sources: readonly (string | null | undefined)[]
): (P & { links: ShownLink[] })[] {
  const names = projects.map((p) => p.name);
  return projects.map((p) => ({
    ...p,
    ...(typeof p.tech === "string" ? { tech: stripLinkText(p.tech) } : {}),
    ...(Array.isArray(p.originalBullets) ? { originalBullets: p.originalBullets.map((b) => stripLinkText(b)).filter(Boolean) } : {}),
    links: linksForProject(p.name, p.links, saved, sources, names),
  }));
}

// Saved entries from storage or a request body: at most MAX_SAVED_PROJECTS,
// keys reduced to letters and digits, every address cleaned ("" = no link).
export function normalizeProjectLinks(v: unknown): SavedProjectLinks {
  const out: SavedProjectLinks = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_SAVED_PROJECTS) break;
    const key = k.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
    if (!key || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    out[key] = { github: cleanUrl(r.github), live: cleanUrl(r.live) };
    n++;
  }
  return out;
}
