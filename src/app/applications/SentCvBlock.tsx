"use client";

import { useRef, useState } from "react";
import StatusText from "@/components/ui/StatusText";
import Icon from "@/components/ui/Icon";
import { saveBlob } from "@/lib/saveBlob";
import { formatFileSize, type SentCvInfo } from "@/lib/sentCv";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE } from "@/lib/limits";

// The CV file a user actually sent for one application (lib/sentCv) — above
// all for applications made on other sites, where Jobhuntz never saw the
// document. Pick or drop a file; it goes to /api/applications/cv, which reads
// its text and stores it privately. Then it is listed with Download, Replace
// and Remove, and the text read from it can be opened below.

const ACCEPT = ".pdf,.docx,.txt";
const ACCEPT_RE = /\.(pdf|docx|txt)$/i;
const MAX_BYTES = MAX_UPLOAD_BYTES;
const KIND_LABEL: Record<SentCvInfo["kind"], string> = { pdf: "PDF", docx: "Word", txt: "Text" };
// The sheet's own date style ("26 Sep 2026"); the browser's en-GB short month
// would print "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function uploadedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function SentCvBlock({
  applicationId,
  company,
  sentCv,
  compact,
  label,
  onChange,
  onSessionExpired,
}: {
  applicationId: string;
  company: string;
  sentCv: SentCvInfo | null;
  // A row tailored here already shows its CV: the upload is offered as one
  // line rather than a drop zone.
  compact: boolean;
  // The block's own "CV you sent" heading — off where the panel title
  // already says it (a row added by hand).
  label: boolean;
  onChange: (next: SentCvInfo | null) => void;
  onSessionExpired: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child crossed; a depth counter only
  // clears when the pointer truly leaves (same as CvUpload).
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"" | "upload" | "download" | "remove">("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function upload(file: File) {
    setError("");
    // Cheap checks before anything leaves the browser (a drop bypasses the
    // input's accept list); the server sniffs the real bytes regardless.
    if (!ACCEPT_RE.test(file.name)) {
      setError("Upload a PDF, Word (.docx) or .txt file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(UPLOAD_TOO_LARGE);
      return;
    }
    setBusy("upload");
    try {
      const body = new FormData();
      body.append("id", applicationId);
      body.append("file", file);
      const res = await fetch("/api/applications/cv", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return onSessionExpired();
      // The host's own refusal of an oversized body is plain text, not JSON.
      if (res.status === 413) {
        setError(UPLOAD_TOO_LARGE);
        return;
      }
      if (!res.ok || !data.sentCv) {
        setError(data.error || "Could not upload that file. Try again.");
        return;
      }
      setConfirmRemove(false);
      onChange(data.sentCv as SentCvInfo);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy("");
      // Clear the input so choosing the same file again fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download() {
    if (!sentCv) return;
    setError("");
    setBusy("download");
    try {
      const res = await fetch(`/api/applications/cv?id=${encodeURIComponent(applicationId)}`);
      if (res.status === 401) return onSessionExpired();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not download that file. Try again.");
        return;
      }
      saveBlob(await res.blob(), sentCv.fileName);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setError("");
    setBusy("remove");
    try {
      const res = await fetch(`/api/applications/cv?id=${encodeURIComponent(applicationId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return onSessionExpired();
      if (!res.ok) {
        setError(data.error || "Could not remove that file. Try again.");
        return;
      }
      setConfirmRemove(false);
      onChange(null);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  const pick = () => inputRef.current?.click();
  const fileInput = (overlay: boolean) => (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className={overlay ? "dropInput" : undefined}
      hidden={!overlay}
      tabIndex={-1}
      aria-hidden="true"
      disabled={busy !== ""}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void upload(file);
      }}
      data-sent-cv-input
    />
  );

  return (
    <div className="sentCv" data-sent-cv={sentCv ? "stored" : "none"}>
      {label && <div className="atsGroupLabel recs">CV you sent</div>}
      {sentCv ? (
        <>
          <div className="sentCvFile">
            <span className="sentCvIcon" aria-hidden="true">
              <Icon name="document" />
            </span>
            <div className="sentCvMeta">
              <span className="sentCvName" data-sent-cv-name>{sentCv.fileName}</span>
              <span className="sentCvInfo">
                {[KIND_LABEL[sentCv.kind], formatFileSize(sentCv.size), sentCv.uploadedAt && `uploaded ${uploadedOn(sentCv.uploadedAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <div className="sentCvActions">
              {confirmRemove ? (
                <>
                  <span className="appsConfirm">Remove this file?</span>
                  <button type="button" className="appsActionBtn danger" onClick={() => void remove()} disabled={busy !== ""} data-sent-cv-confirm>
                    {busy === "remove" ? "Removing…" : "Remove"}
                  </button>
                  <button type="button" className="appsActionBtn" onClick={() => setConfirmRemove(false)} disabled={busy !== ""}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="appsActionBtn primary" onClick={() => void download()} disabled={busy !== ""} data-sent-cv-download>
                    {busy === "download" ? "Downloading…" : "Download"}
                  </button>
                  <button type="button" className="appsActionBtn" onClick={pick} disabled={busy !== ""} data-sent-cv-replace>
                    {busy === "upload" ? "Uploading…" : "Replace"}
                  </button>
                  <button type="button" className="appsActionBtn danger" onClick={() => setConfirmRemove(true)} disabled={busy !== ""} data-sent-cv-remove>
                    Remove
                  </button>
                </>
              )}
            </div>
            {fileInput(false)}
          </div>
          {sentCv.textNote ? (
            <p className="fitEvidence" data-warn="" data-sent-cv-note>{sentCv.textNote}</p>
          ) : sentCv.text ? (
            <details className="sentCvText">
              <summary>Text read from the file</summary>
              <pre data-sent-cv-text>{sentCv.text}</pre>
            </details>
          ) : null}
        </>
      ) : compact ? (
        <p className="fitEvidence">
          Sent a different version?{" "}
          <button type="button" className="inlineLink" onClick={pick} disabled={busy !== ""} data-sent-cv-upload>
            {busy === "upload" ? "Uploading…" : "Upload the file you sent"}
          </button>{" "}
          to keep it with this application.
          {fileInput(false)}
        </p>
      ) : (
        <div
          className={`dropZone sentCvDrop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            if (!busy) setDragging(true);
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
            if (busy) return;
            const file = e.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
        >
          {fileInput(true)}
          <div className="dropInner">
            {busy === "upload" ? (
              <>
                <span className="dropSpinner" aria-hidden="true" />
                <span className="dropTitle">Uploading your CV…</span>
                <span className="dropHint">Reading its text and storing it privately.</span>
              </>
            ) : (
              <>
                <span className="dropTitle">
                  <button type="button" className="dropBrowse" onClick={pick} data-sent-cv-upload>
                    Upload the CV you sent
                  </button>
                  <span className="dropOr"> or drag it here</span>
                </span>
                <span className="dropHint">
                  The file you sent {company ? `to ${company}` : "for this application"}: PDF, Word (.docx) or .txt, up to 4MB.
                  Kept privately with this application.
                </span>
              </>
            )}
          </div>
        </div>
      )}
      {error && <StatusText role="alert" className="uploadError">{error}</StatusText>}
    </div>
  );
}
