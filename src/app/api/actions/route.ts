// GET /api/actions: what the Action Centre draws, over the caller's own rows (RLS).
// lib/actionCentre actionableEvents is the rule: wider than the plan, because an
// assessment on a row still marked Applied is exactly what gets missed. No model call.
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { actionableEvents } from "@/lib/actionCentre";
import { type PlanEvent } from "@/lib/plan";
import { DAY_MS } from "@/lib/planTime";
import { isMissingPlanSchema, PLAN_MIGRATION_HINT } from "@/lib/planSchema";
import { normalizeStatus } from "@/lib/tracker";
import { NextResponse } from "next/server";

const ID_BATCH = 150;
const CLOSED_SHOWN_DAYS = 7;

type ActionApplication = { id: string; company_name: string; role: string; status: string };

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase } = caller;

    const [open, windows] = await Promise.all([
      supabase.from("application_events").select("*").in("status", ["scheduled", "to_book"]).order("created_at", { ascending: true }).limit(1000),
      supabase.from("availability_windows").select("*").limit(500),
    ]);
    if (isMissingPlanSchema(open.error) || isMissingPlanSchema(windows.error)) {
      return NextResponse.json({ error: PLAN_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
    }
    if (open.error || windows.error) {
      console.error("actions read error:", (open.error ?? windows.error)?.message);
      return NextResponse.json({ error: "Could not load your actions" }, { status: 500 });
    }

    // What a confirmation in the notes closed lately, so it can be seen and undone. A
    // database without migration 20261104120000 has none.
    const since = new Date(Date.now() - CLOSED_SHOWN_DAYS * DAY_MS).toISOString();
    const closed = await supabase.from("application_events").select("*").eq("closed_by", "note").eq("status", "done").gte("closed_at", since).order("closed_at", { ascending: false }).limit(50);
    if (closed.error && !isMissingPlanSchema(closed.error)) console.error("actions closed read error:", closed.error.message);
    const closedEvents = (closed.error ? [] : closed.data ?? []) as PlanEvent[];

    const openEvents = (open.data ?? []) as PlanEvent[];
    const ids = [...new Set([...openEvents, ...closedEvents].map((e) => e.application_id).filter((id): id is string => !!id))];
    const applications: ActionApplication[] = [];
    for (let i = 0; i < ids.length; i += ID_BATCH) {
      const { data, error } = await supabase.from("applications").select("id, company_name, role, status").in("id", ids.slice(i, i + ID_BATCH));
      if (error) {
        console.error("actions applications read error:", error.message);
        return NextResponse.json({ error: "Could not load your actions" }, { status: 500 });
      }
      applications.push(...((data ?? []) as ActionApplication[]));
    }
    const rows = applications.map((a) => ({ ...a, status: normalizeStatus(a.status) ?? a.status }));

    return NextResponse.json({
      events: actionableEvents(openEvents, rows),
      closedByNote: closedEvents,
      applications: rows,
      availability: windows.data ?? [],
    });
  } catch (err) {
    console.error("actions GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your actions" }, { status: 500 });
  }
}
