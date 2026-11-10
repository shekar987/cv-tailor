// GET /api/applications/{id}/notes-history (10 Nov 2026, Chunk 21): the text a row's notes
// had before each change, newest first, written by the trigger of migration 20261110120000.
//
//   GET .../notes-history          the changes that took text away (lost_text): a wipe, an edit
//   GET .../notes-history?all=1    every change, appends too
//
// Every append is a change, so on a busy row the version from before a wipe would sink below
// a page of appends; the lossy ones are what "Restore previous notes" opens on. Restoring is
// an ordinary notes PUT (if_updated_at), which keeps the notes it replaces here in turn.
// Read-only: nothing here writes, and the table grants the user SELECT alone.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VERSIONS = 50;
const MIGRATION_HINT =
  "Notes history needs migration 20261110120000_safe_notes_cooldowns_deadlines.sql. Run it in the Supabase SQL editor; changes from then on are kept.";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const all = new URL(req.url).searchParams.get("all") === "1";

    let query = supabase.from("notes_history").select("id, old_notes, lost_text, changed_at", { count: "exact" }).eq("application_id", id).eq("user_id", userId);
    if (!all) query = query.eq("lost_text", true);
    const { data, error, count } = await query.order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(MAX_VERSIONS);
    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("notes history read error:", error.code ?? "unknown");
      return NextResponse.json({ error: "Could not load the notes history" }, { status: 500 });
    }
    // How many there are in all, so the page can offer the rest.
    const { count: total } = all ? { count } : await supabase.from("notes_history").select("id", { count: "exact", head: true }).eq("application_id", id).eq("user_id", userId);
    return NextResponse.json({ history: data ?? [], all, shown: (data ?? []).length, matching: count ?? (data ?? []).length, total: total ?? count ?? 0 });
  } catch (err) {
    console.error("notes history GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load the notes history" }, { status: 500 });
  }
}
