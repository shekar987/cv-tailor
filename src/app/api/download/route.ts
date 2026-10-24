import { NextRequest } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
import { normalizeProfile } from "@/lib/profile";
import { MAX_DOCUMENT_BODY_BYTES } from "@/lib/limits";
import { buildCvDocx } from "@/lib/buildCvDocx";
import { contactRefusal } from "@/lib/contactRefusal";

// The CV as a .docx. The document itself is built by lib/buildCvDocx (the
// PDF route's mirror, lib/buildCvPdf); this route is auth, the body, and the
// contact check every generated CV passes first (lib/contactCheck).
export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();

    // docx's Packer runs synchronously; refuse oversized bodies from the
    // header before reading them into memory.
    if (declaresMoreThan(req, MAX_DOCUMENT_BODY_BYTES)) return payloadTooLarge();

    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    const text = (v: unknown) => (typeof v === "string" ? v : "");

    // A CV whose email is "Gmail" is never built (lib/contactCheck).
    const profile = normalizeProfile(body.profile);
    const refused = contactRefusal(profile);
    if (refused) return refused;

    // One page for a candidate who chose it (the preview sends targetPages: 1
    // — lib/onePage trimmed the content to fit it); two otherwise.
    const bytes = await buildCvDocx({
      summary: text(body.summary),
      skills: text(body.skills),
      experience: text(body.experience),
      projects: body.projects && typeof body.projects === "object" ? (body.projects as Record<string, unknown>) : {},
      projectsMeta: Array.isArray(body.projectsMeta) ? body.projectsMeta : [],
      profile,
      sectionOrder: body.sectionOrder,
      targetPages: body.targetPages === 1 ? 1 : 2,
      // The run's format style (lib/formatStyles).
      formatStyle: body.formatStyle,
    });

    // The client names the saved file (see saveBlob in CvPreview); this header
    // is a safe constant so no profile text ever reaches a response header —
    // a non-Latin name here used to crash the response with ERR_INVALID_CHAR.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="CV.docx"',
      },
    });
  } catch (error) {
    console.error("Download error:", error instanceof Error ? error.message : "Unknown error");
    return new Response(JSON.stringify({ error: "Failed to generate document" }), { status: 500 });
  }
}
