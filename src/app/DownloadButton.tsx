"use client";

import { useState, useRef, useEffect } from "react";

// Single "Download ▾" control with a PDF / Word menu — replaces the two separate
// buttons. Closes on outside-click or Escape; keyboard and ARIA friendly.
export default function DownloadButton({
  onPdf,
  onWord,
  busy = false,
}: {
  onPdf: () => void;
  onWord: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div className="dlWrap" ref={wrapRef}>
      <button
        type="button"
        className="cta dlBtn"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? "Generating…" : "Download"}
        <span className="dlCaret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="dlMenu" role="menu">
          <button type="button" role="menuitem" className="dlItem" onClick={() => pick(onPdf)}>
            PDF document
          </button>
          <button type="button" role="menuitem" className="dlItem" onClick={() => pick(onWord)}>
            Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}
