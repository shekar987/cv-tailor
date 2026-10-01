import type { MetadataRoute } from "next";

const BASE = "https://www.jobhuntz.app";

// The four pages a search engine may index. The tool pages are behind
// sign-in and are not listed (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/auth/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
