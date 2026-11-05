// PATCH /api/applications/{id}/pending-outcome (4 Nov 2026, Chunk 15): how an automation
// records a rejection it detected, without moving the row. The status never changes here: the
// row stays Live with a banner, until the user confirms in the Move to Closed dialog.
//
//   { "outcome": "rejected", "date": "2026-11-02", "source": "gmail" }   record it on a live row
//   { "outcome": "reopen", "date": "2026-11-05", "source": "gmail", "status": "interview", "note": "Invite for 12 Nov" }
//                                                                         ask on a closed row
//   { "outcome": "move_back", "date": "2026-11-05", "source": "gmail", "status": "screening", "note": "Recruiter call" }
//                                                                         ask on a live row
//   { "dismiss": true }                                                   "Not true": stays dismissed
//   { "clear": true }                                                     forget it
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { dismissPending, dismissalMatches, isEnding, isQuestion, isStepBack, mergePendingOutcome, normalizePendingOutcome } from "@/lib/closing";
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
    let closedNote = false;
    if (body.clear === true) {
      next = null;
    } else if (body.dismiss === true) {
      const stored = normalizePendingOutcome(row.pending_outcome);
      // What the page was answering has been replaced: it shows the new one, and nothing is dismissed.
      if (stored && !dismissalMatches(stored, body)) return NextResponse.json({ ok: true, status: apiStatus(row.status), pending_outcome: stored, ignored: "changed" });
      next = stored ? dismissPending(stored, new Date().toISOString().slice(0, 10)) : null;
    } else {
      const incoming = normalizePendingOutcome(body);
      if (!incoming) return NextResponse.json({ error: "Send an outcome (rejected, withdrawn, ghosted, reopen, or move_back with a status) and a date (YYYY-MM-DD)." }, { status: 400 });
      if (isQuestion(incoming)) {
        // A reopen only means something on a closed row; a move back only as a real step back on a live one.
        const reopen = incoming.outcome === "reopen";
        if (reopen ? !isEnding(row.status) : isEnding(row.status) || !isStepBack(row, incoming.status)) return NextResponse.json({ ok: true, status: apiStatus(row.status), pending_outcome: normalizePendingOutcome(row.pending_outcome), ignored: reopen ? "live" : "not_a_step_back" });
        // A report says what happened. What is dismissed and what is remembered are not its to say.
        const merged = mergePendingOutcome(row.pending_outcome, { ...incoming, dismissed: undefined, earlier: undefined });
        next = merged.value;
        ignored = merged.ignored;
      } else if (isEnding(row.status)) {
        // A row that already ended has nothing left to confirm: the sweep's next report is old
        // news. Remembered as answered, so the same report after a Reopen raises no banner.
        const stored = normalizePendingOutcome(row.pending_outcome);
        const answered = { ...incoming, dismissed: true };
        // A question stands in the way of remembering it, so it is kept behind the question.
        next = !stored ? answered : isQuestion(stored) && !stored.earlier ? { ...stored, earlier: answered } : stored;
        ignored = next === stored;
        closedNote = true;
      } else {
        const merged = mergePendingOutcome(row.pending_outcome, { ...incoming, dismissed: undefined });
        next = merged.value;
        ignored = merged.ignored;
      }
    }
    // Only this column. Nothing here can move the row.
    if (!ignored) {
      const { error: writeError } = await supabase.from("applications").update({ pending_outcome: next }).eq("id", id).eq("user_id", userId);
      if (writeError) {
        console.error("pending-outcome write error:", writeError.code ?? "unknown");
        return NextResponse.json({ error: "Could not save that outcome" }, { status: 500 });
      }
    }
    const held = ignored && !closedNote && !(next as { dismissed?: boolean } | null)?.dismissed && !normalizePendingOutcome(next)?.earlier;
    return NextResponse.json({ ok: true, status: apiStatus(row.status), pending_outcome: next, ...(closedNote ? { ignored: "closed" } : held ? { ignored: "pending" } : ignored ? { ignored: "dismissed" } : {}) });
  } catch (err) {
    console.error("pending-outcome error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that outcome" }, { status: 500 });
  }
}
