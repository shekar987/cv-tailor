import type { NextConfig } from "next";

// The app is reachable at several Vercel-issued hostnames (per-deployment,
// per-branch, per-project) in addition to the real domain. Users should
// never see one of those in the address bar — bookmark it, share it, or
// land on it after a stale link, and it should bounce straight to the real
// domain, path and query preserved. permanent: true (308) so browsers and
// search engines cache the redirect rather than re-checking it forever.
const nextConfig: NextConfig = {
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
