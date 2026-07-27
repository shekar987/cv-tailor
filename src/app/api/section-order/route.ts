import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  resolveSectionOrder,
  isValidSectionOrderPayload,
  isDefaultOrder,
} from "@/lib/sectionOrder";

// Reads and writes profiles.section_order for the signed-in user.
//
// No LLM call and no cost, so this deliberately does NOT go through the burst
// limiter that guards the Claude-spending routes. RLS ("id = auth.uid()") plus
// the column-level UPDATE grant mean a user can only ever touch their own row
// and only this one column.

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: row, error: readError } = await supabase
      .from("profiles")
      .select("section_order")
      .maybeSingle();

    if (readError) {
      // Fail soft: the Customize page can still render the default order.
      console.error("Section order read error:", readError.message);
      return NextResponse.json({ order: resolveSectionOrder(null), customised: false });
    }

    const stored = row?.section_order ?? null;
    return NextResponse.json({
      order: resolveSectionOrder(stored),
      customised: stored !== null,
    });
  } catch (error) {
    console.error("Section order GET error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your section order" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    let body: { order?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!isValidSectionOrderPayload(body.order)) {
      return NextResponse.json(
        { error: "That section order isn't valid. Refresh the page and try again." },
        { status: 400 }
      );
    }

    // Storing null for the default keeps "never customised" and "customised
    // back to the default" indistinguishable at the render layer — both take
    // the untouched-user code path exactly.
    const value = isDefaultOrder(body.order) ? null : body.order;

    // Scoped by id as well as RLS: belt and braces on a write.
    const { error: writeError } = await supabase
      .from("profiles")
      .update({ section_order: value })
      .eq("id", userId);

    if (writeError) {
      console.error("Section order write error:", writeError.message);
      return NextResponse.json({ error: "Could not save your section order" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, order: body.order, customised: value !== null });
  } catch (error) {
    console.error("Section order POST error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Could not save your section order" }, { status: 500 });
  }
}
