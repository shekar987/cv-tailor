import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { MAX_FEEDBACK_CHARS } from "@/lib/limits";

// Insert-only feedback endpoint. RLS ("auth.uid() = user_id", insert-only for
// `authenticated`) is the real boundary; submitters can never read back their
// own or anyone else's feedback through the app. No burst limiter — this is
// an ordinary DB write, not an LLM call.

const MAX_MESSAGE = MAX_FEEDBACK_CHARS;

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId, email } = caller;

    const body = await readJsonBody(req);
    if (!body) return invalidBody();

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
