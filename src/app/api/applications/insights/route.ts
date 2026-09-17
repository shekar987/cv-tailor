// GET /api/applications/insights — what actually progresses, aggregated
// over the caller's own tracker rows (RLS). Reads status/role/company for
// every row plus the stored keyword lists and eligibility read (jsonb paths
// on tailored_cv, present on rows saved since those features shipped) and
// hands lib/insights the rest. No LLM call, no burst limiter.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeInsights, rowFromApplication } from "@/lib/insights";

const WITH_SNAPSHOT_PATHS = "status, role, company_name, ats:tailored_cv->ats, gates:tailored_cv->gates";
const PLAIN = "status, role, company_name";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const insights = computeInsights((rows ?? []).map(rowFromApplication));
    const scoredNote =
      insights.scored > 0
        ? `Score bands use the ${insights.scored} of ${insights.counted} applications with a stored search-visibility score; eligibility reads exist on ${insights.gated}.`
        : "No application has a stored search-visibility score yet — scores are kept from the next tailored run you save.";
    return NextResponse.json({ insights, scoredNote });
  } catch (err) {
    console.error("insights GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
  }
}
