// GET  → { active: bool }   — is there a feed URL for this user?
// POST → { url: string }    — generate (or regenerate) the private feed URL.
//
// The token is a 32-byte random hex string; the database stores its SHA-256 hash
// so a database leak does not expose the URLs. Regenerating writes a new hash and
// invalidates the old URL immediately (subscriptions that cached the old URL see
// an empty 404 on the next refresh).
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { CALENDAR_FEED_MIGRATION_HINT, isMissingPlanSchema } from "@/lib/planSchema";
import { checkBurstLimit } from "@/lib/apiRateLimit";

const needsMigration = () =>
  NextResponse.json({ error: CALENDAR_FEED_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const { data, error } = await supabase
      .from("calendar_feeds")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("calendar/token GET error:", error.message);
      return NextResponse.json({ error: "Could not check feed status" }, { status: 500 });
    }
    return NextResponse.json({ active: !!data });
  } catch (err) {
    console.error("calendar/token GET threw:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not check feed status" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const limited = await checkBurstLimit(userId, "calendar-token", { limit: 10, windowSeconds: 3600 });
    if (!limited.ok) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);

    const { error } = await supabase.from("calendar_feeds").upsert(
      { user_id: userId, token_hash: tokenHash, created_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("calendar/token POST error:", error.message);
      return NextResponse.json({ error: "Could not generate feed URL" }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
    const url = `${baseUrl}/api/calendar/${token}.ics`;
    return NextResponse.json({ url });
  } catch (err) {
    console.error("calendar/token POST threw:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not generate feed URL" }, { status: 500 });
  }
}
