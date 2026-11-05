// POST /api/applications/{id}/remove-stage (5 Nov 2026, Chunk 15, the owner's call): takes one
// stage off a row's history because the user picked it by mistake. The one exception to the
// append-only history, so it comes only from the page, only on the user's confirmation, and writes
// a dated note in the same UPDATE. Never part of the sweeps' contract: an API client is refused here.
// An automation driving the user's logged-in browser, or calling the RPC with their token, is not:
// nothing at this level can tell those apart from the user.
//
//   { "stage": "interview", "confirmed_by_user": true }
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { removableStages, removedStageNote } from "@/lib/closing";
import { MAX_NOTES_CHARS } from "@/lib/limits";
import { cameFromPage } from "@/lib/pageOnly";
import { normalizeStatus } from "@/lib/tracker";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_HINT = "This needs migration 20261105130000_remove_stage.sql. Run it in the Supabase SQL editor, then try again.";
const FAILED = "Could not remove that stage";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    if (!cameFromPage(req.headers)) return NextResponse.json({ error: "Only you can remove a stage, from the row's menu.", errorType: "page_only" }, { status: 403 });
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    if (body.confirmed_by_user !== true) return NextResponse.json({ error: "Needs the user's confirmation.", errorType: "needs_confirmation" }, { status: 409 });

    const { data: row, error: readError } = await supabase.from("applications").select("status, stages_reached, notes").eq("id", id).eq("user_id", userId).maybeSingle();
    if (readError) {
      console.error("remove-stage lookup error:", readError.code ?? "unknown");
      return NextResponse.json({ error: FAILED }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    const stage = normalizeStatus(body.stage);
    if (!stage || !removableStages(row).includes(stage)) {
      const standing = stage && normalizeStatus(row.status) === stage;
      return NextResponse.json({ error: standing ? "This row stands at that stage now. Move it first." : "That stage isn't on this row's record, or can't be removed.", errorType: "not_removable" }, { status: 409 });
    }

    // The count never moves without the note saying so, and full notes are never cut for it.
    const note = removedStageNote(stage, new Date());
    if (note.length + 1 + (row.notes?.length ?? 0) > MAX_NOTES_CHARS) return NextResponse.json({ error: "Your notes on this application are full, so the stage stays. Make room in the notes, then try again.", errorType: "notes_full" }, { status: 409 });

    const { data, error } = await supabase.rpc("remove_application_stage", { p_id: id, p_stage: stage, p_note: note, p_max: MAX_NOTES_CHARS });
    if (error) {
      if (error.code === "PGRST202") return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("remove-stage write error:", error.code ?? "unknown");
      return NextResponse.json({ error: FAILED }, { status: 500 });
    }
    // Nothing changed: the row moved between the read and the write.
    if (!data) return NextResponse.json({ error: "This application changed since this page loaded, so the stage stays. Reload and try again.", errorType: "changed" }, { status: 409 });
    const { notes, stages_reached } = data as { notes: string | null; stages_reached: string[] };
    return NextResponse.json({ ok: true, notes, stages_reached });
  } catch (err) {
    console.error("remove-stage error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: FAILED }, { status: 500 });
  }
}
