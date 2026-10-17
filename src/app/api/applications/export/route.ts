import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized } from "@/lib/routeAuth";

// CSV export of the signed-in user's application tracker. RLS scopes the read;
// no LLM call, so no burst limiter.
//
// Optional filters mirror the page so the file matches what's on screen:
//   ?status=Interview            one of the statuses in lib/tracker
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   inclusive range on date_applied. The client
//                                computes these in its own timezone, so "today"
//                                means the user's today, not the server's.
//   ?q=acme                      the page's search term, applied with the same
//                                matcher (lib/trackerSearch: company, role and
//                                the date's spellings) after the read — a
//                                typed "18 sep" has no ilike form.
//   ?style=ukji|careerset|unknown the format-style tag (lib/formatStyles),
//                                applied after the read like ?q; the owner's
//                                account only (profiles.is_unlimited), which
//                                is also the only file that carries the
//                                "Format style" column — everyone else's
//                                export is exactly what it was.

import { matchesSearch, MAX_SEARCH_CHARS } from "@/lib/trackerSearch";
import { isStatus } from "@/lib/tracker";
import { rowStyle, isFormatStyleId, ROW_STYLE_LABELS, type RowStyle } from "@/lib/formatStyles/ids";
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
// The owner's file ends in the format-style tag (lib/formatStyles): UKJI /
// CareerSet, blank when the row recorded none.
const STYLE_COLUMN = { header: "Format style", key: "format_style" };
const STYLE_SELECT = "format_style:tailored_cv->>formatStyle";
function isStyleFilter(v: string): v is RowStyle {
  return v === "unknown" || isFormatStyleId(v);
}

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
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const params = new URL(req.url).searchParams;
    const status = params.get("status");
    const from = params.get("from");
    const to = params.get("to");
    if (status && !isStatus(status)) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
    }
    if ((from && !ISO_DATE_RE.test(from)) || (to && !ISO_DATE_RE.test(to))) {
      return NextResponse.json({ error: "Invalid date filter (use YYYY-MM-DD)." }, { status: 400 });
    }
    const q = (params.get("q") ?? "").trim();
    if (q.length > MAX_SEARCH_CHARS) {
      return NextResponse.json({ error: `Search term too long (max ${MAX_SEARCH_CHARS} characters).` }, { status: 400 });
    }

    // The style column and filter are the owner's (the feature is being
    // compared on one account); the flag is read as the user, under RLS.
    const { data: prof } = await supabase.from("profiles").select("is_unlimited").eq("id", userId).maybeSingle();
    const owner = prof?.is_unlimited === true;
    const styleParam = params.get("style");
    if (styleParam && !isStyleFilter(styleParam)) {
      return NextResponse.json({ error: "Invalid style filter." }, { status: 400 });
    }
    const style = owner && styleParam ? styleParam : null;
    const columns = owner ? [...COLUMNS, STYLE_COLUMN] : COLUMNS;

    const BASE = "company_name, role, status, salary, date_applied, followup_date, notes, source, cv_reference, job_description, created_at";
    const read = async (select: string) => {
      let query = supabase.from("applications").select(select);
      if (status) query = query.eq("status", status);
      if (from) query = query.gte("date_applied", from);
      if (to) query = query.lte("date_applied", to);
      return query.order("date_applied", { ascending: false }).order("created_at", { ascending: false });
    };
    let { data: rows, error: readError } = await read(owner ? `${BASE}, ${STYLE_SELECT}` : BASE);
    if (readError && owner && readError.code === "42703") {
      // tailored_cv not migrated in: the column reads blank.
      ({ data: rows, error: readError } = await read(BASE));
    }

    if (readError) {
      console.error("applications export read error:", readError.message);
      return NextResponse.json({ error: "Could not export your applications" }, { status: 500 });
    }

    const lines = [columns.map((c) => csvField(c.header)).join(",")];
    for (const row of ((rows ?? []) as unknown as Record<string, unknown>[]).filter((r) => matchesSearch(r, q) && (!style || rowStyle(r.format_style) === style))) {
      const tag = rowStyle(row.format_style);
      lines.push(columns.map((c) => csvField(c.key === "format_style" ? (tag === "unknown" ? "" : ROW_STYLE_LABELS[tag]) : row[c.key])).join(","));
    }
    // BOM so Excel reads the file as UTF-8; CRLF row endings per RFC 4180.
    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";

    // Name the file after the filter so a folder of exports stays legible.
    const nameParts = ["applications"];
    if (status) nameParts.push(status.toLowerCase());
    if (from && to) nameParts.push(from === to ? from : `${from}_to_${to}`);
    else if (from) nameParts.push(`from_${from}`);
    else if (to) nameParts.push(`to_${to}`);
    if (q) {
      const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
      if (slug) nameParts.push(`search-${slug}`);
    }
    if (style) nameParts.push(`style-${style}`);

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
