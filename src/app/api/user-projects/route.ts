import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// CRUD for the user's stored project repository. RLS ("auth.uid() = user_id")
// is the real boundary; every query is additionally scoped by user id.
//
// No LLM call, so no burst limiter — these are ordinary DB reads/writes.

const MAX_PROJECTS = 50;
const MAX_NAME = 200;
const MAX_TECH = 500;
const MAX_BULLET = 600;
const MAX_BULLETS = 12;
const MAX_LINKS = 6;

type LinkInput = { label?: unknown; url?: unknown; text?: unknown };

function cleanLinks(value: unknown): { label: string; url: string; text: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_LINKS)
    .map((raw) => {
      const l = (raw ?? {}) as LinkInput;
      const url = typeof l.url === "string" ? l.url.trim() : "";
      // Only http(s) links are stored — same rule the download route applies
      // before building an ExternalHyperlink.
      const safeUrl = /^https?:\/\//i.test(url) ? url : url ? `https://${url.replace(/^\/+/, "")}` : "";
      return {
        label: typeof l.label === "string" ? l.label.trim().slice(0, 60) : "",
        url: safeUrl.slice(0, 500),
        text: typeof l.text === "string" ? l.text.trim().slice(0, 200) : "",
      };
    })
    .filter((l) => l.url !== "");
}

function cleanBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is string => typeof b === "string")
    .map((b) => b.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)
    .slice(0, MAX_BULLETS)
    .map((b) => b.slice(0, MAX_BULLET));
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: rows, error: readError } = await supabase
      .from("user_projects")
      .select("id, project_name, tech_stack, links, bullets, created_at")
      .order("created_at", { ascending: true });

    if (readError) {
      console.error("user_projects read error:", readError.message);
      return NextResponse.json({ error: "Could not load your projects" }, { status: 500 });
    }
    return NextResponse.json({ projects: rows ?? [] });
  } catch (err) {
    console.error("user_projects GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your projects" }, { status: 500 });
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

    const name = typeof body.project_name === "string" ? body.project_name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Give the project a name." }, { status: 400 });
    }

    const record = {
      project_name: name.slice(0, MAX_NAME),
      tech_stack: (typeof body.tech_stack === "string" ? body.tech_stack.trim() : "").slice(0, MAX_TECH),
      links: cleanLinks(body.links),
      bullets: cleanBullets(body.bullets),
    };

    // Update when an id is supplied, otherwise insert.
    const id = typeof body.id === "string" && body.id ? body.id : null;
    if (id) {
      const { error: updateError } = await supabase
        .from("user_projects")
        .update(record)
        .eq("id", id)
        .eq("user_id", userId);
      if (updateError) {
        console.error("user_projects update error:", updateError.message);
        return NextResponse.json({ error: "Could not save that project" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, id });
    }

    const { count } = await supabase
      .from("user_projects")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_PROJECTS) {
      return NextResponse.json(
        { error: `You can store up to ${MAX_PROJECTS} projects. Delete one to add another.` },
        { status: 400 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("user_projects")
      .insert({ ...record, user_id: userId })
      .select("id")
      .single();

    if (insertError) {
      console.error("user_projects insert error:", insertError.message);
      return NextResponse.json({ error: "Could not save that project" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: inserted?.id });
  } catch (err) {
    console.error("user_projects POST error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not save that project" }, { status: 500 });
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
    if (!id) return NextResponse.json({ error: "No project specified" }, { status: 400 });

    const { error: deleteError } = await supabase
      .from("user_projects")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("user_projects delete error:", deleteError.message);
      return NextResponse.json({ error: "Could not delete that project" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("user_projects DELETE error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete that project" }, { status: 500 });
  }
}
