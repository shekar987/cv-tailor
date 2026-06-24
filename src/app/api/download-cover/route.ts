import { NextRequest } from "next/server";
import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";

export async function POST(req: NextRequest) {
  try {
    const { coverLetter } = await req.json();
    const text: string = coverLetter || "";

    // Each non-empty line becomes a justified paragraph; blank lines become spacers
    const children: Paragraph[] = [];
    const rawLines = text.split("\n");
    for (const raw of rawLines) {
      const line = raw.trim();
      if (line === "") {
        continue;
      }
      // strip **bold** markers, render bold runs
      const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
      const runs = parts.map((p) =>
        p.startsWith("**") && p.endsWith("**")
          ? new TextRun({ text: p.slice(2, -2), bold: true, size: 22, font: "Calibri" })
          : new TextRun({ text: p, size: 22, font: "Calibri" })
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
    console.error("Cover letter download error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate cover letter" }), { status: 500 });
  }
}