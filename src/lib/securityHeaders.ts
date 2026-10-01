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
// The microphone is allowed on every route. It is used by the mock interview
// only, but a Permissions-Policy is fixed when the DOCUMENT is created and a
// Next.js <Link> navigation never creates one: with a per-route allowance the
// user arrived at the interview from the tracker carrying /applications'
// "microphone=()" and getUserMedia was refused until a hard reload (found by
// review on 1 Oct). Nothing else in the app ever calls getUserMedia.

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

// camera, geolocation and payment are never used; the microphone is (the
// interview — see above for why it cannot be scoped to that route).
const PERMISSIONS_POLICY = "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)";

export function securityHeaders(opts: SecurityHeaderOptions): HeaderRule[] {
  const common = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(opts) },
  ];
  return [{ source: "/:path*", headers: [...common, { key: "Permissions-Policy", value: PERMISSIONS_POLICY }] }];
}
