// The Idempotency-Key header on a route handler (12 Nov 2026, Chunk 22): the rules are
// lib/idempotency's; this file is the Supabase store (api_idempotency, migration
// 20261112120000, RLS: own rows only) and the HTTP answers. A request without the
// header runs exactly as before.
import { NextResponse, after, type NextRequest } from "next/server";
import { signedIn, type RouteSupabase } from "@/lib/routeAuth";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_MIGRATION_HINT,
  IDEMPOTENCY_TTL_MS,
  IN_PROGRESS_MESSAGE,
  REUSED_MESSAGE,
  UNKNOWN_MESSAGE,
  keptBody,
  canonicalJsonBody,
  fingerprint,
  readIdempotencyKey,
  runIdempotent,
  type IdempotencyRecord,
  type IdempotencyStore,
  type StoredResponse,
} from "@/lib/idempotency";

const TABLE = "api_idempotency";

function isMissingTable(err: { code?: string } | null): boolean {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

function supabaseStore(supabase: RouteSupabase, userId: string): IdempotencyStore & { sweep(): Promise<void> } {
  const own = () => supabase.from(TABLE);
  return {
    async claim(key, hash, method, path) {
      const { error } = await own().insert({ user_id: userId, key, request_hash: hash, method, path });
      if (!error) return "claimed";
      if (error.code === "23505") return "taken";
      if (isMissingTable(error)) return "missing";
      throw new Error(`idempotency claim failed: ${error.code ?? "unknown"}`);
    },
    async read(key) {
      const { data, error } = await own().select("request_hash, status_code, response, created_at").eq("user_id", userId).eq("key", key).maybeSingle();
      if (error) throw new Error(`idempotency read failed: ${error.code ?? "unknown"}`);
      return (data as IdempotencyRecord | null) ?? null;
    },
    async retake(key, seenCreatedAt, hash, method, path) {
      const { data, error } = await own()
        .update({ request_hash: hash, method, path, status_code: null, response: null, created_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("key", key)
        .eq("created_at", seenCreatedAt)
        .select("key");
      if (error) throw new Error(`idempotency retake failed: ${error.code ?? "unknown"}`);
      return (data ?? []).length === 1;
    },
    async finish(key, hash, response) {
      const { error } = await own()
        .update({ status_code: response.status, response: response.body ?? null })
        .eq("user_id", userId)
        .eq("key", key)
        .eq("request_hash", hash);
      if (error) {
        console.error("idempotency finish error:", error.code ?? "unknown");
        throw new Error("idempotency finish failed");
      }
    },
    async release(key, hash) {
      const { error } = await own().delete().eq("user_id", userId).eq("key", key).eq("request_hash", hash).is("status_code", null);
      if (error) console.error("idempotency release error:", error.code ?? "unknown");
    },
    // Keys older than a day are free again; their rows go after the answer is sent.
    async sweep() {
      const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
      const { error } = await own().delete().eq("user_id", userId).lt("created_at", cutoff);
      if (error && !isMissingTable(error)) console.error("idempotency sweep error:", error.code ?? "unknown");
    },
  };
}

async function jsonOf(res: NextResponse): Promise<StoredResponse | null> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    return { status: res.status, body: await res.clone().json() };
  } catch {
    return null;
  }
}

// What the store keeps: the answer without the row's notes and a file's text (lib/idempotency keptBody).
async function storedFrom(res: NextResponse): Promise<StoredResponse | null> {
  const answer = await jsonOf(res);
  return answer ? { status: answer.status, body: keptBody(answer.body) } : null;
}

/**
 * Run `handler` once per Idempotency-Key. `canonicalBody` is what the fingerprint reads of
 * the request (a JSON body key-sorted; a form's fields and files' hashes), from a clone, so
 * the handler still reads the request itself.
 */
export async function idempotent(req: NextRequest, path: string, canonicalBody: () => Promise<string>, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  const parsed = readIdempotencyKey(req.headers.get(IDEMPOTENCY_HEADER));
  if ("none" in parsed) return handler();
  if ("error" in parsed) return NextResponse.json({ error: parsed.error, errorType: "invalid_idempotency_key" }, { status: 400 });
  const caller = await signedIn();
  // Signed out: the handler answers 401 and nothing is kept.
  if (!caller) return handler();
  const store = supabaseStore(caller.supabase, caller.userId);
  let outcome: Awaited<ReturnType<typeof runIdempotent<NextResponse>>>;
  try {
    const hash = fingerprint({ method: req.method, path, body: await canonicalBody() });
    outcome = await runIdempotent({ key: parsed.key, hash, method: req.method, path, store, now: Date.now }, handler, storedFrom);
  } catch (err) {
    // The key could not be claimed or read: the handler never ran (it catches its own errors).
    console.error("idempotency error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "idempotency_error", errorType: "idempotency_error", message: "The Idempotency-Key could not be checked, so nothing was written. Send the request again." }, { status: 503, headers: { "Retry-After": "5" } });
  }
  switch (outcome.kind) {
    case "ran":
      after(() => store.sweep());
      return outcome.value;
    case "replayed":
      after(() => store.sweep());
      return NextResponse.json(outcome.response.body, { status: outcome.response.status, headers: { "Idempotent-Replayed": "true" } });
    case "in_progress":
      return NextResponse.json({ error: "idempotency_in_progress", errorType: "idempotency_in_progress", message: IN_PROGRESS_MESSAGE }, { status: 409, headers: { "Retry-After": "5" } });
    case "unknown":
      return NextResponse.json({ error: "idempotency_unknown", errorType: "idempotency_unknown", message: UNKNOWN_MESSAGE }, { status: 409 });
    case "reused":
      return NextResponse.json({ error: "idempotency_key_reused", errorType: "idempotency_key_reused", message: REUSED_MESSAGE }, { status: 422 });
    case "unavailable": {
      // Ran, unprotected: the caller must know its key did nothing.
      const answer = await jsonOf(outcome.value);
      const body = answer && answer.body && typeof answer.body === "object" && !Array.isArray(answer.body) ? { ...(answer.body as Record<string, unknown>), idempotencyWarning: IDEMPOTENCY_MIGRATION_HINT } : null;
      return body ? NextResponse.json(body, { status: outcome.value.status }) : outcome.value;
    }
  }
}

/** The fingerprint's view of a JSON request body. */
export function jsonBodyOf(req: NextRequest): () => Promise<string> {
  return async () => canonicalJsonBody(await req.clone().text());
}
