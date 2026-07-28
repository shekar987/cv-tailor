"use client";

import { useRef, useState } from "react";
import DownloadButton from "./DownloadButton";
import { saveBlob } from "@/lib/saveBlob";
import StatusText from "@/components/ui/StatusText";

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

  // Read the (possibly edited) cover letter text back from the live DOM.
  function collectText(): string | null {
    if (!ref.current) return null;
    (document.activeElement as HTMLElement)?.blur();
    return Array.from(ref.current.querySelectorAll("p"))
      .map((p) => (p.textContent || "").trim())
      .join("\n");
  }

  // Server-built .docx for the current letter — shared source for both downloads.
  async function fetchDocx(): Promise<Blob | null> {
    const edited = collectText();
    if (edited === null) return null;
    const res = await fetch("/api/download-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetter: edited }),
    });
    if (!res.ok) return null;
    return res.blob();
  }

  async function downloadPdf() {
    if (pdfBusy) return;
    setDocErr(null);
    setPdfBusy(true);
    try {
      // PDF renders from the SAME server-built .docx as Word — identical layout,
      // all in-browser, no data leaves the page.
      const blob = await fetchDocx();
      if (!blob) throw new Error("Could not build the document");
      const { docxBlobToPdf } = await import("@/lib/docxToPdf");
      await docxBlobToPdf(blob, fileBaseName);
    } catch (e) {
      console.error("Cover letter PDF generation failed:", e);
      setDocErr("PDF generation failed. Try the Word download, or retry.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadWord() {
    setDocErr(null);
    try {
      const blob = await fetchDocx();
      if (!blob) { setDocErr("Word download failed. Please retry."); return; }
      saveBlob(blob, `${fileBaseName}.docx`);
    } catch (e) {
      console.error("Cover letter Word generation failed:", e);
      setDocErr("Word download failed. Check your connection and retry.");
    }
  }

  if (!coverLetter) return null;

  return (
    <div className="clWrap">
      <div className="cvActions">
        <DownloadButton onPdf={downloadPdf} onWord={downloadWord} busy={pdfBusy} />
      </div>
      {docErr && <StatusText role="alert">{docErr}</StatusText>}
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