// GET /api/applications/insights — what actually progresses, aggregated
// over the caller's own tracker rows (RLS). Reads status/role/company for
// every row plus the stored keyword lists and eligibility read (jsonb paths
// on tailored_cv, present on rows saved since those features shipped) and
// hands lib/insights the rest. No LLM call, no burst limiter.

import { NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { computeInsights, rowFromApplication, scoreOutcome } from "@/lib/insights";

const WITH_SNAPSHOT_PATHS =
  "status, role, company_name, source, followup_date, ats:tailored_cv->ats, gates:tailored_cv->gates, pages:tailored_cv->>pages, posting_age_days:tailored_cv->>postingAgeDays";
const PLAIN = "status, role, company_name, source, followup_date";

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase } = caller;

    let rows: unknown[] | null = null;
    let readError: { code?: string; message: string } | null = null;
    const first = await supabase.from("applications").select(WITH_SNAPSHOT_PATHS).limit(2000);
    rows = first.data;
    readError = first.error;
    if (readError && readError.code === "42703") {
      // tailored_cv not migrated in — the status/role/company view still works.
      const second = await supabase.from("applications").select(PLAIN).limit(2000);
      rows = second.data;
      readError = second.error;
    }
    if (readError) {
      console.error("insights read error:", readError.message);
      return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
    }

    const insightRows = (rows ?? []).map(rowFromApplication);
    const insights = computeInsights(insightRows);
    // Honest about the denominators: which rows the bands can use, and which
    // rows are in the tracker but not in these figures at all.
    const parts: string[] = [];
    parts.push(
      insights.scored > 0
        ? `Score bands use the ${insights.scored} of ${insights.counted} applications with a stored search-visibility score; eligibility reads exist on ${insights.gated}.`
        : "No application has a stored search-visibility score yet — scores are kept from the next tailored run you save."
    );
    if (insights.counted - insights.scored > 0 && insights.scored > 0) {
      parts.push(`The other ${insights.counted - insights.scored} count in the overall rate but not in the score bands.`);
    }
    if (insights.readyToSubmit > 0) {
      parts.push(`${insights.readyToSubmit} row${insights.readyToSubmit === 1 ? " is" : "s are"} "Ready to submit" and not counted as applications.`);
    }
    const scoredNote = parts.join(" ");
    // Decided applications against their stored score — the one question
    // the score has to answer (lib/insights scoreOutcome).
    return NextResponse.json({ insights, scoredNote, scoreOutcome: scoreOutcome(insightRows) });
  } catch (err) {
    console.error("insights GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
  }
}
