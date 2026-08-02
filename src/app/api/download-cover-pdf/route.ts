import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCoverLetterPdf } from "@/lib/buildCoverLetterPdf";

// Same auth guard and request-body shape as /api/download-cover (the .docx
// route) — real-text replacement for the old client-side html2canvas
// rasterizer (src/lib/docxToPdf.ts, removed).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { coverLetter } = await req.json();
    const bytes = buildCoverLetterPdf(coverLetter || "");

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="cover-letter.pdf"',
      },
    });
  } catch (error) {
    console.error("Cover letter PDF download error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate cover letter PDF" }), { status: 500 });
  }
}
