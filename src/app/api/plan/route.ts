// GET /api/plan: everything /app/next draws, over the caller's own rows (RLS).
// lib/plan activeEvents is the one rule: what a rejected, withdrawn, ghosted or
// won application holds never leaves the server here. No model call.
//
// ?picker=1 answers only the rows an event can be added to, for the form.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { readApplicationPages, type OrderableQuery } from "@/lib/applicationRows";
import { activeApplications, activeEvents, buildFunnel, type PlanApplication, type PlanEvent } from "@/lib/plan";
import { normalizeStatus } from "@/lib/tracker";
import { isMissingPlanSchema, PLAN_MIGRATION_HINT } from "@/lib/planSchema";

const APPLICATION_COLUMNS =
  "id, company_name, role, status, date_applied, followup_date, last_contact_from, last_contact_at, stages_reached, outcome_reason, prep_generated_at:prep_pack->>generatedAt";

const needsMigration = () => NextResponse.json({ error: PLAN_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });

export async function GET(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase } = caller;

    if (new URL(req.url).searchParams.get("picker")) {
      const read = await readApplicationPages<PlanApplication>(
        () => supabase.from("applications").select("id, company_name, role, status") as unknown as OrderableQuery
      );
      if (read.error) {
        console.error("plan picker read error:", read.error.message);
        return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
      }
      return NextResponse.json({ applications: read.rows.map((a) => ({ ...a, status: normalizeStatus(a.status) ?? a.status })) });
    }

    const [rows, eventsRead, windowsRead] = await Promise.all([
      readApplicationPages<PlanApplication>(() => supabase.from("applications").select(APPLICATION_COLUMNS) as unknown as OrderableQuery),
      supabase.from("application_events").select("*").in("status", ["scheduled", "to_book"]).limit(2000),
      supabase.from("availability_windows").select("*").limit(500),
    ]);
    if (isMissingPlanSchema(rows.error) || isMissingPlanSchema(eventsRead.error) || isMissingPlanSchema(windowsRead.error)) return needsMigration();
    const failure = rows.error ?? eventsRead.error ?? windowsRead.error;
    if (failure || !rows.rows) {
      console.error("plan read error:", failure?.message);
      return NextResponse.json({ error: "Could not load your plan" }, { status: 500 });
    }

    const applications = rows.rows.map((a) => ({ ...a, status: normalizeStatus(a.status) ?? a.status }));
    return NextResponse.json({
      applications: activeApplications(applications),
      events: activeEvents((eventsRead.data ?? []) as PlanEvent[], applications),
      availability: windowsRead.data ?? [],
      funnel: buildFunnel(applications),
    });
  } catch (err) {
    console.error("plan GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your plan" }, { status: 500 });
  }
}
