import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCoverLetterPdf } from "@/lib/buildCoverLetterPdf";
import { MAX_COVER_LETTER_CHARS, MAX_DOCUMENT_BODY_BYTES } from "@/lib/limits";
import { extractPdfText, checkPdfTextLayer, countWords } from "@/lib/pdfTextCheck";

// 'nodejs' is already the Next 16 default; pinned because src/lib/pdfText.ts
// reads the embedded font files with fs at import time.
export const runtime = "nodejs";

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

    if (Number(req.headers.get("content-length") || 0) > MAX_DOCUMENT_BODY_BYTES) {
      return NextResponse.json({ error: "Document payload is too large." }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (body.coverLetter !== undefined && typeof body.coverLetter !== "string") {
      return NextResponse.json({ error: "Cover letter must be text." }, { status: 400 });
    }
    const text = (body.coverLetter ?? "") as string;
    if (text.length > MAX_COVER_LETTER_CHARS) {
      return NextResponse.json({ error: "Cover letter is too long." }, { status: 400 });
    }

    const bytes = buildCoverLetterPdf(text);

    // Same text-layer check as the CV PDF (lib/pdfTextCheck): the letter's
    // words must come back out of the file, judged against the letter itself.
    const check = checkPdfTextLayer(await extractPdfText(bytes), { sourceWords: countWords(text) });
    if (!check.ok) {
      console.error("Cover letter PDF text-layer check failed:", check.problems.join("; "));
      return NextResponse.json(
        { error: `The PDF failed its text-layer check and was not sent: ${check.problems.join("; ")}. Use the Word download and report this.`, errorType: "pdf_text_layer" },
        { status: 500 }
      );
    }

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="cover-letter.pdf"',
      },
    });
  } catch (error) {
    console.error("Cover letter PDF download error:", error instanceof Error ? error.message : "Unknown error");
    return new Response(JSON.stringify({ error: "Failed to generate cover letter PDF" }), { status: 500 });
  }
}
