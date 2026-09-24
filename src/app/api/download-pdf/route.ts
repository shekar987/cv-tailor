import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCvPdf } from "@/lib/buildCvPdf";
import { normalizeProfile } from "@/lib/profile";
import { MAX_DOCUMENT_BODY_BYTES } from "@/lib/limits";
import { extractPdfText, checkPdfTextLayer, countWords } from "@/lib/pdfTextCheck";

// 'nodejs' is already the Next 16 default; pinned because src/lib/pdfText.ts
// reads the embedded font files with fs at import time.
export const runtime = "nodejs";

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

    // jsPDF lays the document out synchronously; refuse oversized bodies from
    // the header before reading them into memory.
    if (Number(req.headers.get("content-length") || 0) > MAX_DOCUMENT_BODY_BYTES) {
      return NextResponse.json({ error: "Document payload is too large." }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const text = (v: unknown) => (typeof v === "string" ? v : "");
    const profile = normalizeProfile(body.profile);
    const projects = body.projects && typeof body.projects === "object" ? (body.projects as Record<string, string[]>) : {};
    const bytes = buildCvPdf({
      summary: text(body.summary),
      skills: text(body.skills),
      experience: text(body.experience),
      projects,
      projectsMeta: Array.isArray(body.projectsMeta) ? body.projectsMeta : [],
      profile,
      sectionOrder: body.sectionOrder,
    });

    // Text-layer check (lib/pdfTextCheck): read the text back out of the
    // bytes just built, the way an ATS parser would, and refuse to send a
    // file that does not carry the name, the email and the document's words.
    // A rasterised PDF shipped once; this is what would have caught it.
    const sourceWords = countWords([text(body.summary), text(body.skills), text(body.experience), Object.values(projects).flat().filter((b) => typeof b === "string").join("\n")].join("\n"));
    const check = checkPdfTextLayer(await extractPdfText(bytes), { name: profile.name, email: String(profile.email || ""), sourceWords });
    if (!check.ok) {
      console.error("PDF text-layer check failed:", check.problems.join("; "));
      return NextResponse.json(
        { error: `The PDF failed its text-layer check and was not sent: ${check.problems.join("; ")}. Use the Word download and report this.`, errorType: "pdf_text_layer" },
        { status: 500 }
      );
    }

    // The client names the saved file (see saveBlob in CvPreview); this header
    // is a safe constant so no profile text ever reaches a response header.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="CV.pdf"',
      },
    });
  } catch (error) {
    console.error("PDF download error:", error instanceof Error ? error.message : "Unknown error");
    return new Response(JSON.stringify({ error: "Failed to generate PDF" }), { status: 500 });
  }
}
