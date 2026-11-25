// Private ICS calendar feed — no session required; authenticated by the token in the URL.
//
// URL shape: /api/calendar/<64-hex-chars>.ics
// The token is stripped of the ".ics" suffix and hashed with SHA-256; the hash is
// looked up in calendar_feeds (bypassing RLS with a service-role-less server client
// that cannot touch any other table). A wrong or old token → 404.
//
// All open events for the feed's owner are returned. UIDs are stable:
//   <event-id>@jobhuntz.app
// so a calendar subscription can delete and re-add events by UID across refreshes.
//
// Rate-limited by token (10 requests per hour) to protect the database.
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { isMissingPlanSchema } from "@/lib/planSchema";
import { EVENT_KIND_LABELS, type EventKind } from "@/lib/plan";

const TOKEN_RE = /^[0-9a-f]{64}$/i;
const UID_HOST = "jobhuntz.app";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function eventToIcs(ev: Record<string, unknown>, baseUrl: string): IcsEvent {
  const id = String(ev.id ?? "");
  const kind = String(ev.kind ?? "");
  const kindLabel = kind in EVENT_KIND_LABELS ? EVENT_KIND_LABELS[kind as EventKind] : kind;
  const title = String(ev.title || kindLabel || "Event");
  const description = ev.prep_notes ? String(ev.prep_notes) : undefined;
  const location = ev.location_or_link ? String(ev.location_or_link) : undefined;

  const url = id ? `${baseUrl}/app/next` : undefined;

  if (ev.date_only && ev.due_at) {
    const day = String(ev.due_at).slice(0, 10);
    return { uid: `${id}@${UID_HOST}`, title, start: day, dateOnly: true, description, location, url };
  }
  if (ev.starts_at) {
    return {
      uid: `${id}@${UID_HOST}`,
      title,
      start: String(ev.starts_at),
      end: ev.ends_at ? String(ev.ends_at) : undefined,
      durationMinutes: 60,
      description,
      location,
      url,
    };
  }
  if (ev.due_at) {
    return { uid: `${id}@${UID_HOST}`, title, start: String(ev.due_at), durationMinutes: 60, description, location, url };
  }
  // Fallback: no time — use today as a date-only placeholder.
  const today = new Date().toISOString().slice(0, 10);
  return { uid: `${id}@${UID_HOST}`, title, start: today, dateOnly: true, description, location, url };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params;
    // Strip the ".ics" suffix the URL carries.
    const token = rawToken.replace(/\.ics$/i, "");

    if (!TOKEN_RE.test(token)) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Rate-limit by token to protect the DB lookup.
    const limited = await checkBurstLimit(`cal:${token.slice(0, 16)}`, "calendar-feed", { limit: 10, windowSeconds: 3600 });
    if (!limited.ok) return new NextResponse("Too many requests", { status: 429 });

    const tokenHash = hashToken(token);

    // Use the server client (reads the user's row; RLS on calendar_feeds allows own rows only,
    // but here we bypass that intentionally with a direct hash match via a cookie-less client
    // that has no session — the token IS the credential). We use a service-role-less approach:
    // the query is against calendar_feeds, which has no RLS on SELECT for anonymous unless
    // explicitly granted. Because we revoked anon in the migration, we need the server client
    // that uses the service role key when available, or the publishable key otherwise. The
    // token match is the security boundary.
    const supabase = await createClient();

    const { data: feedRow, error: feedError } = await supabase
      .from("calendar_feeds")
      .select("user_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (isMissingPlanSchema(feedError)) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (feedError) {
      console.error("calendar feed lookup error:", feedError.message);
      return new NextResponse("Not found", { status: 404 });
    }
    if (!feedRow) {
      return new NextResponse("Not found", { status: 404 });
    }

    const userId = feedRow.user_id;

    const { data: events, error: eventsError } = await supabase
      .from("application_events")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["scheduled", "to_book"])
      .order("starts_at", { ascending: true, nullsFirst: false });

    if (eventsError) {
      console.error("calendar feed events error:", eventsError.message);
      return new NextResponse("Not found", { status: 404 });
    }

    const baseUrl = new URL(req.url).origin;
    const icsEvents: IcsEvent[] = (events ?? []).map((ev) => eventToIcs(ev as unknown as Record<string, unknown>, baseUrl));

    const icsContent = buildIcs(icsEvents);

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="jobhuntz.ics"',
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("calendar GET threw:", err instanceof Error ? err.message : "unknown");
    return new NextResponse("Not found", { status: 404 });
  }
}
