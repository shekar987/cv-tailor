// A job posting read off an ordinary web page (12 Nov 2026, Chunk 23), for the links no
// board API serves: Teamtailor (its own pages and the companies' custom domains), and any
// careers page. Pure functions over the HTML a route fetched (tests/): no network here.
//
// Two readings, the first that gives a description wins:
//
// 1. The schema.org JobPosting block (<script type="application/ld+json">) that most
//    applicant trackers put in the page for search engines: title, the hiring company,
//    the place and the description as the employer wrote them. Teamtailor, Workday,
//    Personio, Recruitee, Pinpoint and many company sites carry one.
// 2. The page's readable text: the <main> (else <article>, else <body>) with scripts,
//    styles, navigation, headers, footers, forms and buttons taken out. A page that
//    builds itself with JavaScript has none to give (Gem's posting page, for one) and
//    is reported as such, never guessed at.
//
// Relative .ts imports only, so it runs under node:test.
import { decodeEntities, htmlToPlainText, tidyPlainText, unescapeHtml } from "./text.ts";

export type PageReading = "json_ld" | "page_text";
export type PostingParts = { title: string; company: string; location: string; body: string; via: PageReading };

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneLine = (s: string, max = 200): string => decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, max);

const MAX_PAGE_CHARS = 3_000_000;
const MAX_LD_BLOCKS = 20;
const MAX_LD_CHARS = 1_000_000;
const MAX_DESCRIPTION_HTML = 200_000;
/** Below this much text a page holds no posting worth reading (a cookie banner, a JS shell). */
export const MIN_PAGE_TEXT = 300;

const LD_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

function isJobPosting(node: Raw): boolean {
  const t = node["@type"];
  return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
}

// The JobPosting in a JSON-LD value: the value itself, an array of them, an @graph, or a
// page's mainEntity. Bounded depth: a page's JSON is user input.
function findPosting(value: unknown, depth = 0): Raw | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) {
      const found = findPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const node = obj(value);
  if (!node) return null;
  if (isJobPosting(node)) return node;
  return findPosting(node["@graph"], depth + 1) ?? findPosting(node.mainEntity, depth + 1);
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

/** The JobPosting block's posting, or null when the page carries none with a description. */
export function jobPostingFromJsonLd(html: string): PostingParts | null {
  const page = (html || "").slice(0, MAX_PAGE_CHARS);
  LD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  for (let n = 0; n < MAX_LD_BLOCKS && (m = LD_RE.exec(page)) !== null; n++) {
    if (m[1].length > MAX_LD_CHARS) continue;
    const posting = findPosting(parseLd(m[1]));
    if (!posting) continue;
    const description = str(posting.description, MAX_DESCRIPTION_HTML);
    const body = tidyPlainText(htmlToPlainText(unescapeHtml(description)));
    if (body.length < 40) continue;
    return {
      title: oneLine(str(posting.title)),
      company: nameOf(posting.hiringOrganization),
      location: placeOf(posting),
      body,
      via: "json_ld",
    };
  }
  return null;
}

/**
 * The inner HTML of the first <tag> element, nested elements of the same tag balanced;
 * "" when there is none.
 */
export function innerHtmlByTag(html: string, tag: string): string {
  const open = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, "i").exec(html);
  if (!open) return "";
  const start = open.index + open[0].length;
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

// What is never the posting: the page's furniture and anything to fill in or press.
const FURNITURE_RE = /<(script|style|noscript|template|svg|iframe|form|nav|header|footer|aside|button|select|textarea|dialog)(?=[\s>/])[\s\S]*?<\/\1\s*>/gi;
// A short line asking about cookies is a banner, not the job.
const COOKIE_LINE_RE = /\bcookies?\b/i;
const COOKIE_ASK_RE = /\b(accept|consent|preferences|policy|settings|reject|allow)\b/i;

function stripFurniture(html: string): string {
  // Twice: a <nav> inside a <header> leaves the outer one's tail after the first pass.
  return html.replace(FURNITURE_RE, " ").replace(FURNITURE_RE, " ");
}

function textOf(html: string): string {
  const lines = htmlToPlainText(stripFurniture(html))
    .split("\n")
    .filter((line) => !(line.length < 200 && COOKIE_LINE_RE.test(line) && COOKIE_ASK_RE.test(line)));
  return tidyPlainText(lines.join("\n"));
}

function metaContent(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(`<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, "i").exec(html);
  if (a) return a[1];
  const b = new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\b(?:property|name)\\s*=\\s*["']${escaped}["']`, "i").exec(html);
  return b ? b[1] : "";
}

/** The page's readable text as a posting, or null when it holds too little to be one. */
export function readablePageText(html: string): PostingParts | null {
  const page = (html || "").slice(0, MAX_PAGE_CHARS);
  const head = innerHtmlByTag(page, "head") || page.slice(0, 50_000);
  let body = "";
  for (const tag of ["main", "article"]) {
    const inner = innerHtmlByTag(page, tag);
    const text = inner ? textOf(inner) : "";
    if (text.length >= MIN_PAGE_TEXT) {
      body = text;
      break;
    }
  }
  if (!body) body = textOf(innerHtmlByTag(page, "body") || page);
  if (body.length < MIN_PAGE_TEXT) return null;
  const h1 = innerHtmlByTag(page, "h1");
  const title = oneLine(metaContent(head, "og:title")) || oneLine(htmlToPlainText(innerHtmlByTag(head, "title"))) || oneLine(htmlToPlainText(h1));
  return { title, company: oneLine(metaContent(head, "og:site_name"), 120), location: "", body, via: "page_text" };
}

/** A web page as a posting: its JobPosting block, else its readable text, else null. */
export function readablePosting(html: string): PostingParts | null {
  return jobPostingFromJsonLd(html) ?? readablePageText(html);
}
