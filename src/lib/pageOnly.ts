// A request the page sent, not a script. Browsers set Sec-Fetch-Site themselves and page code
// can't change it; an API client such as a sweep sends neither header unless it means to forge
// them. So this stops an API-style automation, and is no defence against one driving the user's
// logged-in browser, or holding their session and lying on purpose. Import-free, so node:test can
// run it (tests/closing).

type Headers = { get(name: string): string | null };

export function cameFromPage(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  // An older browser: it still names the page's origin on a POST.
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
