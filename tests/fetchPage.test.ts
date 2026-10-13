// lib/fetchPage: the failure classification and the certificate-chain repair,
// on three real public certificates saved in tests/fixtures (the tresvista.com
// leaf of 28 Sep 2026, Let's Encrypt's YE1 intermediate, and ISRG Root YE as
// cross-signed by ISRG Root X2). Nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import {
  errorCode,
  classifyFetchError,
  describeFetchFailure,
  parseCertificate,
  issuerUrl,
  isSelfSigned,
  isIssuedByBuiltinRoot,
  builtinRoots,
  planChainRepair,
  FetchPageError,
  AIA_MAX_HOPS,
} from "../src/lib/fetchPage.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const leaf = new X509Certificate(fixture("tresvista-leaf.der"));
const ye1 = new X509Certificate(fixture("letsencrypt-ye1.der"));
const rootYeCross = new X509Certificate(fixture("isrg-root-ye-cross.der"));
const aRoot = builtinRoots()[0];

const withCode = (code: string) => Object.assign(new Error(code), { code });
const fetchFailed = (code: string) => new TypeError("fetch failed", { cause: withCode(code) });

test("errorCode walks the cause chain and names a timed-out signal", () => {
  assert.equal(errorCode(fetchFailed("UNABLE_TO_VERIFY_LEAF_SIGNATURE")), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  assert.equal(errorCode(withCode("ENOTFOUND")), "ENOTFOUND");
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.equal(errorCode(timeout), "TIMEOUT");
  assert.equal(errorCode(new Error("plain")), "");
  assert.equal(errorCode(null), "");
});

test("classifyFetchError groups the codes the research route meets", () => {
  const cases: [string, string][] = [
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_incomplete_chain"],
    ["UNABLE_TO_GET_ISSUER_CERT", "tls_incomplete_chain"],
    ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "tls_incomplete_chain"],
    ["CERT_HAS_EXPIRED", "tls_expired"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_hostname"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "tls_untrusted"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_untrusted"],
    ["ENOTFOUND", "dns"],
    ["ECONNREFUSED", "unreachable"],
    ["ECONNRESET", "unreachable"],
    ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls_other"],
    ["EPROTO", "tls_other"],
    ["SOMETHING_ELSE", "other"],
  ];
  for (const [code, kind] of cases) assert.equal(classifyFetchError(fetchFailed(code)).kind, kind, code);
  assert.equal(classifyFetchError(new DOMException("timeout", "TimeoutError")).kind, "timeout");
  assert.equal(classifyFetchError(new FetchPageError("tls_expired", "x", "CERT_HAS_EXPIRED")).kind, "tls_expired");
});

test("describeFetchFailure names a certificate problem as the site's and never says to check the URL", () => {
  for (const code of ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN", "EPROTO"]) {
    const d = describeFetchFailure(fetchFailed(code));
    assert.match(d.message, /certificate|securely/i, code);
    assert.doesNotMatch(d.message, /check the URL/i, code);
    assert.match(d.message, /paste the job description/i, code);
  }
  assert.match(describeFetchFailure(fetchFailed("ENOTFOUND")).message, /could not be found/);
  assert.match(describeFetchFailure(new DOMException("t", "TimeoutError")).message, /10 seconds/);
  assert.match(describeFetchFailure(fetchFailed("ECONNRESET")).message, /refused or dropped/);
  assert.match(describeFetchFailure(new Error("?")).message, /Couldn't reach that site/);
});

test("parseCertificate reads DER and PEM and refuses junk", () => {
  const der = fixture("letsencrypt-ye1.der");
  assert.equal(parseCertificate(der).fingerprint256, ye1.fingerprint256);
  assert.equal(parseCertificate(Buffer.from(ye1.toString(), "utf8")).fingerprint256, ye1.fingerprint256);
  assert.throws(() => parseCertificate(Buffer.from("not a certificate")));
  assert.throws(() => parseCertificate(Buffer.from("-----BEGIN NOTHING-----")));
});

test("issuerUrl reads the CA Issuers pointer", () => {
  assert.equal(issuerUrl(leaf), "http://ye1.i.lencr.org/");
  assert.equal(issuerUrl(ye1), "http://ye.i.lencr.org/");
  assert.equal(issuerUrl(rootYeCross), "http://x2.i.lencr.org/");
});

test("self-signed and built-in-root checks", () => {
  assert.equal(isSelfSigned(aRoot), true);
  assert.equal(isSelfSigned(ye1), false);
  assert.equal(isSelfSigned(rootYeCross), false, "the cross-signed Root YE is signed by ISRG Root X2, not by itself");
  assert.equal(isIssuedByBuiltinRoot(rootYeCross), true, "ISRG Root X2 is in Node's store");
  assert.equal(isIssuedByBuiltinRoot(ye1), false);
  assert.equal(isIssuedByBuiltinRoot(leaf), false);
});

const issuers: Record<string, X509Certificate> = { "http://ye1.i.lencr.org/": ye1, "http://ye.i.lencr.org/": rootYeCross };
const fetchFromMap = (map: Record<string, X509Certificate>) => async (url: string) => {
  const c = map[url];
  if (!c) throw new Error("no such issuer " + url);
  return c;
};

test("planChainRepair walks from a bare leaf to the cross-signed root (the tresvista case)", async () => {
  const extra = await planChainRepair([leaf], fetchFromMap(issuers));
  assert.deepEqual(extra.map((c) => c.subject.replace(/\n/g, " ")), ["C=US O=Let's Encrypt CN=YE1", "C=US O=ISRG CN=Root YE"]);
});

test("planChainRepair adds only what is missing", async () => {
  const extra = await planChainRepair([leaf, ye1], fetchFromMap(issuers));
  assert.deepEqual(extra.map((c) => c.fingerprint256), [rootYeCross.fingerprint256]);
  assert.deepEqual(await planChainRepair([leaf, ye1, rootYeCross], fetchFromMap(issuers)), [], "a complete chain needs nothing");
  assert.deepEqual(await planChainRepair([], fetchFromMap(issuers)), []);
});

test("planChainRepair never adds a self-signed certificate from the network", async () => {
  // An attacker's AIA pointing at a self-signed "root": it must not enter the trust list.
  const extra = await planChainRepair([leaf], fetchFromMap({ "http://ye1.i.lencr.org/": aRoot }));
  assert.deepEqual(extra, []);
});

test("planChainRepair refuses a certificate that did not issue the one pointing to it", async () => {
  const extra = await planChainRepair([leaf], fetchFromMap({ "http://ye1.i.lencr.org/": rootYeCross }));
  assert.deepEqual(extra, []);
});

test("planChainRepair returns nothing when the walk cannot reach a built-in root", async () => {
  // Only the first link is available: the top is still not issued by a known root.
  const extra = await planChainRepair([leaf], fetchFromMap({ "http://ye1.i.lencr.org/": ye1 }));
  assert.deepEqual(extra, []);
  // A fetch that throws stops the walk the same way.
  assert.deepEqual(await planChainRepair([leaf], async () => { throw new Error("offline"); }), []);
});

test("planChainRepair is bounded by AIA_MAX_HOPS", async () => {
  let calls = 0;
  const extra = await planChainRepair([leaf], async (url) => {
    calls++;
    // ye1 points to Root YE, which points to x2 — the walk stops at Root YE because X2 is built in.
    return issuers[url] ?? ye1;
  });
  assert.ok(calls <= AIA_MAX_HOPS);
  assert.equal(extra.length, 2);
});
