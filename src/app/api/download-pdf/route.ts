import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCvPdf } from "@/lib/buildCvPdf";

// Same auth guard and request-body shape as /api/download (the .docx route) —
// this is the real-text replacement for the old client-side html2canvas
// rasterizer (src/lib/docxToPdf.ts, removed), which produced image-only
// PDFs with no text layer at all.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { summary, skills, experience, projects, projectsMeta, companyName, roleTitle, profile, sectionOrder } = await req.json();

    const firstName = (profile?.name || "").trim().split(/\s+/).slice(0, 2).join("_") || "User";
    const clean = (s: string) =>
      (s || "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
    const parts = [firstName, clean(companyName), clean(roleTitle), "CV"].filter(Boolean);
    const filename = parts.join("_") + ".pdf";

    const bytes = buildCvPdf({ summary, skills, experience, projects, projectsMeta, profile, sectionOrder });

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("PDF download error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate PDF" }), { status: 500 });
  }
}
