// What each job board's public answer holds, read into one shape. Pure
// functions over the JSON / HTML the route fetched (tests/): no network here.

import { MAX_JD_CHARS } from "../limits.ts";
import { boardDisplayName, postingPageUrl, type JobRef, type JobSource } from "./parse.ts";
import { capText, decodeEntities, htmlToPlainText, tidyPlainText, unescapeHtml } from "./text.ts";

export type ImportedJob = {
  company: string;
  title: string;
  location: string;
  /** The text for the JD box: title and company on top, then the posting. */
  description: string;
  applyUrl: string;
  source: JobSource;
};

type Raw = Record<string, unknown>;

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const MAX_HTML = 200_000;

// Only an http(s) address is kept as the apply link.
function cleanLink(v: unknown): string {
  const s = str(v, 2048);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const oneLine = (s: string, max = 200): string => s.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The text placed in the JD box. The title and company go on top because a
 * board's description often never states them, and the pre-check reads the
 * company and role off this text. Capped at the box's own limit.
 */
export function composeJobText(job: { title: string; company: string; location: string; body: string }, max = MAX_JD_CHARS): string {
  const head = [job.title, [job.company, job.location].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  return capText([head, job.body].filter(Boolean).join("\n\n"), max);
}

function finish(ref: JobRef, parts: { title: string; company: string; location: string; body: string; applyUrl: string }): ImportedJob | null {
  const body = tidyPlainText(parts.body);
  if (body.length < 40) return null; // nothing worth tailoring against
  const title = oneLine(parts.title);
  const company = oneLine(parts.company, 120);
  const location = oneLine(parts.location, 120);
  return {
    company,
    title,
    location,
    description: composeJobText({ title, company, location, body }),
    applyUrl: parts.applyUrl || postingPageUrl(ref),
    source: ref.source,
  };
}

/** Lever: description + each list (heading and items) + the closing text. */
export function fromLever(ref: JobRef, data: unknown): ImportedJob | null {
  const job = obj(data);
  if (!job) return null;
  const sections: string[] = [];
  const intro = str(job.description, MAX_HTML);
  sections.push(intro ? htmlToPlainText(intro) : str(job.descriptionPlain, MAX_HTML));
  for (const item of Array.isArray(job.lists) ? job.lists.slice(0, 20) : []) {
    const list = obj(item);
    if (!list) continue;
    const heading = oneLine(decodeEntities(str(list.text)));
    const content = htmlToPlainText(`<ul>${str(list.content, MAX_HTML)}</ul>`);
    sections.push([heading, content].filter(Boolean).join("\n"));
  }
  const closing = str(job.additional, MAX_HTML);
  sections.push(closing ? htmlToPlainText(closing) : str(job.additionalPlain, MAX_HTML));
  const categories = obj(job.categories);
  return finish(ref, {
    title: str(job.text),
    company: boardDisplayName(ref.board),
    location: str(categories?.location),
    body: sections.filter((s) => s.trim()).join("\n\n"),
    applyUrl: cleanLink(job.hostedUrl) || cleanLink(job.applyUrl),
  });
}

/** Ashby: the board's job list, the posting found by its id. */
export function fromAshby(ref: JobRef, data: unknown): ImportedJob | null {
  const board = obj(data);
  const jobs = Array.isArray(board?.jobs) ? board.jobs : [];
  const job = jobs.map(obj).find((j) => j && str(j.id).toLowerCase() === ref.id);
  if (!job) return null;
  const html = str(job.descriptionHtml, MAX_HTML);
  return finish(ref, {
    title: str(job.title),
    company: boardDisplayName(ref.board),
    location: str(job.location),
    body: html ? htmlToPlainText(html) : str(job.descriptionPlain, MAX_HTML),
    applyUrl: cleanLink(job.jobUrl) || cleanLink(job.applyUrl),
  });
}

/** Greenhouse: `content` is entity-escaped HTML — unescaped, then stripped. */
export function fromGreenhouse(ref: JobRef, data: unknown): ImportedJob | null {
  const job = obj(data);
  if (!job) return null;
  return finish(ref, {
    title: decodeEntities(str(job.title)),
    company: decodeEntities(str(job.company_name)) || boardDisplayName(ref.board),
    location: decodeEntities(str(obj(job.location)?.name)),
    body: htmlToPlainText(unescapeHtml(str(job.content, MAX_HTML))),
    applyUrl: cleanLink(job.absolute_url),
  });
}

/**
 * The inner HTML of the first element whose class list holds `className`,
 * nested elements of the same tag balanced. "" when there is none.
 */
export function innerHtmlByClass(html: string, className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*(?<![\\w-])${escaped}(?![\\w-])[^"']*["'][^>]*>`, "i").exec(html);
  if (!open) return "";
  const tag = open[1].toLowerCase();
  const start = open.index + open[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

const textOf = (html: string): string => oneLine(htmlToPlainText(html));

/** LinkedIn's public (guest) job page fragment. */
export function fromLinkedIn(ref: JobRef, html: unknown): ImportedJob | null {
  if (typeof html !== "string" || !html) return null;
  const page = html.slice(0, 2_000_000);
  const description = innerHtmlByClass(page, "show-more-less-html__markup");
  if (!description) return null;
  return finish(ref, {
    title: textOf(innerHtmlByClass(page, "top-card-layout__title")),
    company: textOf(innerHtmlByClass(page, "topcard__org-name-link")),
    location: textOf(innerHtmlByClass(page, "topcard__flavor--bullet")),
    body: htmlToPlainText(description),
    applyUrl: postingPageUrl(ref),
  });
}

/** The extractor for a source: JSON for the three boards, HTML for LinkedIn. */
export function extractJob(ref: JobRef, body: string): ImportedJob | null {
  if (ref.source === "linkedin") return fromLinkedIn(ref, body);
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (ref.source === "lever") return fromLever(ref, data);
  if (ref.source === "ashby") return fromAshby(ref, data);
  return fromGreenhouse(ref, data);
}
