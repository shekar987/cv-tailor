// Required Supabase configuration, read in one place so a missing variable
// fails with a message that names it instead of a confusing per-request 500
// from createServerClient(undefined, undefined). Both are NEXT_PUBLIC_ so the
// same values are inlined into the browser bundle.

export function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return value;
}

export function supabasePublishableKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (note: not the legacy ANON_KEY name)");
  return value;
}
