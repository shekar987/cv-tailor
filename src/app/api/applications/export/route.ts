import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// CSV export of the signed-in user's application tracker. RLS scopes the read;
// no LLM call, so no burst limiter.

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

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: rows, error: readError } = await supabase
      .from("applications")
      .select(
        "company_name, role, status, salary, date_applied, followup_date, notes, source, cv_reference, job_description, created_at"
      )
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

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="applications.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("applications export error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not export your applications" }, { status: 500 });
  }
}
