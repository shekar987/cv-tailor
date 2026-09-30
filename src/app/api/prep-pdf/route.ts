import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
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
    const caller = await signedIn();
    if (!caller) return unauthorized();

    if (declaresMoreThan(req, MAX_DOCUMENT_BODY_BYTES)) return payloadTooLarge();

    const body = await readJsonBody(req);
    if (!body) return invalidBody();
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
