// A job posting read off an ordinary web page (12 Nov 2026, Chunk 23), for the links no
// board API serves: Teamtailor (its own pages and the companies' custom domains), and any
// careers page. Pure functions over the HTML a route fetched (tests/): no network here.
//
// Two readings, the first that gives a description wins:
//
// 1. The schema.org JobPosting block (<script type="application/ld+json">) that most
//    applicant trackers put in the page for search engines: title, the hiring company,
//    the place and the description as the employer wrote them. Teamtailor, Workday,
//    Personio, Recruitee, Pinpoint and many company sites carry one. A page carrying
//    several different postings (a listings page) is that: several, never the first one.
// 2. The page's readable text: the <main> (else <article>, else <body>) with scripts,
//    styles, navigation, headers, footers, forms and buttons taken out. A page that
//    builds itself with JavaScript has none to give (Gem's posting page, for one) and
//    is reported as such, never guessed at.
//
// The HTML is the page a USER chose, up to 3 MB, so every scan here runs in linear time:
// tags are found with plain searches that only ever move forward (the review of 12 Nov
// timed the first regex version at 11 s on 200 KB of unclosed "<nav>" tags).
//
// Relative .ts imports only, so it runs under node:test.
import { decodeEntities, dropElements, htmlToPlainText, tidyPlainText, unescapeHtml } from "./text.ts";

export type PageReading = "json_ld" | "page_text";
export type PostingParts = { title: string; company: string; location: string; body: string; via: PageReading };
/** What a page holds: one posting, several (a listings page), or none worth reading. */
export type PageRead = { posting: PostingParts } | { several: number } | null;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneLine = (s: string, max = 200): string => decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, max);

const MAX_PAGE_CHARS = 3_000_000;
const MAX_LD_BLOCKS = 20;
const MAX_LD_CHARS = 1_000_000;
const MAX_POSTINGS = 50;
const MAX_DESCRIPTION_HTML = 200_000;
const MAX_HEAD_CHARS = 200_000;
/** Below this much text a page holds no posting worth reading (a cookie banner, a JS shell). */
export const MIN_PAGE_TEXT = 300;

// ── Linear tag scanning ──────────────────────────────────────────────────────

/** Each <tag …> opening in the HTML, in order, with where its ">" ends; stops at an opening that never ends. */
function* openings(html: string, tag: string): Generator<{ at: number; end: number }> {
  const re = new RegExp(`<${tag}(?=[\\s>/])`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gt = html.indexOf(">", m.index);
    if (gt === -1) return; // no ">" anywhere after: no later tag can end either
    yield { at: m.index, end: gt + 1 };
    re.lastIndex = gt + 1;
  }
}

/**
 * The inner HTML of the first <tag> element, nested elements of the same tag balanced;
 * "" when there is none. One forward pass.
 */
export function innerHtmlByTag(html: string, tag: string): string {
  const first = openings(html, tag).next();
  if (first.done) return "";
  const start = first.value.end;
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])`, "gi");
  re.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gt = html.indexOf(">", m.index);
    if (gt === -1) break;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
    re.lastIndex = gt + 1;
  }
  return html.slice(start);
}

/** The text of each <script type="application/ld+json"> block, in order, at most `max`. */
function ldBlocks(html: string, max: number): string[] {
  const out: string[] = [];
  const closeRe = /<\/script\s*>/gi;
  let searchedTo = -1;
  let nextClose: { at: number; end: number } | null = null;
  for (const o of openings(html, "script")) {
    if (out.length >= max) break;
    if (o.at < searchedTo) continue; // inside the last block's text
    // The closing tag: searched for only forward of the last search.
    if (!nextClose || nextClose.at < o.end) {
      closeRe.lastIndex = o.end;
      const m = closeRe.exec(html);
      nextClose = m ? { at: m.index, end: m.index + m[0].length } : null;
      if (!nextClose) break; // no script closes after here
    }
    searchedTo = nextClose.end;
    const tag = html.slice(o.at, o.end);
    if (/\btype\s*=\s*["']?application\/ld\+json/i.test(tag)) out.push(html.slice(o.end, nextClose.at));
  }
  return out;
}

/** The content of the first <meta property|name="…"> naming `property`. */
function metaContent(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new RegExp(`\\b(?:property|name)\\s*=\\s*["']${escaped}["']`, "i");
  for (const o of openings(html, "meta")) {
    const tag = html.slice(o.at, o.end);
    if (!names.test(tag)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (content) return content[1] ?? content[2] ?? "";
  }
  return "";
}

// ── The JobPosting block ─────────────────────────────────────────────────────

function isJobPosting(node: Raw): boolean {
  const t = node["@type"];
  return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
}

// Every JobPosting in a JSON-LD value: the value itself, arrays of them, an @graph, a
// page's mainEntity or an ItemList's items. Bounded: a page's JSON is user input.
function collectPostings(value: unknown, out: Raw[], depth = 0): void {
  if (depth > 6 || out.length >= MAX_POSTINGS) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_POSTINGS)) collectPostings(item, out, depth + 1);
    return;
  }
  const node = obj(value);
  if (!node) return;
  if (isJobPosting(node)) {
    out.push(node);
    return;
  }
  collectPostings(node["@graph"], out, depth + 1);
  collectPostings(node.mainEntity, out, depth + 1);
  collectPostings(node.itemListElement, out, depth + 1);
  collectPostings(node.item, out, depth + 1);
}

// JSON-LD is often written with raw line breaks inside its strings, which JSON.parse
// refuses. A control character is whitespace between tokens and a space inside a string,
// so replacing each with a space changes no structure.
function parseLd(text: string): unknown {
  const body = text.trim().replace(/^<!--/, "").replace(/-->$/, "").replace(/^\/\/\s*<!\[CDATA\[/, "").replace(/\/\/\s*\]\]>$/, "").trim();
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      return null;
    }
  }
}

const nameOf = (v: unknown): string => (typeof v === "string" ? oneLine(v, 120) : oneLine(str(obj(v)?.name), 120));

function placeOf(posting: Raw): string {
  const places: string[] = [];
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  for (const loc of locations.slice(0, 5)) {
    const address = obj(obj(loc)?.address) ?? obj(loc);
    if (!address) {
      if (typeof loc === "string") places.push(oneLine(loc, 80));
      continue;
    }
    const parts = [address.addressLocality, address.addressRegion, address.addressCountry].map(nameOf).filter(Boolean);
    const place = [...new Set(parts)].join(", ");
    if (place && !places.includes(place)) places.push(place);
  }
  const type = posting.jobLocationType;
  const remote = type === "TELECOMMUTE" || (Array.isArray(type) && type.includes("TELECOMMUTE"));
  if (remote) places.push("Remote");
  return places.join(" · ").slice(0, 120);
}

// An address compared as the same page: host lower-cased, no query, fragment or trailing slash.
function samePage(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      const u = new URL(s);
      return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return "";
    }
  };
  const x = norm(a);
  return !!x && x === norm(b);
}

function toParts(posting: Raw): PostingParts | null {
  const description = str(posting.description, MAX_DESCRIPTION_HTML);
  const body = tidyPlainText(htmlToPlainText(unescapeHtml(description)));
  if (body.length < 40) return null;
  return { title: oneLine(str(posting.title)), company: nameOf(posting.hiringOrganization), location: placeOf(posting), body, via: "json_ld" };
}

/**
 * The page's JobPosting, if it carries exactly one (the same one twice counts once). With
 * several different ones, the one whose `url` is this page (`pageUrl`); otherwise the page
 * is a listing: { several }.
 */
export function readJsonLd(html: string, pageUrl = ""): PageRead {
  const page = (html || "").slice(0, MAX_PAGE_CHARS);
  const found: Raw[] = [];
  for (const block of ldBlocks(page, MAX_LD_BLOCKS)) {
    if (block.length > MAX_LD_CHARS) continue;
    collectPostings(parseLd(block), found);
  }
  const postings: { raw: Raw; parts: PostingParts }[] = [];
  for (const raw of found) {
    const parts = toParts(raw);
    if (parts && !postings.some((p) => p.parts.body === parts.body)) postings.push({ raw, parts });
  }
  if (postings.length === 0) return null;
  if (postings.length === 1) return { posting: postings[0].parts };
  const mine = pageUrl ? postings.filter((p) => typeof p.raw.url === "string" && samePage(p.raw.url, pageUrl)) : [];
  return mine.length === 1 ? { posting: mine[0].parts } : { several: postings.length };
}

/** The page's one JobPosting, or null (none, or several with no way to tell which). */
export function jobPostingFromJsonLd(html: string, pageUrl = ""): PostingParts | null {
  const read = readJsonLd(html, pageUrl);
  return read && "posting" in read ? read.posting : null;
}

// ── The readable text ────────────────────────────────────────────────────────

// What is never the posting: the page's furniture and anything to fill in or press.
const FURNITURE = ["script", "style", "noscript", "template", "svg", "iframe", "nav", "header", "footer", "aside", "button", "select", "textarea", "dialog"];
// A short line asking the reader to accept or manage cookies is a banner, not the job.
const COOKIE_LINE_RE = /\bcookies?\b/i;
const COOKIE_ASK_RE = /\b(accept|consent|reject|allow|manage)\b/i;

function textOf(html: string, dropForms: boolean): string {
  const stripped = dropElements(html, dropForms ? [...FURNITURE, "form"] : FURNITURE);
  const lines = htmlToPlainText(stripped)
    .split("\n")
    .filter((line) => !(line.length < 200 && COOKIE_LINE_RE.test(line) && COOKIE_ASK_RE.test(line)));
  return tidyPlainText(lines.join("\n"));
}

// Forms out first (an application form is not the job); a page that wraps its whole body
// in one <form> (ASP.NET WebForms careers sites) is read again with its form kept.
function readableText(html: string): string {
  const text = textOf(html, true);
  return text.length >= MIN_PAGE_TEXT ? text : textOf(html, false);
}

/** The page's readable text as a posting, or null when it holds too little to be one. */
export function readablePageText(html: string): PostingParts | null {
  const page = (html || "").slice(0, MAX_PAGE_CHARS);
  const head = (innerHtmlByTag(page, "head") || page).slice(0, MAX_HEAD_CHARS);
  let body = "";
  for (const tag of ["main", "article"]) {
    const inner = innerHtmlByTag(page, tag);
    const text = inner ? readableText(inner) : "";
    if (text.length >= MIN_PAGE_TEXT) {
      body = text;
      break;
    }
  }
  if (!body) body = readableText(innerHtmlByTag(page, "body") || page);
  if (body.length < MIN_PAGE_TEXT) return null;
  const title = oneLine(metaContent(head, "og:title")) || oneLine(htmlToPlainText(innerHtmlByTag(head, "title"))) || oneLine(htmlToPlainText(innerHtmlByTag(page, "h1")));
  return { title, company: oneLine(metaContent(head, "og:site_name"), 120), location: "", body, via: "page_text" };
}

/**
 * A web page as a posting: its one JobPosting, else its readable text. A page carrying
 * several postings is a listing ({ several }), and its text is never taken for one job.
 */
export function readablePosting(html: string, pageUrl = ""): PageRead {
  const ld = readJsonLd(html, pageUrl);
  if (ld) return ld;
  const text = readablePageText(html);
  return text ? { posting: text } : null;
}
