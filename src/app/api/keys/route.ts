import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/keyEncryption";

const VALID_PROVIDERS = new Set(["gemini", "openrouter"]);
const MIN_KEY_LEN = 10;
const MAX_KEY_LEN = 500;

// ─── POST /api/keys — save an encrypted key for a provider ────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const { provider, key } = body;

    if (!VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    // Validate key shape — never log the value itself
    if (typeof key !== "string") {
      return NextResponse.json({ error: "Key must be a string" }, { status: 400 });
    }
    if (key.length < MIN_KEY_LEN || key.length > MAX_KEY_LEN) {
      return NextResponse.json(
        { error: `Key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters` },
        { status: 400 }
      );
    }
    if (/\s/.test(key)) {
      return NextResponse.json({ error: "Key must not contain whitespace" }, { status: 400 });
    }
    if (provider === "openrouter" && !key.startsWith("sk-or-v1-")) {
      return NextResponse.json(
        { error: "OpenRouter keys must start with sk-or-v1-" },
        { status: 400 }
      );
    }

    // Encrypt at the boundary — plaintext key never touches the DB
    const key_enc   = encrypt(key);
    const key_hint  = key.slice(-4);           // last 4 chars for masked UI display
    const updated_at = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from("user_api_keys")
      .upsert(
        { user_id: userId, provider, key_enc, key_hint, updated_at },
        { onConflict: "user_id,provider" }
      );

    if (upsertError) {
      console.error("Key upsert error:", upsertError.message);
      return NextResponse.json({ error: "Failed to save key" }, { status: 500 });
    }

    // Return ONLY the safe fields — no key, no ciphertext, ever
    return NextResponse.json({ provider, key_hint, updated_at });
  } catch (err) {
    console.error("POST /api/keys error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── DELETE /api/keys?provider=gemini — remove a stored key ──────────────────
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    const provider = new URL(req.url).searchParams.get("provider");
    if (!provider || !VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from("user_api_keys")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);

    if (deleteError) {
      console.error("Key delete error:", deleteError.message);
      return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
    }

    return NextResponse.json({ deleted: true, provider });
  } catch (err) {
    console.error("DELETE /api/keys error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
