"use client";

import { useRef, useState } from "react";

// Upload a CV file and hand the extracted text back to the caller. This does NOT
// save anything: the text lands in the existing master-CV textarea so the user
// reviews and edits it first, and saving still goes through the normal flow.
// Parsing happens server-side in /api/parse-cv — nothing is parsed in the browser.

const ACCEPT = ".pdf,.docx,.txt";
const MAX_BYTES = 5 * 1024 * 1024;

export default function CvUpload({
  onExtracted,
  disabled = false,
}: {
  onExtracted: (text: string, meta: { filename: string; characters: number }) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setError(null);

    // Cheap client-side check so an obviously oversized file never leaves the
    // browser. The server enforces the real limit regardless.
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

  return (
    <div className="uploadBlock">
      <div
        className={`dropZone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled || busy) return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="dropInput"
          disabled={disabled || busy}
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
      {error && <p className="error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
