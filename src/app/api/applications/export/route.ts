import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// CSV export of the signed-in user's application tracker. RLS scopes the read;
// no LLM call, so no burst limiter.
//
// Optional filters mirror the page so the file matches what's on screen:
//   ?status=Interview            one of the six statuses
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   inclusive range on date_applied. The client
//                                computes these in its own timezone, so "today"
//                                means the user's today, not the server's.

const STATUSES = new Set(["Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS: { header: string; key: string }[] = [
  { header: "Company", key: "company_name" },
  { header: "Role", key: "role" },
  { header: "Status", key: "status" },
  { header: "Salary", key: "salary" },
  { header: "Date Applied", key: "date_applied" },
  { header: "Follow-up", key: "followup_date" },
  { header: "Notes", key: "notes" },
  { header: "Source", key: "source" },
  { header: "CV Reference", key: "cv_reference" },
  { header: "Job Description", key: "job_description" },
  { header: "Created At", key: "created_at" },
];

// Every field is quoted; embedded quotes are doubled. A leading =, +, -, @ or
// tab is prefixed with an apostrophe so a note like "=HYPERLINK(...)" opens as
// text in Excel instead of executing.
function csvField(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URL(req.url).searchParams;
    const status = params.get("status");
    const from = params.get("from");
    const to = params.get("to");
    if (status && !STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
    }
    if ((from && !ISO_DATE_RE.test(from)) || (to && !ISO_DATE_RE.test(to))) {
      return NextResponse.json({ error: "Invalid date filter (use YYYY-MM-DD)." }, { status: 400 });
    }

    let query = supabase
      .from("applications")
      .select(
        "company_name, role, status, salary, date_applied, followup_date, notes, source, cv_reference, job_description, created_at"
      );
    if (status) query = query.eq("status", status);
    if (from) query = query.gte("date_applied", from);
    if (to) query = query.lte("date_applied", to);

    const { data: rows, error: readError } = await query
      .order("date_applied", { ascending: false })
      .order("created_at", { ascending: false });

    if (readError) {
      console.error("applications export read error:", readError.message);
      return NextResponse.json({ error: "Could not export your applications" }, { status: 500 });
    }

    const lines = [COLUMNS.map((c) => csvField(c.header)).join(",")];
    for (const row of (rows ?? []) as Record<string, unknown>[]) {
      lines.push(COLUMNS.map((c) => csvField(row[c.key])).join(","));
    }
    // BOM so Excel reads the file as UTF-8; CRLF row endings per RFC 4180.
    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";

    // Name the file after the filter so a folder of exports stays legible.
    const nameParts = ["applications"];
    if (status) nameParts.push(status.toLowerCase());
    if (from && to) nameParts.push(from === to ? from : `${from}_to_${to}`);
    else if (from) nameParts.push(`from_${from}`);
    else if (to) nameParts.push(`to_${to}`);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nameParts.join("-")}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("applications export error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not export your applications" }, { status: 500 });
  }
}
