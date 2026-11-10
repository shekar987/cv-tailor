// GET /api/applications/{id}/notes-history (10 Nov 2026, Chunk 21): the text a row's notes
// had before each change, newest first, written by the trigger of migration 20261110120000.
// "Restore previous notes" on /applications reads it and puts a version back with an
// ordinary notes PUT (if_updated_at), which keeps the notes it replaces here in turn.
// Read-only: nothing here writes, and the table grants the user SELECT alone.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VERSIONS = 20;
const MIGRATION_HINT =
  "Notes history needs migration 20261110120000_safe_notes_cooldowns_deadlines.sql. Run it in the Supabase SQL editor; changes from then on are kept.";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("notes_history")
      .select("id, old_notes, changed_at")
      .eq("application_id", id)
      .eq("user_id", userId)
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_VERSIONS);
    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("notes history read error:", error.code ?? "unknown");
      return NextResponse.json({ error: "Could not load the notes history" }, { status: 500 });
    }
    return NextResponse.json({ history: data ?? [] });
  } catch (err) {
    console.error("notes history GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load the notes history" }, { status: 500 });
  }
}
