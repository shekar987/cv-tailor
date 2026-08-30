"use client";

import { useRef, useState } from "react";
import StatusText from "@/components/ui/StatusText";

// Upload a CV file and hand the extracted text back to the caller. This does NOT
// save anything: the text lands in the existing master-CV textarea so the user
// reviews and edits it first, and saving still goes through the normal flow.
// Parsing happens server-side in /api/parse-cv — nothing is parsed in the browser.

const ACCEPT = ".pdf,.docx,.txt";
const ACCEPT_RE = /\.(pdf|docx|txt)$/i;
const MAX_BYTES = 5 * 1024 * 1024;

export default function CvUpload({
  onExtracted,
  disabled = false,
}: {
  onExtracted: (text: string, meta: { filename: string; characters: number }) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child element crossed, so a plain
  // boolean flickers; a depth counter only clears when the pointer truly leaves.
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setError(null);

    // Cheap client-side checks so an obviously wrong file never leaves the
    // browser (drag-and-drop bypasses the input's accept list). The server
    // sniffs the real bytes regardless.
    if (!ACCEPT_RE.test(file.name)) {
      setError("Upload a PDF, Word (.docx) or .txt file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 5MB. Upload a smaller file.");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/parse-cv", { method: "POST", body });

      // A non-JSON body (proxy error, HTML error page) must not throw past the
      // finally block and leave the button stuck on "Reading…".
      let data: { text?: string; characters?: number; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        setError("Something went wrong reading that file. Please try again.");
        return;
      }

      if (!res.ok) {
        setError(data.error || "Could not read that file. Please paste your CV text instead.");
        return;
      }
      if (!data.text) {
        setError("No text could be read from that file. Please paste your CV text instead.");
        return;
      }

      onExtracted(data.text, { filename: file.name, characters: data.characters ?? data.text.length });
    } catch {
      // Network failure, offline, aborted request.
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      // Clear the input so re-selecting the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const inert = disabled || busy;

  return (
    <div className="uploadBlock">
      <div
        className={`dropZone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          if (!inert) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (inert) return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        {/* Covers the zone so a drop anywhere lands on it; tabIndex -1 keeps
            this invisible control out of the keyboard order — the visible
            "Upload a file" button is the focusable affordance. */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="dropInput"
          tabIndex={-1}
          aria-hidden="true"
          disabled={inert}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="dropInner">
          {busy ? (
            <>
              <span className="dropSpinner" aria-hidden="true" />
              <span className="dropTitle">Reading your CV…</span>
              <span className="dropHint">Extracting the text — this usually takes a few seconds.</span>
            </>
          ) : (
            <>
              <span className="dropTitle">
                <button
                  type="button"
                  className="dropBrowse"
                  disabled={disabled}
                  onClick={() => inputRef.current?.click()}
                >
                  Upload a file
                </button>
                <span className="dropOr"> or drag it here</span>
              </span>
              <span className="dropHint">PDF, Word (.docx) or .txt — up to 5MB</span>
            </>
          )}
        </div>
      </div>
      {error && <StatusText role="alert" className="uploadError">{error}</StatusText>}
    </div>
  );
}
