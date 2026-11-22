// CRUD for the plan's events (application_events). RLS is the real boundary; every
// write is also scoped by user id, and an event can only hang off the caller's own
// application. No model call, so no burst limiter, like /api/applications.
//
// GET answers every event, hidden ones too. The plan and the stage tabs read
// /api/plan, which holds the one rule.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody, type RouteSupabase } from "@/lib/routeAuth";
import { readEventInput, readEventSource } from "@/lib/plan";
import { snoozeUntil } from "@/lib/actionCentre";
import { ACTION_MIGRATION_HINT, isMissingPlanSchema, PLAN_MIGRATION_HINT } from "@/lib/planSchema";
import { stageAfterEvent } from "@/lib/applicationStage";
import { MAX_NOTES } from "@/lib/applicationFields";
import { stampNoteLine } from "@/lib/notesWrite";
import { apiStatus, normalizeStatus, oldStatusLabel, STATUS_LABELS, type Status } from "@/lib/tracker";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);
const needsMigration = () => NextResponse.json({ error: PLAN_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
const notFound = () => NextResponse.json({ error: "Event not found" }, { status: 404 });
const needsActionMigration = () => NextResponse.json({ error: ACTION_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
// The new kinds and sources on a database still holding the old CHECK.
const isOldEventCheck = (error: { code?: string; message?: string } | null) =>
  error?.code === "23514" && /application_events_(?:kind|source)_check/.test(error.message ?? "");
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
    let currentStatus: unknown = null;
    if (body.application_id !== undefined && body.application_id !== null && body.application_id !== "") {
      if (!isUuid(body.application_id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const { data: owned, error: ownedError } = await supabase.from("applications").select("id, status").eq("id", body.application_id).eq("user_id", userId).maybeSingle();
      if (ownedError) {
        console.error("events ownership error:", ownedError.message);
        return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
      }
      if (!owned) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      applicationId = body.application_id;
      currentStatus = owned.status;
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
      .insert({ ...read.fields, application_id: applicationId, user_id: userId, source: readEventSource(body.source) })
      .select("*")
      .single();
    if (isMissingPlanSchema(error)) return needsMigration();
    if (isOldEventCheck(error)) return needsActionMigration();
    if (error) {
      console.error("events insert error:", error.message);
      return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
    }

    // The one stage rule (lib/applicationStage stageAfterEvent): logging an interview or a
    // test moves the row forward so the tab, which reads the stored status alone, and the
    // sweep, which reads the stored column, both agree. A "Ready to submit" row never moves
    // on a test, and a finished row never moves at all. Skipped when the caller opts out
    // (the event form's untick) and best-effort: the event is already saved.
    let movedStatus: string | null = null;
    if (applicationId && body.move_stage !== false) {
      movedStatus = await moveStageForEvent(supabase, userId, applicationId, currentStatus, read.fields.kind as string);
    }
    return NextResponse.json({ event: data, movedStatus });
  } catch (err) {
    console.error("events POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that event" }, { status: 500 });
  }
}

/**
 * Move the application's stored status forward when an event of this kind was logged, or
 * leave it. Returns the new status in the API's spelling, or null when nothing moved.
 * Best-effort (the event is already saved); a failure is logged, never thrown.
 */
async function moveStageForEvent(
  supabase: RouteSupabase,
  userId: string,
  applicationId: string,
  currentStatus: unknown,
  kind: string
): Promise<string | null> {
  const next = stageAfterEvent(currentStatus, kind);
  if (!next || normalizeStatus(currentStatus) === next) return null;
  try {
    // Write the status key; a database still on the old CHECK takes the old label instead.
    let { error } = await supabase.from("applications").update({ status: next }).eq("id", applicationId).eq("user_id", userId);
    if (error?.code === "23514") {
      const old = oldStatusLabel(next as Status);
      if (old) ({ error } = await supabase.from("applications").update({ status: old }).eq("id", applicationId).eq("user_id", userId));
    }
    if (error) {
      console.error("events stage move error:", error.code ?? error.message);
      return null;
    }
    // Record why it moved. append_application_note is one UPDATE and refuses rather than
    // cut the notes; a failure (or a database without the RPC) never undoes the move.
    const line = stampNoteLine(`Moved to ${STATUS_LABELS[next]} (event: ${kind}).`, Date.now());
    await supabase.rpc("append_application_note", { p_id: applicationId, p_line: line, p_max: MAX_NOTES });
    return apiStatus(next);
  } catch (err) {
    console.error("events stage move threw:", err instanceof Error ? err.message : "unknown");
    return null;
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

    // Snoozing has its own rule (lib/actionCentre): never within 24 hours of the
    // deadline, and it never touches the date itself, so a request cannot name a time.
    if (typeof body.snooze === "boolean") {
      const { data: stored, error: readError } = await supabase.from("application_events").select("starts_at, due_at").eq("id", body.id).eq("user_id", userId).maybeSingle();
      if (isMissingPlanSchema(readError)) return needsMigration();
      if (readError) {
        console.error("events snooze read error:", readError.message);
        return NextResponse.json({ error: "Could not snooze that event" }, { status: 500 });
      }
      if (!stored) return notFound();
      const until = body.snooze ? snoozeUntil(stored, Date.now()) : null;
      if (body.snooze && until === null) return NextResponse.json({ error: "This is due within 24 hours, so it stays on your list." }, { status: 400 });
      const { data, error } = await supabase
        .from("application_events")
        .update({ snoozed_until: until === null ? null : new Date(until).toISOString(), updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("user_id", userId)
        .select("*");
      if (isMissingPlanSchema(error)) return needsActionMigration();
      if (error) {
        console.error("events snooze error:", error.message);
        return NextResponse.json({ error: "Could not snooze that event" }, { status: 500 });
      }
      return data && data.length > 0 ? NextResponse.json({ event: data[0] }) : notFound();
    }

    const read = readEventInput(body, true);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
    if (Object.keys(read.fields).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    // Undoing an automatic close takes its mark off too, so the item is simply open again.
    const reopened = body.reopen === true ? { closed_by: null, closed_at: null } : {};

    const { data, error } = await supabase
      .from("application_events")
      .update({ ...read.fields, ...reopened, updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("user_id", userId)
      .select("*");
    if (isMissingPlanSchema(error)) return needsMigration();
    if (isOldEventCheck(error)) return needsActionMigration();
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
