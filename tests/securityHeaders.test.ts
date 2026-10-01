// Unit tests for the response security headers (lib/securityHeaders). node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { securityHeaders, contentSecurityPolicy, INTERVIEW_ROUTE } from "../src/lib/securityHeaders.ts";

const OPTS = { supabaseUrl: "https://abcdefgh.supabase.co", dev: false };

function headerFor(rules: ReturnType<typeof securityHeaders>, source: string, key: string): string | undefined {
  return rules.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value;
}

test("every page gets nosniff, frame denial, a referrer policy, HSTS and a report-only CSP", () => {
  const rules = securityHeaders(OPTS);
  assert.equal(headerFor(rules, "/:path*", "X-Content-Type-Options"), "nosniff");
  assert.equal(headerFor(rules, "/:path*", "X-Frame-Options"), "DENY");
  assert.equal(headerFor(rules, "/:path*", "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(headerFor(rules, "/:path*", "Strict-Transport-Security") ?? "", /max-age=\d+/);
  assert.ok(headerFor(rules, "/:path*", "Content-Security-Policy-Report-Only"), "report-only first");
  assert.equal(headerFor(rules, "/:path*", "Content-Security-Policy"), undefined, "nothing is enforced yet");
});

test("the microphone is allowed on the interview route only, and that rule comes last", () => {
  const rules = securityHeaders(OPTS);
  assert.match(headerFor(rules, "/:path*", "Permissions-Policy") ?? "", /microphone=\(\)/);
  assert.match(headerFor(rules, INTERVIEW_ROUTE, "Permissions-Policy") ?? "", /microphone=\(self\)/);
  assert.match(headerFor(rules, INTERVIEW_ROUTE, "Permissions-Policy") ?? "", /camera=\(\)/, "the camera stays off everywhere");
  assert.equal(rules[rules.length - 1].source, INTERVIEW_ROUTE, "Next keeps the last matching value for a repeated key");
});

test("the CSP names what the app actually loads: Supabase, jsDelivr, Hugging Face, wasm, workers, no frames", () => {
  const csp = contentSecurityPolicy(OPTS);
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";
  assert.match(directive("connect-src"), /https:\/\/abcdefgh\.supabase\.co/);
  assert.match(directive("connect-src"), /wss:\/\/abcdefgh\.supabase\.co/, "realtime / auth websockets");
  assert.match(directive("connect-src"), /https:\/\/huggingface\.co/);
  assert.match(directive("connect-src"), /https:\/\/\*\.hf\.co/);
  assert.match(directive("script-src"), /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(directive("script-src"), /'wasm-unsafe-eval'/);
  assert.ok(!/'unsafe-eval'/.test(directive("script-src")), "production never evals");
  assert.match(directive("worker-src"), /'self' blob:/);
  assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive("object-src"), "object-src 'none'");
  assert.ok(!/\bhttp:\/\//.test(csp), "no plain-http origin");
});

test("dev adds unsafe-eval; a missing or malformed Supabase URL adds nothing", () => {
  assert.match(contentSecurityPolicy({ ...OPTS, dev: true }), /'unsafe-eval'/);
  const none = contentSecurityPolicy({ supabaseUrl: undefined, dev: false });
  assert.ok(!/supabase/.test(none));
  assert.ok(!/undefined/.test(none));
  const bad = contentSecurityPolicy({ supabaseUrl: "not a url", dev: false });
  assert.ok(!/not a url/.test(bad));
});
