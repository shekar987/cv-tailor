import type { MetadataRoute } from "next";

// Only the public pages are for crawlers. Everything behind sign-in (and the
// API) is disallowed — it renders a login redirect anyway, and the tool pages
// hold a user's own data.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/auth/login"],
      disallow: ["/app", "/applications", "/customize", "/settings", "/api/", "/auth/callback", "/auth/update-password", "/auth/error"],
    },
    sitemap: "https://www.jobhuntz.app/sitemap.xml",
  };
}
