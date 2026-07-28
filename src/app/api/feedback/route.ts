import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Insert-only feedback endpoint. RLS ("auth.uid() = user_id", insert-only for
// `authenticated`) is the real boundary; submitters can never read back their
// own or anyone else's feedback through the app. No burst limiter — this is
// an ordinary DB write, not an LLM call.

const MAX_MESSAGE = 2000;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;
    const email = (data.claims.email as string | undefined) ?? "";

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Please enter some feedback before submitting." }, { status: 400 });
    }

    const { error: insertError } = await supabase
      .from("user_feedback")
      .insert({ user_id: userId, email, message: message.slice(0, MAX_MESSAGE) });

    if (insertError) {
      console.error("user_feedback insert error:", insertError.message);
      return NextResponse.json({ error: "Could not submit your feedback" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("user_feedback POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not submit your feedback" }, { status: 500 });
  }
}
