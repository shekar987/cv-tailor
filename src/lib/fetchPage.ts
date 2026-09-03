// Server-side page fetching for the company research engine. Everything the
// engine reads from the public web comes through here.
//
// SECURITY — SSRF guard. The URL is user input and this code runs inside our
// server, so a crafted "company URL" could otherwise point the fetcher at
// localhost, the cloud metadata service (169.254.169.254), or anything on a
// private network. assertSafeUrl() therefore:
//   - allows only http/https on default ports, with no embedded credentials
//   - rejects IP-literal hosts and dotless/internal hostnames outright
//   - resolves the hostname and refuses if ANY address is loopback, private,
//     link-local, unique-local, or otherwise non-public
//   - is re-applied to every redirect hop (redirects are followed manually)
//
// Politeness: a named UA, 10s timeouts, ~1.5MB body cap, and the caller keeps
// the per-research page budget small (≤6 pages).

import { lookup } from "node:dns/promises";

export const RESEARCH_UA = "JobhuntzBot/1.0 (+https://www.jobhuntz.app)";

export class UnsafeUrlError extends Error {}

function ipIsPrivate(address: string): boolean {
  // IPv4 (including IPv4-mapped IPv6 like ::ffff:127.0.0.1)
  const v4 = address.replace(/^::ffff:/i, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  return false;
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Only http(s) URLs are supported.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not supported.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UnsafeUrlError("Non-standard ports are not supported.");
  }
  const host = url.hostname.toLowerCase();
  if (host.includes("[") || host.includes(":") || /^[\d.]+$/.test(host)) {
    throw new UnsafeUrlError("IP addresses are not supported — use the company's domain.");
  }
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    throw new UnsafeUrlError("Internal hostnames are not supported.");
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError("That domain could not be found.");
  }
  if (addrs.length === 0) throw new UnsafeUrlError("That domain could not be found.");
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) {
      throw new UnsafeUrlError("That address points somewhere private.");
    }
  }
  return url;
}

export type FetchedPage = {
  url: string; // final URL after redirects
  status: number;
  contentType: string;
  headers: Record<string, string>; // interesting subset, lowercased names
  body: string;
};

const INTERESTING_HEADERS = [
  "server", "x-powered-by", "x-vercel-id", "x-nf-request-id", "cf-ray",
  "x-amz-cf-id", "via", "x-served-by", "x-cache", "x-generator",
];

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Fetch one page with the SSRF guard applied to the URL AND to every redirect
// hop (fetch's automatic redirect following would sidestep the guard).
export async function fetchPage(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  let url = await assertSafeUrl(rawUrl);
  let res: Response | null = null;

  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": RESEARCH_UA, accept: "text/html,application/json;q=0.9,*/*;q=0.5" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      url = await assertSafeUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res) throw new Error("Fetch failed");

  const headers: Record<string, string> = {};
  for (const name of INTERESTING_HEADERS) {
    const v = res.headers.get(name);
    if (v) headers[name] = v;
  }
  return {
    url: url.toString(),
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    headers,
    body: await readCapped(res, maxBytes),
  };
}

// ── Small HTML helpers (regex-level on purpose — see anti-patterns) ─────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string, maxChars = 20_000): string {
  const noScripts = (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = noScripts
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

export function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*"([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 300) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push({ href: abs, text: htmlToText(m[2], 120) });
      }
    } catch {
      /* unparseable href — skip */
    }
  }
  return out;
}

export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  return m ? htmlToText(m[1], 200) : "";
}

export function extractMetaDescription(html: string): string {
  const m =
    /<meta\s[^>]*name\s*=\s*"description"[^>]*content\s*=\s*"([^"]*)"/i.exec(html || "") ||
    /<meta\s[^>]*content\s*=\s*"([^"]*)"[^>]*name\s*=\s*"description"/i.exec(html || "");
  return m ? decodeEntities(m[1]).trim().slice(0, 400) : "";
}
