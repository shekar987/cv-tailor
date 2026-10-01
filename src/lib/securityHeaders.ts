// The response headers next.config.ts sends on every page (30 Sep audit,
// Phase 5). Import-free so node:test can check them (tests/securityHeaders.test.ts).
//
// The Content-Security-Policy is REPORT-ONLY for now: the mock interview
// loads transformers.js from jsDelivr inside a worker, the Kokoro model from
// Hugging Face, runs WebAssembly (ONNX Runtime, meshopt) and an AudioWorklet,
// and Next.js itself inlines scripts — a policy that blocks any of those
// breaks a feature silently. Report-only lets the browser console show every
// violation on real devices first; the owner turns it into an enforcing
// Content-Security-Policy once a release has gone by with nothing reported.
// X-Frame-Options is enforced (no page of this app belongs in a frame), as
// are nosniff, the referrer policy and the permissions policy.
//
// The microphone is allowed on the mock-interview route only: the rest of the
// app never asks for it, so nothing else may.

export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

export type SecurityHeaderOptions = {
  /** NEXT_PUBLIC_SUPABASE_URL — the one API origin the browser talks to. */
  supabaseUrl: string | undefined;
  /** `next dev` evaluates code with eval; production never does. */
  dev: boolean;
};

// Origins the browser needs, by the feature that needs them (keep the list
// honest: every entry is something the app actually loads).
export const THIRD_PARTY = {
  // HeadTTS (public/vendor/headtts) imports @huggingface/transformers from
  // jsDelivr inside its worker; transformers.js fetches the ONNX Runtime wasm
  // from the same CDN.
  jsdelivr: "https://cdn.jsdelivr.net",
  // The Kokoro voice model: the Hub API, then the file CDN it redirects to.
  huggingface: ["https://huggingface.co", "https://*.hf.co", "https://*.huggingface.co"],
} as const;

export const INTERVIEW_ROUTE = "/applications/:id/interview";

export function contentSecurityPolicy(opts: SecurityHeaderOptions): string {
  const supabase = originOf(opts.supabaseUrl);
  const supabaseWs = supabase ? supabase.replace(/^https:/, "wss:") : "";
  const scriptSrc = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "blob:", THIRD_PARTY.jsdelivr];
  if (opts.dev) scriptSrc.push("'unsafe-eval'");
  const connectSrc = ["'self'", supabase, supabaseWs, THIRD_PARTY.jsdelivr, ...THIRD_PARTY.huggingface, "blob:", "data:"].filter(Boolean);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
    ["worker-src", ["'self'", "blob:"]],
    ["media-src", ["'self'", "blob:", "data:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// camera and geolocation are never used; microphone only on the interview.
const PERMISSIONS_BASE = "camera=(), geolocation=(), payment=(), usb=()";

export function securityHeaders(opts: SecurityHeaderOptions): HeaderRule[] {
  const common = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(opts) },
  ];
  return [
    { source: "/:path*", headers: [...common, { key: "Permissions-Policy", value: `${PERMISSIONS_BASE}, microphone=()` }] },
    // Next applies the LAST matching rule's value for a repeated key, so the
    // interview route's microphone allowance must come after the general one.
    { source: INTERVIEW_ROUTE, headers: [{ key: "Permissions-Policy", value: `${PERMISSIONS_BASE}, microphone=(self)` }] },
  ];
}
