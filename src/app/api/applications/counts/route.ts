// GET /api/applications/counts (6 Nov 2026, Chunk 19): the tab counts and the
// follow-ups due this week, over every row of the caller's (RLS), without the
// rows. /applications reads it beside its first 50-row page, so the tabs and
// the tile are right before the full list has arrived. No model call.
//
// ?today=YYYY-MM-DD is the viewer's own date (the page's "today"); without it,
// London's. The week is Monday to Sunday (lib/trackerCounts).
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { readApplicationPages, type OrderableQuery } from "@/lib/applicationRows";
import { trackerCounts } from "@/lib/trackerCounts";
import { isMissingPlanSchema } from "@/lib/planSchema";
import { DEFAULT_TIMEZONE, dayKey } from "@/lib/planTime";
import type { PlanEvent } from "@/lib/plan";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// The viewer's date, if it is within a day of London's (anything else is not a "today").
function todayFrom(param: string | null): string {
  const london = dayKey(Date.now(), DEFAULT_TIMEZONE);
  if (!param || !DATE_RE.test(param)) return london;
  const gap = Math.abs(Date.parse(`${param}T00:00:00Z`) - Date.parse(`${london}T00:00:00Z`));
  return Number.isFinite(gap) && gap <= DAY_MS ? param : london;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase } = caller;
    const today = todayFrom(new URL(req.url).searchParams.get("today"));

    const [rowsRead, eventsRead] = await Promise.all([
      readApplicationPages<{ id: string; status: string; followup_date: string | null }>(
        () => supabase.from("applications").select("id, status, followup_date") as unknown as OrderableQuery
      ),
      supabase.from("application_events").select("application_id, status, kind, starts_at, due_at").in("status", ["scheduled", "to_book"]).limit(1000),
    ]);
    if (rowsRead.error) {
      console.error("applications counts read error:", rowsRead.error.message);
      return NextResponse.json({ error: "Could not count your applications" }, { status: 500 });
    }
    // Without the plan's tables (migration 20261103120000) every row counts at its stored status, as on the page.
    if (eventsRead.error && !isMissingPlanSchema(eventsRead.error)) {
      console.error("applications counts events read error:", eventsRead.error.message);
    }
    const events = (eventsRead.error ? [] : eventsRead.data ?? []) as Pick<PlanEvent, "application_id" | "status" | "kind" | "starts_at" | "due_at">[];
    return NextResponse.json({ today, ...trackerCounts(rowsRead.rows, events, today) });
  } catch (err) {
    console.error("applications counts error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not count your applications" }, { status: 500 });
  }
}
