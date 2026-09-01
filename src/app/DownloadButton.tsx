"use client";

import { useState, useRef, useEffect, useId } from "react";
import Button from "@/components/ui/Button";

// Single "Download ▾" control with a PDF / Word choice — replaces the two
// separate buttons. Closes on outside-click or Escape (returning focus to the
// trigger). Plain buttons in a disclosure, not an ARIA menu: the menu pattern
// promises arrow-key navigation this doesn't implement.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
      <Button
        ref={triggerRef}
        type="button"
        className="dlBtn"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {busy ? "Generating…" : "Download"}
        <span className="dlCaret" aria-hidden="true">▾</span>
      </Button>
      {open && (
        <div className="dlMenu" id={panelId}>
          <button type="button" className="dlItem" onClick={() => pick(onPdf)}>
            PDF document
          </button>
          <button type="button" className="dlItem" onClick={() => pick(onWord)}>
            Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}
