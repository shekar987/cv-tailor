// The preamble every route handler used to repeat: who is calling, whether
// the body is worth reading, and whether it is small enough to read at all.
// Twenty routes carried the same six-line auth block (twenty-four copies);
// applications/cv had already folded it into a helper, which this is.
//
// Auth is getClaims(): it verifies the JWT locally — no network round-trip —
// and cannot answer with a stale session the way getSession() can.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type RouteSupabase = Awaited<ReturnType<typeof createClient>>;

export type SignedIn = {
  supabase: RouteSupabase;
  userId: string;
  /** The account's email, "" when the token carries none. */
  email: string;
};

/** The signed-in caller, or null when the request carries no valid session. */
export async function signedIn(): Promise<SignedIn | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    supabase,
    userId: data.claims.sub as string,
    email: (data.claims.email as string | undefined) ?? "",
  };
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
export const invalidBody = () => NextResponse.json({ error: "Invalid request body" }, { status: 400 });
export const payloadTooLarge = () =>
  NextResponse.json({ error: "Document payload is too large." }, { status: 413 });

// The JSON object the request carries, or null. Routes read fields straight
// off it, so a body that is not an object — an array, a string, `null` — is
// refused here as a 400 instead of throwing on the first field read and
// surfacing as a 500 further down.
export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

// True when the declared Content-Length is over the cap. Checked before the
// body is read, so an oversized upload is refused without being buffered.
export function declaresMoreThan(req: NextRequest, maxBytes: number): boolean {
  return Number(req.headers.get("content-length") || 0) > maxBytes;
}
