// POST /api/applications/bulk (12 Nov 2026, Chunk 23): one call for many rows.
//
//   { ids: ["…", …], followup_date?: "YYYY-MM-DD" | null, status?: "Applied" | …, append_line?: "Follow-up sent" }
//   → { ok, updated, failed, results: [{ id, ok, code, updated_at, error?, errorType?, message?, skipped? }] }
//
// Each id is written by the tracker's own PUT (../route), one row at a time with the body
// { id, followup_date, status, append_note: append_line }, so a bulk move obeys every rule
// a single PUT does and nothing is decided twice (lib/bulkUpdate says which): a screened
// row is never ended (409, pendingOutcomeUrl), an ended row is never reopened (202, held
// as a question, ok: false), the line is stamped and skipped as a repeat within ten
// minutes (skipped: "duplicate_note"). One row's refusal never stops the others; the
// answer is 200 with a result per id (`code` is that row's HTTP status). Send an
// Idempotency-Key, as on every write: a retry then gets the first answer and writes
// nothing, so to retry only the rows that failed, send their ids under a NEW key.
//
// At most 100 ids a call, 20 calls a minute. No model call.
import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { idempotent, jsonBodyOf } from "@/lib/idempotentRoute";
import { BULK_CONCURRENCY, bulkAnswer, bulkItem, inBatches, itemBody, readBulkBody } from "@/lib/bulkUpdate";
import { PUT } from "../route";

export const runtime = "nodejs";
export const maxDuration = 60;

const PATH = "/api/applications/bulk";
const BULK_LIMIT = { limit: 20, windowSeconds: 60 };
const MAX_BODY_BYTES = 64_000;

export async function POST(req: NextRequest) {
  return idempotent(req, PATH, jsonBodyOf(req), () => bulkUpdate(req));
}

async function bulkUpdate(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const burst = await checkBurstLimit(caller.userId, "applications-bulk", BULK_LIMIT);
    if (!burst.ok) {
      return NextResponse.json(
        { error: `Too many bulk updates. Please wait ${burst.retryAfterSeconds}s and try again.`, errorType: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }
    if (declaresMoreThan(req, MAX_BODY_BYTES)) return payloadTooLarge();
    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const read = readBulkBody(body);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

    // The single PUT, for each row, inside this request (its session, its cookies).
    const target = new URL("/api/applications", req.url);
    const results = await inBatches(read.ids, BULK_CONCURRENCY, async (id) => {
      try {
        const res = await PUT(
          new NextRequest(target, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(itemBody(id, read.patch)) })
        );
        return bulkItem(id, res.status, await res.json().catch(() => null));
      } catch (err) {
        console.error("applications bulk row error:", err instanceof Error ? err.message : "Unknown error");
        return bulkItem(id, 500, { error: "Could not save that application" });
      }
    });
    return NextResponse.json(bulkAnswer(results, read.repeatedIds));
  } catch (err) {
    console.error("applications bulk error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save those applications" }, { status: 500 });
  }
}
