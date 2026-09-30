import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody, declaresMoreThan, payloadTooLarge } from "@/lib/routeAuth";
import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import { MAX_COVER_LETTER_CHARS, MAX_DOCUMENT_BODY_BYTES } from "@/lib/limits";
import { parseBoldSegments } from "@/lib/markdownText";

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();

    if (declaresMoreThan(req, MAX_DOCUMENT_BODY_BYTES)) return payloadTooLarge();

    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    if (body.coverLetter !== undefined && typeof body.coverLetter !== "string") {
      return NextResponse.json({ error: "Cover letter must be text." }, { status: 400 });
    }
    const text = (body.coverLetter ?? "") as string;
    if (text.length > MAX_COVER_LETTER_CHARS) {
      return NextResponse.json({ error: "Cover letter is too long." }, { status: 400 });
    }

    // Each non-empty line becomes a justified paragraph; blank lines become spacers
    const children: Paragraph[] = [];
    const rawLines = text.split("\n");
    for (const raw of rawLines) {
      const line = raw.trim();
      if (line === "") {
        continue;
      }
      // The ONE bold parser (lib/markdownText). This route carried its own
      // regex — the only place that could drift from the PDF side of the same
      // letter, and its pattern already had.
      const runs = parseBoldSegments(line).map((seg) =>
        seg.bold
          ? new TextRun({ text: seg.text, bold: true, size: 22, font: "Calibri" })
          : new TextRun({ text: seg.text, size: 22, font: "Calibri" })
      );
      children.push(new Paragraph({
        spacing: { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
        children: runs,
      }));
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="cover-letter.docx"',
      },
    });
  } catch (error) {
    console.error("Cover letter download error:", error instanceof Error ? error.message : "Unknown error");
    return new Response(JSON.stringify({ error: "Failed to generate cover letter" }), { status: 500 });
  }
}
