import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// CRUD for the user's stored skills pool. RLS ("auth.uid() = user_id") is the
// real boundary; queries are additionally scoped by user id.

const MAX_SKILLS = 300;
const MAX_SKILL_LENGTH = 120;
const CATEGORIES = ["functional", "technical"] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: rows, error: readError } = await supabase
      .from("user_skills")
      .select("id, skill, category, created_at")
      .order("created_at", { ascending: true });

    if (readError) {
      console.error("user_skills read error:", readError.message);
      return NextResponse.json({ error: "Could not load your skills" }, { status: 500 });
    }
    return NextResponse.json({ skills: rows ?? [] });
  } catch (err) {
    console.error("user_skills GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your skills" }, { status: 500 });
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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!isCategory(body.category)) {
      return NextResponse.json({ error: "Pick either functional or technical." }, { status: 400 });
    }

    // Accept one skill or a comma/newline-separated batch, so a user can paste
    // a whole list at once instead of adding them one at a time.
    const raw = typeof body.skill === "string" ? body.skill : "";
    const entries = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.slice(0, MAX_SKILL_LENGTH));

    if (entries.length === 0) {
      return NextResponse.json({ error: "Type a skill to add." }, { status: 400 });
    }

    const { count } = await supabase.from("user_skills").select("id", { count: "exact", head: true });
    if ((count ?? 0) + entries.length > MAX_SKILLS) {
      return NextResponse.json(
        { error: `You can store up to ${MAX_SKILLS} skills.` },
        { status: 400 }
      );
    }

    // A unique index on (user_id, category, lower(skill)) makes re-adding an
    // existing skill a silent no-op rather than an error or a duplicate row.
    const { error: insertError } = await supabase
      .from("user_skills")
      .upsert(
        entries.map((skill) => ({ user_id: userId, skill, category: body.category as Category })),
        { onConflict: "user_id,category,skill", ignoreDuplicates: true }
      );

    if (insertError) {
      console.error("user_skills insert error:", insertError.message);
      return NextResponse.json({ error: "Could not save those skills" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, added: entries.length });
  } catch (err) {
    console.error("user_skills POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save those skills" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = data.claims.sub as string;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "No skill specified" }, { status: 400 });

    const { error: deleteError } = await supabase
      .from("user_skills")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("user_skills delete error:", deleteError.message);
      return NextResponse.json({ error: "Could not delete that skill" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("user_skills DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete that skill" }, { status: 500 });
  }
}
