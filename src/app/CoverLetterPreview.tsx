"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import DownloadButton from "./DownloadButton";
import { saveBlob } from "@/lib/saveBlob";
import { pastePlainText } from "@/lib/pastePlainText";
import StatusText from "@/components/ui/StatusText";

// What a parent can read back through the ref: the letter as it stands in
// the editable DOM (the Applied button snapshots it into the tracker).
export type CoverLetterPreviewHandle = {
  collectText: () => string | null;
};

type Props = {
  coverLetter: string;
  fileBaseName?: string;
  // The date line is added by the app for a letter being written today. A
  // stored letter already carries the date it was sent as its first line, so
  // the tracker renders it without a second one.
  withDateLine?: boolean;
};

const CoverLetterPreview = forwardRef<CoverLetterPreviewHandle, Props>(function CoverLetterPreview(
  { coverLetter, fileBaseName = "CoverLetter", withDateLine = true },
  handleRef
) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);

  // Today's date, inserted by the app — the LLM is told never to write a date
  // line because it can't know the real date. Format: "10 July 2026".
  // Memoised: computed in the render body it would differ across renders and
  // between server and client.
  const todayLine = useMemo(
    () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    []
  );

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

  // Hooks stay above the early return below, so the handle exists whether or
  // not there is a letter to show (collectText answers null in that case).
  useImperativeHandle(handleRef, () => ({ collectText }));

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
    if (busy) return;
    setDocErr(null);
    setBusy(true);
    try {
      // Built server-side from the same edited text as the Word download,
      // with a real text layer (not a rasterized image) so it's ATS-parseable.
      const edited = collectText();
      if (edited === null) throw new Error("Could not build the document");
      const res = await fetch("/api/download-cover-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetter: edited }),
      });
      if (!res.ok) throw new Error("Could not build the document");
      const blob = await res.blob();
      saveBlob(blob, `${fileBaseName}.pdf`);
    } catch (e) {
      console.error("Cover letter PDF generation failed:", e instanceof Error ? e.message : String(e));
      setDocErr("PDF generation failed. Try the Word download, or retry.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadWord() {
    if (busy) return;
    setDocErr(null);
    setBusy(true);
    try {
      const blob = await fetchDocx();
      if (!blob) { setDocErr("Word download failed. Please retry."); return; }
      saveBlob(blob, `${fileBaseName}.docx`);
    } catch (e) {
      console.error("Cover letter Word generation failed:", e instanceof Error ? e.message : String(e));
      setDocErr("Word download failed. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  if (!coverLetter) return null;

  return (
    <div className="clWrap">
      <div className="cvActions">
        <DownloadButton onPdf={downloadPdf} onWord={downloadWord} busy={busy} />
      </div>
      {docErr && <StatusText role="alert">{docErr}</StatusText>}
      <p className="editHint">Click any text to edit your cover letter. Changes are included when you download.</p>
      <div className="clDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false} onPaste={pastePlainText}>
        {withDateLine && <p className="clLine">{todayLine}</p>}
        {paragraphs.filter((line) => line !== "").map((line, i) => (
          <p key={i} className="clLine">{line.replace(/\*\*/g, "")}</p>
        ))}
      </div>
    </div>
  );
});

export default CoverLetterPreview;
