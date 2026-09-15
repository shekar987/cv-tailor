import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPrepPdf } from "@/lib/buildPrepPdf";
import { packFromRow, prepPdfFilename } from "@/lib/prepPack";
import { MAX_DOCUMENT_BODY_BYTES, MAX_PREP_PACK_JSON } from "@/lib/limits";

// Pinned because src/lib/pdfText.ts reads the embedded font files with fs at
// import time (same as the other PDF routes).
export const runtime = "nodejs";

// Stage 4 — the prep pack as a PDF. Same shape as /api/download-cover-pdf:
// the client posts the document it is looking at, the server draws it. The
// pack is re-normalized on the way in, so a malformed body is a 400, never
// a crash, and nothing here ever falls back to anyone else's data.
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
    if (JSON.stringify(body.pack ?? null).length > MAX_PREP_PACK_JSON) {
      return NextResponse.json({ error: "Prep pack is too large." }, { status: 400 });
    }
    const pack = packFromRow(body.pack);
    if (!pack) {
      return NextResponse.json({ error: "That doesn't look like a prep pack." }, { status: 400 });
    }

    const bytes = buildPrepPdf(pack);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${prepPdfFilename(pack)}"`,
      },
    });
  } catch (error) {
    console.error("Prep PDF error:", error instanceof Error ? error.message : "Unknown error");
    return new Response(JSON.stringify({ error: "Failed to generate the prep pack PDF" }), { status: 500 });
  }
}
