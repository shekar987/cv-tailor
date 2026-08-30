// Where to send someone after sign-in, taken from a `?next=` parameter that
// anyone can put in a link. Only a same-origin path is honoured: `//evil.com`
// and `/\evil.com` both start with "/" yet resolve to another host, which is
// exactly the phishing pivot a naive startsWith("/") check allows.

const FALLBACK = "/app";

// The one auth page that IS a valid destination: the password-recovery link
// lands on /auth/callback with ?next=/auth/update-password.
const ALLOWED_AUTH_PATHS = new Set(["/auth/update-password"]);

export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return FALLBACK;
  let url: URL;
  try {
    url = new URL(next, "https://placeholder.invalid");
  } catch {
    return FALLBACK;
  }
  if (url.origin !== "https://placeholder.invalid") return FALLBACK;
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return FALLBACK;
  // Never bounce someone back into the auth flow itself.
  if (url.pathname.startsWith("/auth/") && !ALLOWED_AUTH_PATHS.has(url.pathname)) return FALLBACK;
  return url.pathname + url.search + url.hash;
}
