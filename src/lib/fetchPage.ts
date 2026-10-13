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
//     and to every certificate download the chain repair makes
//
// TLS — certificate chain repair (13 Oct 2026). A company's web server
// sometimes sends only its own certificate and not the intermediates behind
// it (tresvista.com did, on Let's Encrypt's new "Generation Y" hierarchy whose
// root is cross-signed by ISRG Root X2). Browsers and Windows quietly fetch
// the missing links through the certificate's "CA Issuers" pointer (AIA), so
// the site opens for the user; Node's OpenSSL does not, so fetch() failed with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE and the route blamed the URL. fetchOnce()
// now does what the browser does, with these rules, each tested:
//   - only on a chain-incomplete error (UNABLE_TO_VERIFY_LEAF_SIGNATURE /
//     UNABLE_TO_GET_ISSUER_CERT*), never for an expired, mismatched or
//     self-signed certificate — those are reported as what they are
//   - the server's certificates are read from a handshake that sends no
//     request; the issuer certificates are downloaded through assertSafeUrl,
//     capped at AIA_MAX_BYTES, at most AIA_MAX_HOPS of them
//   - a downloaded certificate is used only if it is a CA certificate that
//     actually issued the one pointing to it, and NEVER if it is self-signed —
//     a self-signed certificate in the trust list would become a trust anchor,
//     which is how an attacker's chain could verify. The repaired chain must
//     still end at one of Node's built-in roots (tls.rootCertificates)
//   - the retry goes through node:https with the built-in roots plus the
//     fetched intermediates, hostname verification intact
// The route turns a FetchPageError into a message that says what happened
// (describeFetchFailure) instead of "check the URL".
//
// Politeness: a named UA, 10s timeouts, ~1.5MB body cap, and the caller keeps
// the per-research page budget small (≤6 pages).

import { lookup } from "node:dns/promises";
import tls from "node:tls";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import { Readable } from "node:stream";

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

// ── Failures, named ─────────────────────────────────────────────────────────

export type FetchFailureKind =
  | "dns"
  | "unreachable"
  | "timeout"
  | "tls_incomplete_chain"
  | "tls_untrusted"
  | "tls_expired"
  | "tls_hostname"
  | "tls_other"
  | "other";

// What fetchPage throws for anything that is not an UnsafeUrlError: the kind
// of failure, the underlying code (for the log) and a sentence for the user.
export class FetchPageError extends Error {
  kind: FetchFailureKind;
  code: string;
  constructor(kind: FetchFailureKind, message: string, code = "") {
    super(message);
    this.name = "FetchPageError";
    this.kind = kind;
    this.code = code;
  }
}

// The first error code in a chain of causes. fetch() throws
// "TypeError: fetch failed" with the real error as its cause; a timed-out
// AbortSignal rejects with a DOMException named TimeoutError and no code.
export function errorCode(e: unknown): string {
  let cur: unknown = e;
  for (let depth = 0; cur && typeof cur === "object" && depth < 6; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const name = (cur as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") return "TIMEOUT";
    cur = (cur as { cause?: unknown }).cause;
  }
  return "";
}

// A chain the server left incomplete: repairable by fetching the issuers.
const INCOMPLETE_CHAIN_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);

export function classifyFetchError(e: unknown): { kind: FetchFailureKind; code: string } {
  if (e instanceof FetchPageError) return { kind: e.kind, code: e.code };
  const code = errorCode(e);
  if (INCOMPLETE_CHAIN_CODES.has(code)) return { kind: "tls_incomplete_chain", code };
  if (code === "CERT_HAS_EXPIRED" || code === "CERT_NOT_YET_VALID") return { kind: "tls_expired", code };
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return { kind: "tls_hostname", code };
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "CERT_UNTRUSTED" || code === "CERT_REJECTED" || code === "CERT_SIGNATURE_FAILURE") {
    return { kind: "tls_untrusted", code };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NODATA" || code === "EAI_NONAME") return { kind: "dns", code };
  if (code === "TIMEOUT" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return { kind: "timeout", code };
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EPIPE" || code === "UND_ERR_SOCKET") {
    return { kind: "unreachable", code };
  }
  if (/^ERR_(TLS|SSL|OSSL)_|^EPROTO$|_SSL_/.test(code)) return { kind: "tls_other", code };
  return { kind: "other", code };
}

// One sentence for the user. A certificate problem is the site's, so it is
// named as such and never sent back to "check the URL".
export function describeFetchFailure(e: unknown): { kind: FetchFailureKind; code: string; message: string } {
  const { kind, code } = classifyFetchError(e);
  const paste = "Paste the job description instead.";
  const message =
    kind === "dns"
      ? "That domain could not be found. Check the spelling of the address."
      : kind === "timeout"
        ? `That site took more than 10 seconds to answer. Try again in a minute, or paste the job description instead.`
        : kind === "unreachable"
          ? `That site refused or dropped the connection. It may be down or blocking automated visits — try again in a minute, or paste the job description instead.`
          : kind === "tls_incomplete_chain"
            ? `That site's security certificate chain is incomplete on their server, and the missing links could not be fetched, so it could not be verified from ours. Browsers hide this. ${paste}`
            : kind === "tls_expired"
              ? `That site's security certificate has expired or is not yet valid, so it could not be read safely. ${paste}`
              : kind === "tls_hostname"
                ? `That site's security certificate is for a different domain name, so it could not be read safely. Try the address with or without "www", or paste the job description instead.`
                : kind === "tls_untrusted"
                  ? `That site's security certificate is not from a trusted issuer, so it could not be read safely. ${paste}`
                  : kind === "tls_other"
                    ? `Couldn't read that site securely${code ? ` (${code})` : ""}. ${paste}`
                    : "Couldn't reach that site. Try again in a minute, or paste the job description instead.";
  return { kind, code, message };
}

// ── Certificates ────────────────────────────────────────────────────────────

export const AIA_MAX_HOPS = 3;
const AIA_MAX_BYTES = 64_000;
const AIA_TIMEOUT_MS = 5_000;
const REPAIR_TTL_MS = 60 * 60 * 1000;
const REPAIR_CACHE_MAX = 200;

// DER (application/pkix-cert) or PEM, as CAs serve them.
export function parseCertificate(bytes: Uint8Array): X509Certificate {
  const head = Buffer.from(bytes.subarray(0, 64)).toString("latin1");
  if (head.includes("-----BEGIN")) {
    const m = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(Buffer.from(bytes).toString("utf8"));
    if (!m) throw new Error("No certificate in the PEM text");
    return new X509Certificate(m[0]);
  }
  return new X509Certificate(Buffer.from(bytes));
}

// The certificate's "CA Issuers" pointer (Authority Information Access).
export function issuerUrl(cert: X509Certificate): string | null {
  const m = /CA Issuers - URI:(https?:\/\/[^\s,]+)/.exec(cert.infoAccess ?? "");
  return m ? m[1] : null;
}

export function isSelfSigned(cert: X509Certificate): boolean {
  return cert.checkIssued(cert) && cert.verify(cert.publicKey);
}

let roots: X509Certificate[] | null = null;
export function builtinRoots(): X509Certificate[] {
  if (!roots) {
    roots = tls.rootCertificates.flatMap((pem) => {
      try {
        return [new X509Certificate(pem)];
      } catch {
        return [];
      }
    });
  }
  return roots;
}

export function isIssuedByBuiltinRoot(cert: X509Certificate): boolean {
  return builtinRoots().some((root) => cert.checkIssued(root) && cert.verify(root.publicKey));
}

// Which certificates to add so that the chain the server sent reaches one of
// Node's built-in roots — the browser's walk, with the trust rules above.
// Returns [] when nothing can (or need) be done. Pure apart from fetchIssuer.
export async function planChainRepair(
  served: X509Certificate[],
  fetchIssuer: (url: string) => Promise<X509Certificate>
): Promise<X509Certificate[]> {
  const extra: X509Certificate[] = [];
  let top = served[served.length - 1];
  if (!top) return extra;
  for (let hop = 0; hop < AIA_MAX_HOPS; hop++) {
    if (isSelfSigned(top) || isIssuedByBuiltinRoot(top)) break;
    const url = issuerUrl(top);
    if (!url) break;
    let issuer: X509Certificate;
    try {
      issuer = await fetchIssuer(url);
    } catch {
      break;
    }
    // Never a root from the network (it would become a trust anchor), only a
    // CA certificate that really issued the one pointing to it.
    if (isSelfSigned(issuer) || !issuer.ca) break;
    if (!top.checkIssued(issuer) || !top.verify(issuer.publicKey)) break;
    extra.push(issuer);
    top = issuer;
  }
  return isIssuedByBuiltinRoot(top) ? extra : [];
}

// The certificates the server presents, read from a handshake that sends no
// request. rejectUnauthorized is off here ONLY to read them; nothing from
// this connection is trusted or used beyond the certificate bytes.
function servedChain(host: string, timeoutMs: number): Promise<X509Certificate[]> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    socket.once("secureConnect", () => {
      const out: X509Certificate[] = [];
      const seen = new Set<string>();
      let cur: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate(true);
      while (cur && cur.raw && out.length < 8) {
        const fp = cur.fingerprint256 || String(out.length);
        if (seen.has(fp)) break;
        seen.add(fp);
        try {
          out.push(new X509Certificate(cur.raw));
        } catch {
          break;
        }
        if (!cur.issuerCertificate || cur.issuerCertificate === cur) break;
        cur = cur.issuerCertificate;
      }
      finish(() => resolve(out));
    });
    socket.once("timeout", () => finish(() => reject(new Error("TLS probe timed out"))));
    socket.once("error", (e) => finish(() => reject(e)));
  });
}

async function fetchIssuerCertificate(aiaUrl: string): Promise<X509Certificate> {
  const url = await assertSafeUrl(aiaUrl);
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(AIA_TIMEOUT_MS),
    headers: { "user-agent": RESEARCH_UA, accept: "application/pkix-cert, application/x-x509-ca-cert, application/pem-certificate-chain;q=0.9, */*;q=0.5" },
  });
  if (res.status !== 200) throw new Error(`Issuer certificate: HTTP ${res.status}`);
  return parseCertificate(await readCappedBytes(res, AIA_MAX_BYTES));
}

// Per host, the intermediates that made its chain verify (or [] when the
// repair failed), for an hour — one probe per host, not one per page.
const repairs = new Map<string, { pems: string[]; at: number }>();

function cachedRepair(host: string): string[] | null {
  const hit = repairs.get(host);
  if (!hit) return null;
  if (Date.now() - hit.at > REPAIR_TTL_MS) {
    repairs.delete(host);
    return null;
  }
  return hit.pems;
}

async function repairChain(host: string, timeoutMs: number): Promise<string[]> {
  const cached = cachedRepair(host);
  if (cached) return cached;
  let pems: string[] = [];
  try {
    const served = await servedChain(host, Math.min(timeoutMs, AIA_TIMEOUT_MS));
    const extra = await planChainRepair(served, fetchIssuerCertificate);
    pems = extra.map((c) => c.toString());
    if (pems.length > 0) console.warn(`[fetchPage] certificate chain repaired for ${host}: ${pems.length} issuer certificate(s) fetched via AIA`);
    else console.warn(`[fetchPage] certificate chain could not be repaired for ${host} (${served.length} certificate(s) served)`);
  } catch (e) {
    console.warn(`[fetchPage] chain repair failed for ${host}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (repairs.size >= REPAIR_CACHE_MAX) repairs.delete(repairs.keys().next().value as string);
  repairs.set(host, { pems, at: Date.now() });
  return pems;
}

// The same request through node:https, so the built-in roots plus the fetched
// intermediates can be given as the trust list (fetch() has no such option).
// Hostname verification and expiry checks are OpenSSL's as usual.
function requestWithTrust(url: URL, headers: Record<string, string>, extraPems: string[], timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers,
        servername: url.hostname,
        ca: [...tls.rootCertificates, ...extraPems],
        rejectUnauthorized: true,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const h = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          try {
            h.set(name, Array.isArray(value) ? value.join(", ") : value);
          } catch {
            /* a header name Headers refuses — not one we read */
          }
        }
        const status = res.statusCode ?? 0;
        if (status === 204 || status === 205 || status === 304) {
          res.resume();
          resolve(new Response(null, { status, headers: h }));
          return;
        }
        resolve(new Response(Readable.toWeb(res) as unknown as BodyInit, { status, headers: h }));
      }
    );
    req.once("error", reject);
    req.end();
  });
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

async function readCappedBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
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
  return Buffer.concat(chunks);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  return Buffer.from(await readCappedBytes(res, maxBytes)).toString("utf8");
}

// One request. On a chain-incomplete TLS error the host's chain is repaired
// once (see the header) and the request retried with the fetched
// intermediates; any other failure, and the retry's own failure, is the truth.
async function fetchOnce(url: URL, timeoutMs: number, trust: string[], repaired: Set<string>): Promise<Response> {
  const headers = { "user-agent": RESEARCH_UA, accept: "text/html,application/json;q=0.9,*/*;q=0.5" };
  const host = url.hostname.toLowerCase();
  const secure = url.protocol === "https:";
  if (secure && trust.length === 0) {
    const cached = cachedRepair(host);
    if (cached && cached.length > 0) trust.push(...cached);
  }
  const attempt = () =>
    secure && trust.length > 0
      ? requestWithTrust(url, headers, trust, timeoutMs)
      : fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers });
  try {
    return await attempt();
  } catch (e) {
    if (!secure || repaired.has(host) || classifyFetchError(e).kind !== "tls_incomplete_chain") throw e;
    repaired.add(host);
    const pems = await repairChain(host, timeoutMs);
    if (pems.length === 0) throw e;
    trust.push(...pems);
    return await attempt();
  }
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
  // Intermediates fetched for this call's hosts (a redirect may change host).
  const trust: string[] = [];
  const repaired = new Set<string>();

  try {
    for (let hop = 0; hop < 4; hop++) {
      res = await fetchOnce(url, timeoutMs, trust, repaired);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        await res.body?.cancel().catch(() => {});
        url = await assertSafeUrl(new URL(loc, url).toString());
        continue;
      }
      break;
    }
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof FetchPageError) throw e;
    const d = describeFetchFailure(e);
    throw new FetchPageError(d.kind, d.message, d.code);
  }
  if (!res) throw new FetchPageError("other", describeFetchFailure(null).message);

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
