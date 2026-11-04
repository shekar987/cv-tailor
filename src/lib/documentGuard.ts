import { NextResponse } from "next/server";
import { normalizePreferences } from "@/lib/preferences";
import { findRetired, retiredBlockMessage, type RetiredClaim } from "@/lib/retiredClaims";

// The server's half of lib/retiredClaims, for the four download routes: the file is
// refused while the text still says something the user's list rules out, so an edit
// in the preview or an old tracker snapshot cannot bring it back. Reads as the user,
// so RLS applies. A failed read leaves the built-in phrases in force and logs: a
// missing table or column must not stop every download.

type Caller = {
  supabase: { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- the two reads here need only .select().eq().maybeSingle()
  userId: string;
};

export async function documentRules(caller: Caller): Promise<{ rules: RetiredClaim[]; masterCv: string }> {
  const [settings, master] = await Promise.all([
    caller.supabase.from("user_settings").select("preferences").eq("user_id", caller.userId).maybeSingle(),
    caller.supabase.from("master_cvs").select("text").eq("user_id", caller.userId).maybeSingle(),
  ]);
  if (settings.error) console.error("document guard: settings read failed:", settings.error.code ?? "unknown");
  if (master.error) console.error("document guard: master CV read failed:", master.error.code ?? "unknown");
  return {
    rules: normalizePreferences(settings.data?.preferences).retiredClaims,
    masterCv: typeof master.data?.text === "string" ? master.data.text : "",
  };
}

/** 422 with the sentence the previews show, or null when the text is clear. */
export function retiredRefusal(text: string, rules: readonly RetiredClaim[]): NextResponse | null {
  const hits = findRetired(text, rules);
  if (hits.length === 0) return null;
  return NextResponse.json({ error: retiredBlockMessage(hits), errorType: "retired_claim", phrases: hits }, { status: 422 });
}

/** The text of a CV download's body, for the check. */
export function cvBodyText(body: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const projects = body.projects && typeof body.projects === "object" ? Object.values(body.projects as Record<string, unknown>).flat() : [];
  const meta = Array.isArray(body.projectsMeta) ? (body.projectsMeta as { name?: unknown; tech?: unknown }[]) : [];
  return [
    text(body.summary),
    text(body.skills),
    text(body.experience),
    ...projects.map(text),
    ...meta.flatMap((m) => [text(m?.name), text(m?.tech)]),
  ].join("\n");
}
