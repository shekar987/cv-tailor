// Chunk 33: a user's PC-worker devices. Creating one mints a token shown ONCE
// here and stored only as a sha256 hash; the worker (Chunk 34) sends that token
// to the device-checked RPCs. Revoking flips the row's `revoked` flag so the
// token stops working without breaking the FK from jobs it already claimed.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { signedIn, unauthorized, readJsonBody } from "@/lib/routeAuth";
import { checkBurstLimit } from "@/lib/apiRateLimit";

export const runtime = "nodejs"; // node:crypto

function newToken(): { token: string; hash: string } {
  const token = "jhd_" + randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  return { token, hash };
}

const needsMigration = (code?: string) => code === "PGRST205" || code === "42P01";

// ─── GET /api/agent/devices — list the user's devices (never the token) ───────
export async function GET() {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const { data, error } = await supabase
      .from("agent_devices")
      .select("id, name, last_seen_at, revoked, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      if (needsMigration(error.code)) return NextResponse.json({ devices: [], needsMigration: true });
      console.error("agent devices list error:", error.message);
      return NextResponse.json({ error: "Failed to load devices" }, { status: 500 });
    }
    return NextResponse.json({ devices: data ?? [] });
  } catch (err) {
    console.error("GET /api/agent/devices error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── POST /api/agent/devices — create a device, return its token once ─────────
export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const burst = await checkBurstLimit(userId, "agent-device", { limit: 10, windowSeconds: 3600 });
    if (!burst.ok) {
      return NextResponse.json(
        { error: "Too many devices created. Try again later." },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds ?? 60) } }
      );
    }

    const body = (await readJsonBody(req)) ?? {};
    let name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) name = "My PC";
    if (name.length > 80) name = name.slice(0, 80);

    const { token, hash } = newToken();
    const { data, error } = await supabase
      .from("agent_devices")
      .insert({ user_id: userId, name, token_hash: hash })
      .select("id, name, last_seen_at, revoked, created_at")
      .single();
    if (error) {
      if (needsMigration(error.code)) {
        return NextResponse.json(
          { error: "needs_migration", migration: "20261119120000_agent_queue.sql" },
          { status: 503 }
        );
      }
      console.error("agent devices create error:", error.message);
      return NextResponse.json({ error: "Failed to create device" }, { status: 500 });
    }
    // The ONE time the plaintext token leaves the server.
    return NextResponse.json({ device: data, token });
  } catch (err) {
    console.error("POST /api/agent/devices error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── DELETE /api/agent/devices?id=… — revoke a device ─────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing device id" }, { status: 400 });
    const { data, error } = await supabase
      .from("agent_devices")
      .update({ revoked: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, name, last_seen_at, revoked, created_at")
      .maybeSingle();
    if (error) {
      console.error("agent devices revoke error:", error.message);
      return NextResponse.json({ error: "Failed to revoke device" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Device not found" }, { status: 404 });
    return NextResponse.json({ device: data });
  } catch (err) {
    console.error("DELETE /api/agent/devices error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
