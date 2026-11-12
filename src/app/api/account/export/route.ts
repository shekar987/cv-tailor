import { NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";
import { normalizeSentCv, publicSentCv } from "@/lib/sentCv";
import { readApplicationPages, type OrderableQuery } from "@/lib/applicationRows";
import { accountExportChunks } from "@/lib/account";

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

    function section(table: string, data: unknown, error: { code?: string; message: string } | null): Section {
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return { rows: null, note: "table not present on this database" };
        if (error.code === "42703") return { rows: null, note: `a column is missing: ${error.message}` };
        console.error(`account export ${table}:`, error.message);
        return { rows: null, note: "could not be read" };
      }
      return { rows: (data ?? []) as unknown[] };
    }
    async function read(table: string, columns: string, order?: string): Promise<Section> {
      let q = supabase.from(table).select(columns).eq(table === "profiles" ? "id" : "user_id", userId);
      if (order) q = q.order(order, { ascending: true });
      const { data, error } = await q.limit(5000);
      return section(table, data, error);
    }
    // Finished events stay, and every notes change is kept, so these tables can pass
    // PostgREST's 1000 rows per request: read in pages.
    async function readPaged(table: string, order: string): Promise<Section> {
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select("*").eq("user_id", userId).order(order, { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
        if (error) return section(table, null, error);
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) return section(table, rows, null);
      }
    }
    // The tracker can pass PostgREST's 1000 rows per request; the other tables
    // are one row or a handful.
    async function readApplications(): Promise<Section> {
      const { rows, error } = await readApplicationPages(
        () => supabase.from("applications").select("*").eq("user_id", userId) as unknown as OrderableQuery
      );
      return section("applications", rows, error);
    }

    const [profile, masterCv, cvProfile, settings, applications, interviews, research, keys, events, availability, notesHistory, companyRules] = await Promise.all([
      read("profiles", "tailor_count, tailor_count_reset_at, claude_tailors_used, is_unlimited, section_order"),
      read("master_cvs", "text, projects_pool, updated_at"),
      read("cv_profiles", "data, updated_at"),
      read("user_settings", "eligibility, claims, variants, preferences, updated_at"),
      readApplications(),
      read("mock_interviews", "id, application_id, type, persona, llm_path, status, plan, transcript, feedback, created_at, finished_at", "created_at"),
      read("company_profiles", "domain, data, fetched_at", "fetched_at"),
      read("user_api_keys", "provider, key_hint, updated_at"),
      readPaged("application_events", "created_at"),
      read("availability_windows", "*", "created_at"),
      // Chunk 21 (migration 20261110120000): every earlier version of the notes, and the
      // companies' reapply rules.
      readPaged("notes_history", "changed_at"),
      read("company_rules", "*", "created_at"),
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
      planEvents: events,
      availability,
      notesHistory,
      companyRules,
      providerKeys: { ...keys, note: keys.note ?? "hints only — the keys themselves are encrypted and never exported" },
    };
    const day = payload.exportedAt.slice(0, 10);
    const chunks = accountExportChunks(payload);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      },
    });
    return new NextResponse(body, {
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
