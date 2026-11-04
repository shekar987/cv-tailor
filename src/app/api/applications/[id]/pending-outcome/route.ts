// PATCH /api/applications/{id}/pending-outcome (4 Nov 2026, Chunk 15): how an automation
// records a rejection it detected, without moving the row. The status never changes here: the
// row stays Live with a banner, until the user confirms in the Move to Closed dialog.
//
//   { "outcome": "rejected", "date": "2026-11-02", "source": "gmail" }   record it
//   { "dismiss": true }                                                   "Not true": stays dismissed
//   { "clear": true }                                                     forget it
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { mergePendingOutcome, normalizePendingOutcome } from "@/lib/closing";
import { apiStatus } from "@/lib/tracker";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_HINT = "This needs migration 20261104130000_applications_closed.sql. Run it in the Supabase SQL editor, then try again.";
const isMissingColumn = (err: { code?: string } | null) => err?.code === "42703" || err?.code === "PGRST204";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const body = await readJsonBody(req);
    if (!body) return invalidBody();

    const { data: row, error: readError } = await supabase.from("applications").select("status, pending_outcome").eq("id", id).eq("user_id", userId).maybeSingle();
    if (readError) {
      if (isMissingColumn(readError)) return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("pending-outcome lookup error:", readError.code ?? "unknown");
      return NextResponse.json({ error: "Could not save that outcome" }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Application not found" }, { status: 404 });

    let next: unknown;
    let ignored = false;
    if (body.clear === true) {
      next = null;
    } else if (body.dismiss === true) {
      const stored = normalizePendingOutcome(row.pending_outcome);
      next = stored ? { ...stored, dismissed: true } : null;
    } else {
      const incoming = normalizePendingOutcome(body);
      if (!incoming) return NextResponse.json({ error: "Send an outcome (rejected, withdrawn or ghosted) and a date (YYYY-MM-DD)." }, { status: 400 });
      const merged = mergePendingOutcome(row.pending_outcome, { ...incoming, dismissed: undefined });
      next = merged.value;
      ignored = merged.ignored;
    }
    // Only this column. Nothing here can move the row.
    if (!ignored) {
      const { error: writeError } = await supabase.from("applications").update({ pending_outcome: next }).eq("id", id).eq("user_id", userId);
      if (writeError) {
        console.error("pending-outcome write error:", writeError.code ?? "unknown");
        return NextResponse.json({ error: "Could not save that outcome" }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, status: apiStatus(row.status), pending_outcome: next, ...(ignored ? { ignored: "dismissed" } : {}) });
  } catch (err) {
    console.error("pending-outcome error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that outcome" }, { status: 500 });
  }
}
