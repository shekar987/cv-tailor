"use client";

import { useRef, useState } from "react";

export default function CoverLetterPreview({
  coverLetter,
  fileBaseName = "CoverLetter",
}: {
  coverLetter: string;
  fileBaseName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);

  // Today's date, inserted by the app — the LLM is told never to write a date
  // line because it can't know the real date. Format: "10 July 2026".
  const todayLine = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // split into paragraphs on blank lines; drop any placeholder-only lines
  // (e.g. a stray "[Date]") the LLM emits despite the prompt rule
  const paragraphs = (coverLetter || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !/^\[[^\]]*\]$/.test(l));

  async function downloadPdf() {
    if (!ref.current || pdfBusy) return;
    (document.activeElement as HTMLElement)?.blur();
    setDocErr(null);
    setPdfBusy(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const opt = {
        margin: [16, 16, 16, 16] as [number, number, number, number],
        filename: `${fileBaseName}.pdf`,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };
      await html2pdf().set(opt).from(ref.current).save();
    } catch (e) {
      console.error("Cover letter PDF generation failed:", e);
      setDocErr("PDF generation failed. Try the Word download, or retry.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadWord() {
    if (!ref.current) return;
    (document.activeElement as HTMLElement)?.blur();
    // read edited text back from the live DOM
    const edited = Array.from(ref.current.querySelectorAll("p"))
      .map((p) => (p.textContent || "").trim())
      .join("\n");

    setDocErr(null);
    try {
      const res = await fetch("/api/download-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetter: edited }),
      });
      if (!res.ok) {
        setDocErr("Word download failed. Please retry.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBaseName}.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Cover letter Word generation failed:", e);
      setDocErr("Word download failed. Check your connection and retry.");
    }
  }

  if (!coverLetter) return null;

  return (
    <div className="clWrap">
      <div className="cvActions">
        <button className="cta" onClick={downloadPdf} disabled={pdfBusy}>
          {pdfBusy ? "Generating…" : "Download PDF"}
        </button>
        <button className="cta secondary" onClick={downloadWord}>Download Word</button>
      </div>
      {docErr && <p className="error" role="alert">{docErr}</p>}
      <p className="editHint">Click any text to edit your cover letter. Changes are included when you download.</p>
      <div className="clDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}>
        <p className="clLine">{todayLine}</p>
        {paragraphs.filter((line) => line !== "").map((line, i) => (
          <p key={i} className="clLine">{line.replace(/\*\*/g, "")}</p>
        ))}
      </div>
    </div>
  );
}