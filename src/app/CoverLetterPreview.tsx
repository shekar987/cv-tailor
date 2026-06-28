"use client";

import { useRef } from "react";

export default function CoverLetterPreview({
  coverLetter,
  fileBaseName = "CoverLetter",
}: {
  coverLetter: string;
  fileBaseName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // split into paragraphs on blank lines
  const paragraphs = (coverLetter || "")
    .split("\n")
    .map((l) => l.trim());

  async function downloadPdf() {
    if (!ref.current) return;
    (document.activeElement as HTMLElement)?.blur();
    const html2pdf = (await import("html2pdf.js")).default;
    const opt = {
      margin: [16, 16, 16, 16] as [number, number, number, number],
      filename: `${fileBaseName}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };
    html2pdf().set(opt).from(ref.current).save();
  }

  async function downloadWord() {
    if (!ref.current) return;
    (document.activeElement as HTMLElement)?.blur();
    // read edited text back from the live DOM
    const edited = Array.from(ref.current.querySelectorAll("p"))
      .map((p) => (p.textContent || "").trim())
      .join("\n");

    const res = await fetch("/api/download-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetter: edited }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.docx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  if (!coverLetter) return null;

  return (
    <div className="clWrap">
      <div className="cvActions">
        <button className="cta" onClick={downloadPdf}>Download PDF</button>
        <button className="cta secondary" onClick={downloadWord}>Download Word</button>
      </div>
      <p className="editHint">Click any text to edit your cover letter. Changes are included when you download.</p>
      <div className="clDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}>
        {paragraphs.filter((line) => line !== "").map((line, i) => (
          <p key={i} className="clLine">{line.replace(/\*\*/g, "")}</p>
        ))}
      </div>
    </div>
  );
}