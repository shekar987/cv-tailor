// Curated tech fingerprints for the company research engine.
//
// HONESTY NOTE, load-bearing: what a company's PUBLIC WEBSITE runs on is not
// what their engineering team is hired to build with — a Golang shop's
// marketing site is often Webflow. Everything detected here is therefore
// labelled `websiteStack` and the UI presents it as "their website runs on…";
// the ENGINEERING stack comes from their live job ads (lib/jobBoards.ts),
// which is the signal that actually matters for a Fit Score.
//
// Deliberately a small curated list (high-precision patterns), not a
// vendored fingerprint database.

type Signal = {
  name: string;
  html?: RegExp;
  header?: [name: string, value: RegExp];
};

const SIGNALS: Signal[] = [
  // Frameworks / site generators
  { name: "Next.js", html: /__NEXT_DATA__|\/_next\// },
  { name: "React", html: /__NEXT_DATA__|data-reactroot|react-dom(?:\.production)?\.min\.js|__remixContext/ },
  { name: "Nuxt", html: /__NUXT__|\/_nuxt\// },
  { name: "Vue", html: /__NUXT__|data-v-[0-9a-f]{8}/ },
  { name: "Angular", html: /\bng-version=/ },
  { name: "Svelte", html: /\bsvelte-[a-z0-9]{6,}\b/ },
  { name: "Gatsby", html: /___gatsby/ },
  { name: "Remix", html: /__remixContext/ },
  { name: "Astro", html: /<astro-island|astro-static-slot/ },
  { name: "Webflow", html: /data-wf-page|website-files\.com/ },
  { name: "WordPress", html: /wp-content\/|wp-includes\// },
  { name: "Shopify", html: /cdn\.shopify\.com/ },
  { name: "Squarespace", html: /static1\.squarespace\.com|squarespace\.com\/static/ },
  { name: "Wix", html: /static\.wixstatic\.com|wix-code/ },
  { name: "Framer", html: /framerusercontent\.com/ },
  { name: "Bootstrap", html: /bootstrap(?:\.min)?\.(?:css|js)/ },
  { name: "Tailwind CSS", html: /class="[^"]*\b(?:md:|lg:|sm:|hover:)[a-z-]/ },
  { name: "jQuery", html: /jquery[.-]/i },

  // Analytics / marketing / support
  { name: "Google Tag Manager", html: /googletagmanager\.com/ },
  { name: "Google Analytics", html: /gtag\/js|google-analytics\.com\/analytics/ },
  { name: "Segment", html: /cdn\.segment\.com/ },
  { name: "Amplitude", html: /cdn\.amplitude\.com/ },
  { name: "Mixpanel", html: /cdn\.mxpnl\.com/ },
  { name: "Hotjar", html: /static\.hotjar\.com/ },
  { name: "Intercom", html: /widget\.intercom\.io/ },
  { name: "HubSpot", html: /js\.hs-scripts\.com|js\.hsforms\.net/ },
  { name: "Stripe", html: /js\.stripe\.com/ },

  // Hosting / CDN (header-based)
  { name: "Vercel", header: ["x-vercel-id", /./] },
  { name: "Netlify", header: ["x-nf-request-id", /./] },
  { name: "Cloudflare", header: ["cf-ray", /./] },
  { name: "Cloudflare", header: ["server", /cloudflare/i] },
  { name: "AWS CloudFront", header: ["x-amz-cf-id", /./] },
  { name: "AWS CloudFront", header: ["via", /cloudfront/i] },
  { name: "Fastly", header: ["x-served-by", /cache-/i] },
];

export function detectWebsiteStack(page: { body: string; headers: Record<string, string> }): string[] {
  const found: string[] = [];
  const body = page.body || "";
  const headers = page.headers || {};
  for (const s of SIGNALS) {
    if (found.includes(s.name)) continue;
    if (s.html && s.html.test(body)) {
      found.push(s.name);
      continue;
    }
    if (s.header) {
      const v = headers[s.header[0]];
      if (v && s.header[1].test(v)) found.push(s.name);
    }
  }
  return found;
}
