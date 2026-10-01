import { NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { normalizeSentCv, publicSentCv } from "@/lib/sentCv";

// GET /api/account/export — everything the signed-in user's account holds, as
// one JSON file (portability). Read as the user, so RLS scopes every table.
// Secrets never leave: the encrypted provider keys are listed by provider and
// hint only, and an uploaded CV's storage path is dropped (the file itself is
// downloadable from the tracker). A table that is not migrated in yet is
// reported as null with the reason instead of failing the whole export.

type Section = { rows: unknown[] | null; note?: string };

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId, email } = caller;

    async function read(table: string, columns: string, order?: string): Promise<Section> {
      let q = supabase.from(table).select(columns).eq(table === "profiles" ? "id" : "user_id", userId);
      if (order) q = q.order(order, { ascending: true });
      const { data, error } = await q.limit(5000);
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return { rows: null, note: "table not present on this database" };
        if (error.code === "42703") return { rows: null, note: `a column is missing: ${error.message}` };
        console.error(`account export ${table}:`, error.message);
        return { rows: null, note: "could not be read" };
      }
      return { rows: (data ?? []) as unknown[] };
    }

    const [profile, masterCv, cvProfile, settings, applications, interviews, research, keys] = await Promise.all([
      read("profiles", "tailor_count, tailor_count_reset_at, claude_tailors_used, is_unlimited, section_order"),
      read("master_cvs", "text, projects_pool, updated_at"),
      read("cv_profiles", "data, updated_at"),
      read("user_settings", "eligibility, claims, variants, preferences, updated_at"),
      read("applications", "*", "date_applied"),
      read("mock_interviews", "id, application_id, type, persona, llm_path, status, plan, transcript, feedback, created_at, finished_at", "created_at"),
      read("company_profiles", "domain, data, fetched_at", "fetched_at"),
      read("user_api_keys", "provider, key_hint, updated_at"),
    ]);

    // An unfinished interview's plan holds the questions not yet asked; the
    // room reveals them one at a time, so the export does the same.
    if (interviews.rows) {
      interviews.rows = interviews.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return row.status === "finished" ? row : { ...row, plan: null, planNote: "withheld until the interview is finished" };
      });
    }
    // The uploaded CV's record without its storage path.
    if (applications.rows) {
      applications.rows = applications.rows.map((r) => {
        const row = r as Record<string, unknown>;
        if ("sent_cv" in row) return { ...row, sent_cv: publicSentCv(normalizeSentCv(row.sent_cv)) };
        return row;
      });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      account: { id: userId, email },
      profile,
      masterCv,
      cvProfile,
      settings,
      applications,
      mockInterviews: interviews,
      companyResearch: research,
      providerKeys: { ...keys, note: keys.note ?? "hints only — the keys themselves are encrypted and never exported" },
    };
    const day = payload.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="jobhuntz-data-${day}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("account export error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not export your data" }, { status: 500 });
  }
}
