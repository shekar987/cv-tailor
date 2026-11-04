// The user's free and busy time (availability_windows), for the clash check and the
// booking helper. RLS is the boundary; every write is also scoped by user id.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { readWindowInput } from "@/lib/plan";
import { isMissingPlanSchema, PLAN_MIGRATION_HINT } from "@/lib/planSchema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WINDOWS = 500;
const needsMigration = () => NextResponse.json({ error: PLAN_MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { data, error } = await caller.supabase.from("availability_windows").select("*").limit(MAX_WINDOWS);
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("availability read error:", error.message);
      return NextResponse.json({ error: "Could not load your availability" }, { status: 500 });
    }
    return NextResponse.json({ windows: data ?? [] });
  } catch (err) {
    console.error("availability GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your availability" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const read = readWindowInput(body);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

    const { count, error: countError } = await supabase.from("availability_windows").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (isMissingPlanSchema(countError)) return needsMigration();
    if (countError) {
      console.error("availability count error:", countError.message);
      return NextResponse.json({ error: "Could not save that time" }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_WINDOWS) return NextResponse.json({ error: `You can keep up to ${MAX_WINDOWS} free or busy times. Delete some to add more.` }, { status: 400 });

    const { data, error } = await supabase.from("availability_windows").insert({ ...read.fields, user_id: userId }).select("*").single();
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("availability insert error:", error.message);
      return NextResponse.json({ error: "Could not save that time" }, { status: 500 });
    }
    return NextResponse.json({ window: data });
  } catch (err) {
    console.error("availability POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that time" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { error } = await caller.supabase.from("availability_windows").delete().eq("id", id).eq("user_id", caller.userId);
    if (isMissingPlanSchema(error)) return needsMigration();
    if (error) {
      console.error("availability delete error:", error.message);
      return NextResponse.json({ error: "Could not delete that time" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("availability DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete that time" }, { status: 500 });
  }
}
