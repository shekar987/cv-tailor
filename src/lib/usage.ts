// The signed-in user's free-tier position, read from their own profiles row
// (RLS-scoped; the app already reads is_unlimited from it client-side).
// Fail-soft by contract: any error returns null and every consumer simply
// hides its usage UI — quota display must never break a page.

import { createClient } from "@/lib/supabase/client";
import { DAILY_TAILOR_LIMIT, CLAUDE_LIFETIME_LIMIT } from "@/lib/limits";

export type Usage = {
  dailyUsed: number;
  dailyLimit: number;
  // When the next daily window starts; null when nothing is counted right now.
  resetAt: string | null;
  claudeUsed: number;
  claudeLimit: number;
  unlimited: boolean;
};

export async function getUsage(): Promise<Usage | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("tailor_count, tailor_count_reset_at, claude_tailors_used, is_unlimited")
      .maybeSingle();
    if (error || !data) return null;

    // tailor_count counts within a rolling window that ends at reset_at; a
    // reset_at in the past means the counter is stale and the next run starts
    // a fresh window — display it as zero used.
    const resetAt = typeof data.tailor_count_reset_at === "string" ? data.tailor_count_reset_at : null;
    const windowExpired = resetAt === null || new Date(resetAt).getTime() <= Date.now();
    const rawDaily = typeof data.tailor_count === "number" ? data.tailor_count : 0;
    const rawClaude = typeof data.claude_tailors_used === "number" ? data.claude_tailors_used : 0;

    return {
      dailyUsed: windowExpired ? 0 : Math.min(rawDaily, DAILY_TAILOR_LIMIT),
      dailyLimit: DAILY_TAILOR_LIMIT,
      resetAt: windowExpired ? null : resetAt,
      claudeUsed: Math.min(rawClaude, CLAUDE_LIFETIME_LIMIT),
      claudeLimit: CLAUDE_LIFETIME_LIMIT,
      unlimited: data.is_unlimited === true,
    };
  } catch {
    return null;
  }
}
