"use client";

// "Move to Closed" (4 Nov 2026, Chunk 15): the reason, the date and an optional lesson. This
// is the only thing in the app that sends confirmed_by_user: a row that reached screening
// leaves on the user's word, given here, or not at all. Used by the tracker and What's next.
import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { trapFocusIndex } from "@/lib/confirm";
import { CLOSE_REASONS, CLOSE_REASON_LABELS, LESSON_PLACEHOLDER, MAX_LESSON_CHARS, closedAtFromDate, isEnding, statusForReason, type CloseReason } from "@/lib/closing";
import type { Status } from "@/lib/tracker";

export type CloseChoice = { status: Status; close_reason: CloseReason; closed_at: string; lesson: string | null };

/** What goes in the PUT. The one place this flag is set. */
export function closeBody(choice: CloseChoice) {
  return { ...choice, confirmed_by_user: true as const };
}

/** Undo of a close that replaced an earlier close: going back to an ending is the user's word too. */
export function undoCloseFlag(previousStatus: unknown) {
  return isEnding(previousStatus) ? { confirmed_by_user: true as const } : {};
}

export default function MoveToClosedDialog({
  company, reason, date, lesson, busy = false, error = "", onCancel, onSubmit,
}: {
  company: string;
  reason: CloseReason;
  /** YYYY-MM-DD: the date a sweep reported, else today. */
  date: string;
  lesson?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (choice: CloseChoice) => void;
}) {
  const [picked, setPicked] = useState<CloseReason>(reason);
  const [day, setDay] = useState(date);
  const [note, setNote] = useState(lesson ?? "");
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const closedAt = closedAtFromDate(day);
  // A close is something that has happened.
  const usable = !!closedAt && day <= today;

  // Focus in, back to what opened it on close; the page behind keeps still.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    first.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const controls = [...(box.current?.querySelectorAll<HTMLElement>("select, input, button:not([disabled])") ?? [])];
    const at = trapFocusIndex(controls.indexOf(document.activeElement as HTMLElement), controls.length, e.shiftKey);
    if (at >= 0) {
      e.preventDefault();
      controls[at]?.focus();
    }
  }

  return (
    <div className="confirmDialog">
      <div className="confirmDialog__backdrop" onClick={() => { if (!busy) onCancel(); }} aria-hidden="true" />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} className="confirmDialog__panel" onKeyDown={onKey} data-close-dialog>
        <h2 id={titleId} className="confirmDialog__title">Move {company} to Closed</h2>
        <form
          className="closeDialogForm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!usable || !closedAt || busy) return;
            onSubmit({ status: statusForReason(picked), close_reason: picked, closed_at: closedAt, lesson: note.trim() || null });
          }}
        >
          <label className="closeDialogField">
            <span className="label">Reason</span>
            <select ref={first} className="textInput" value={picked} onChange={(e) => setPicked(e.target.value as CloseReason)} data-close-reason>
              {CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABELS[r]}</option>)}
            </select>
          </label>
          <label className="closeDialogField">
            <span className="label">Date</span>
            <input type="date" className="textInput" value={day} max={today} onChange={(e) => setDay(e.target.value)} required data-close-date />
          </label>
          <label className="closeDialogField">
            <span className="label">Lesson (optional)</span>
            <input type="text" className="textInput" value={note} maxLength={MAX_LESSON_CHARS} placeholder={LESSON_PLACEHOLDER} onChange={(e) => setNote(e.target.value)} data-close-lesson />
          </label>
          {error && <p className="statusText" role="alert" data-close-error>{error}</p>}
          <div className="confirmDialog__actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel} data-close-cancel>Cancel</Button>
            <Button type="submit" disabled={busy || !usable} data-close-submit>{busy ? "Moving…" : "Move to Closed"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
