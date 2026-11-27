// Private ICS calendar feed — no session required; authenticated by the token in the URL.
//
// URL shape: /api/calendar/<64-hex-chars>.ics
//
// JH-2C: Replaced the direct table queries with a SECURITY DEFINER RPC
// (calendar_feed_events). The anon role is REVOKED from calendar_feeds and
// application_events (JH-2B migration), so a publishable-key client with no
// session always returned 404 before. The RPC runs with function-owner
// privileges and enforces data isolation through its JOIN condition
// (ae.user_id = cf.user_id), so a token hash can only yield the token
// owner's own events.
//
// LEFT JOIN semantics from the RPC:
//   0 rows returned     → token not found  → 404
//   1 row, id IS NULL   → valid token, no upcoming events → 200 empty ICS
//   N rows, id NOT NULL → events to serve
//
// Rate-limited by token (10 requests per hour).
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { isMissingPlanSchema } from "@/lib/planSchema";
import { EVENT_KIND_LABELS, type EventKind } from "@/lib/plan";

export const TOKEN_RE = /^[0-9a-f]{64}$/i;
const UID_HOST = "jobhuntz.app";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type EventRow = {
  id: string | null;
  kind: string | null;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  due_at: string | null;
  date_only: boolean | null;
  prep_notes: string | null;
  location_or_link: string | null;
  timezone: string | null;
  status: string | null;
};

export function eventRowToIcs(ev: EventRow, baseUrl: string): IcsEvent {
  const id = ev.id ?? "";
  const kind = ev.kind ?? "";
  const kindLabel = kind in EVENT_KIND_LABELS ? EVENT_KIND_LABELS[kind as EventKind] : kind;
  const title = ev.title || kindLabel || "Event";
  const description = ev.prep_notes ?? undefined;
  const location = ev.location_or_link ?? undefined;
  const url = id ? `${baseUrl}/app/next` : undefined;

  if (ev.date_only && ev.due_at) {
    const day = ev.due_at.slice(0, 10);
    return { uid: `${id}@${UID_HOST}`, title, start: day, dateOnly: true, description, location, url };
  }
  if (ev.starts_at) {
    return {
      uid: `${id}@${UID_HOST}`,
      title,
      start: ev.starts_at,
      end: ev.ends_at ?? undefined,
      durationMinutes: 60,
      description,
      location,
      url,
    };
  }
  if (ev.due_at) {
    return { uid: `${id}@${UID_HOST}`, title, start: ev.due_at, durationMinutes: 60, description, location, url };
  }
  const today = new Date().toISOString().slice(0, 10);
  return { uid: `${id}@${UID_HOST}`, title, start: today, dateOnly: true, description, location, url };
}

export function buildFeedIcs(rows: EventRow[], baseUrl: string): { found: boolean; icsContent: string } {
  if (rows.length === 0) {
    return { found: false, icsContent: "" };
  }
  // 1 row with null id = valid token but no events
  const events = rows.filter((r) => r.id !== null);
  const icsEvents = events.map((ev) => eventRowToIcs(ev, baseUrl));
  return { found: true, icsContent: buildIcs(icsEvents) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params;
    const token = rawToken.replace(/\.ics$/i, "");

    if (!TOKEN_RE.test(token)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const limited = await checkBurstLimit(`cal:${token.slice(0, 16)}`, "calendar-feed", {
      limit: 10,
      windowSeconds: 3600,
    });
    if (!limited.ok) return new NextResponse("Too many requests", { status: 429 });

    const tokenHash = hashToken(token);
    const supabase = await createClient();

    const { data: rows, error } = await supabase.rpc("calendar_feed_events", {
      p_token_hash: tokenHash,
    });

    if (isMissingPlanSchema(error)) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (error) {
      console.error("calendar feed RPC error:", error.message);
      return new NextResponse("Not found", { status: 404 });
    }

    const baseUrl = new URL(req.url).origin;
    const { found, icsContent } = buildFeedIcs((rows ?? []) as EventRow[], baseUrl);

    if (!found) {
      return new NextResponse("Not found", { status: 404 });
    }

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
