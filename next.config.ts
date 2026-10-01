import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/securityHeaders";

// The app is reachable at several Vercel-issued hostnames (per-deployment,
// per-branch, per-project) in addition to the real domain. Users should
// never see one of those in the address bar — bookmark it, share it, or
// land on it after a stale link, and it should bounce straight to the real
// domain, path and query preserved. permanent: true (308) so browsers and
// search engines cache the redirect rather than re-checking it forever.
const nextConfig: NextConfig = {
  // src/lib/pdfText.ts reads these at runtime (fs.readFileSync) to embed a
  // Unicode font in generated PDFs. That call isn't statically traceable by
  // Next's serverless bundler (the path is built at runtime, not a literal),
  // so without this the font files build and work locally but go missing
  // from the actual Vercel deployment.
  outputFileTracingIncludes: {
    "/*": ["./src/lib/fonts/**/*"],
  },
  // Security headers on every page (lib/securityHeaders, tested): nosniff,
  // frame denial, referrer policy, HSTS, a report-only CSP, and a
  // permissions policy that allows the microphone on the interview route only.
  async headers() {
    return securityHeaders({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV !== "production" });
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "^.*\\.vercel\\.app$" }],
        destination: "https://www.jobhuntz.app/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
