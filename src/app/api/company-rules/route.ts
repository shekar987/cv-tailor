// /api/company-rules (10 Nov 2026, Chunk 21; lib/companyRules): what a company said about
// applying again, checked by JD triage on /app before any credit is spent.
//
//   GET                                   every rule of the caller's, switched-off ones too
//   POST { company_name, rule_type, value, anchor_date?, source_text?, application_id?, source? }
//                                         one rule; the same rule already saved answers it back
//   PUT  { id, dismissed: true | false }  switch a rule off or on again
//
// No DELETE: nothing is removed (the table grants none either). No model call, no credit.
// Until migration 20261110120000 is applied the list is empty and a write answers 503.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { normalizeRule, readRuleInput, ruleExists, type CompanyRule } from "@/lib/companyRules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RULES = 500;
const COLUMNS = "id, company_name, rule_type, value, anchor_date, source_text, source, application_id, created_at, dismissed_at";
const MIGRATION_HINT =
  "Company rules need migration 20261110120000_safe_notes_cooldowns_deadlines.sql. Run it in the Supabase SQL editor, then try again.";
const isMissingTable = (err: { code?: string } | null) => err?.code === "PGRST205" || err?.code === "42P01";

export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const { data, error } = await supabase.from("company_rules").select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(MAX_RULES);
    if (error) {
      // Triage then reads no rules: the same as having none.
      if (isMissingTable(error)) return NextResponse.json({ rules: [], needsMigration: true });
      console.error("company rules read error:", error.code ?? "unknown");
      return NextResponse.json({ error: "Could not load your company rules" }, { status: 500 });
    }
    return NextResponse.json({ rules: (data ?? []).map(normalizeRule).filter((r): r is CompanyRule => r !== null) });
  } catch (err) {
    console.error("company rules GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your company rules" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const read = readRuleInput(body);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
    const { rule } = read;

    const { data: existing, error: readError } = await supabase.from("company_rules").select(COLUMNS).eq("user_id", userId).limit(MAX_RULES);
    if (readError) {
      if (isMissingTable(readError)) return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("company rules read error:", readError.code ?? "unknown");
      return NextResponse.json({ error: "Could not save that rule" }, { status: 500 });
    }
    const rules = (existing ?? []).map(normalizeRule).filter((r): r is CompanyRule => r !== null);
    if (ruleExists(rules, rule)) {
      const same = rules.find((r) => !r.dismissed_at && ruleExists([r], rule));
      return NextResponse.json({ ok: true, rule: same, alreadySaved: true });
    }
    if (rules.length >= MAX_RULES) return NextResponse.json({ error: `You can keep up to ${MAX_RULES} company rules.` }, { status: 400 });
    // An application named must be the caller's own (RLS hides anyone else's).
    if (rule.application_id) {
      const { data: row } = await supabase.from("applications").select("id").eq("id", rule.application_id).eq("user_id", userId).maybeSingle();
      if (!row) rule.application_id = null;
    }

    const { data, error } = await supabase.from("company_rules").insert({ ...rule, user_id: userId }).select(COLUMNS).single();
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("company rule insert error:", error.code ?? "unknown");
      return NextResponse.json({ error: "Could not save that rule" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, rule: normalizeRule(data) });
  } catch (err) {
    console.error("company rules POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that rule" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    if (typeof body.id !== "string" || !UUID_RE.test(body.id)) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    if (typeof body.dismissed !== "boolean") return NextResponse.json({ error: "Send dismissed: true to switch the rule off, or false to switch it on." }, { status: 400 });

    const { data, error } = await supabase
      .from("company_rules")
      .update({ dismissed_at: body.dismissed ? new Date().toISOString() : null })
      .eq("id", body.id)
      .eq("user_id", userId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ error: MIGRATION_HINT, errorType: "needs_migration" }, { status: 503 });
      console.error("company rule update error:", error.code ?? "unknown");
      return NextResponse.json({ error: "Could not change that rule" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    return NextResponse.json({ ok: true, rule: normalizeRule(data) });
  } catch (err) {
    console.error("company rules PUT error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not change that rule" }, { status: 500 });
  }
}
