// The JD triage a tracker row is saved with (lib/triage/jdTriage, Chunk 8), shared by
// POST / PUT /api/applications and POST /api/applications/log (moved here unchanged,
// 12 Nov 2026, Chunk 22).
//
// It is computed on the server from the stored job description — never taken from the
// client — and kept at tailored_cv.gates.triage beside the pre-check's read. Its inputs
// are read here too, under RLS: the user's Eligibility answers and master CV, so a row
// saved from anywhere is judged by the same answers. No JD → no triage; a snapshot left
// empty is null.
import type { RouteSupabase } from "@/lib/routeAuth";
import { triageJd, buildTriageProfile, type JdTriage } from "@/lib/triage/jdTriage";

export async function triageForUser(supabase: RouteSupabase, userId: string, jd: string): Promise<JdTriage> {
  // Missing table or row: the answers are unknown and the rules say so.
  const [settings, cv] = await Promise.all([
    supabase.from("user_settings").select("eligibility").eq("user_id", userId).maybeSingle(),
    supabase.from("master_cvs").select("text").eq("user_id", userId).maybeSingle(),
  ]);
  return triageJd(jd, buildTriageProfile(settings.data?.eligibility, cv.data?.text));
}

export function withTriage(snapshot: Record<string, unknown> | null, triage: JdTriage | null): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(snapshot ?? {}) };
  const gates: Record<string, unknown> =
    next.gates && typeof next.gates === "object" && !Array.isArray(next.gates) ? { ...(next.gates as Record<string, unknown>) } : {};
  if (triage) gates.triage = triage;
  else delete gates.triage;
  if (Object.keys(gates).length > 0) next.gates = gates;
  else delete next.gates;
  return Object.keys(next).length > 0 ? next : null;
}
