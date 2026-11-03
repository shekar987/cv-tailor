// CRUD for the plan's events (application_events). RLS is the real boundary; every
// write is also scoped by user id, and an event can only hang off the caller's own
// application. No model call, so no burst limiter, like /api/applications.
//
// GET answers every event, hidden ones too. The plan and the stage tabs read
// /api/plan, which holds the one rule.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { readEventInput } from "@/lib/plan";
import { isMissingPlanSchema, PLAN_MIGRATION_HINT } from "@/lib/planSchema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);
const needsMigration = () => NextResponse.json({ error: PLAN_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
const notFound = () => NextResponse.json({ error: "Event not found" }, { status: 404 });
// Open events only: finished ones never crowd the plan, and PostgREST answers at most
// 1000 rows a request, so this is also what /api/plan can read in one go.
const MAX_OPEN_EVENTS = 1000;

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { data, error } = await caller.supabase.from("application_events").select("*").order("created_at", { ascending: false }).limit(1000);
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("events read error:", error.message);
      return NextResponse.json({ error: "Could not load your events" }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    console.error("events GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your events" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    const read = readEventInput(body, false);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

    let applicationId: string | null = null;
    if (body.application_id !== undefined && body.application_id !== null && body.application_id !== "") {
      if (!isUuid(body.application_id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const { data: owned, error: ownedError } = await supabase.from("applications").select("id").eq("id", body.application_id).eq("user_id", userId).maybeSingle();
      if (ownedError) {
        console.error("events ownership error:", ownedError.message);
        return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
      }
      if (!owned) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      applicationId = body.application_id;
    } else if (read.fields.kind !== "networking") {
      return NextResponse.json({ error: "Pick the application this event belongs to." }, { status: 400 });
    }

    const { count, error: countError } = await supabase
      .from("application_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["scheduled", "to_book"]);
    if (isMissingPlanSchema(countError)) return needsMigration();
    if (countError) {
      console.error("events count error:", countError.message);
      return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_OPEN_EVENTS) {
      return NextResponse.json({ error: `You have ${MAX_OPEN_EVENTS} open events. Mark some done or cancel them to add more.` }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("application_events")
      .insert({ ...read.fields, application_id: applicationId, user_id: userId, source: "manual" })
      .select("*")
      .single();
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("events insert error:", error.message);
      return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
    }
    return NextResponse.json({ event: data });
  } catch (err) {
    console.error("events POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    if (!isUuid(body.id)) return notFound();

    const read = readEventInput(body, true);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
    if (Object.keys(read.fields).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const { data, error } = await supabase
      .from("application_events")
      .update({ ...read.fields, updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("user_id", userId)
      .select("*");
    if (isMissingPlanSchema(error)) return needsMigration();
    // application_events_time_order: an end sent alone can be before the stored start.
    if (error?.code === "23514") return NextResponse.json({ error: "The end time is before the start." }, { status: 400 });
    if (error) {
      console.error("events update error:", error.message);
      return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
    }
    if (!data || data.length === 0) return notFound();
    return NextResponse.json({ event: data[0] });
  } catch (err) {
    console.error("events PUT error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const id = new URL(req.url).searchParams.get("id");
    if (!isUuid(id)) return notFound();
    const { error } = await caller.supabase.from("application_events").delete().eq("id", id).eq("user_id", caller.userId);
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("events delete error:", error.message);
      return NextResponse.json({ error: "Could not delete that event" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("events DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete that event" }, { status: 500 });
  }
}
