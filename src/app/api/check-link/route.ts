// POST /api/check-link { urls }: is each project link still there? A HEAD through the
// SSRF guard (lib/fetchPage), never a model call. Only a 404 or 410 warns: a site that
// refuses robots, or that could not be reached just now, is not a broken link.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { checkLink } from "@/lib/fetchPage";
import { cleanUrl } from "@/lib/projectLinks";

const MAX_URLS = 4;

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const burst = await checkBurstLimit(caller.userId, "check-link");
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.` },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const urls = (Array.isArray(body.urls) ? body.urls : []).map(cleanUrl).filter(Boolean).slice(0, MAX_URLS);
    const results = await Promise.all(urls.map((url) => checkLink(url)));
    return NextResponse.json({ results });
  } catch (err) {
    console.error("check-link error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Couldn't check those links." }, { status: 500 });
  }
}
