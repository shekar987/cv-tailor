"use client";
// "Today (n)" on /applications (14 Nov 2026, Chunk 27; lib/todaySection): one section that
// holds the red "Do these today" strip and the attention cards. Its header is the
// disclosure (<h2><button>), folded on a phone and open on a wider screen until the user
// chooses. Folded, it still says how many things there are and which is due soonest, and
// it keeps the warning icon and colour when the 48-hour list holds anything.
//
// The body is hidden, never unmounted, so a card's pressed state and the strip's busy
// button survive a fold. It imports nothing but React (the page hands it the warning icon), so a
// test can render it under node:test.
import type { ReactNode } from "react";

export default function TodaySection({
  count, loading = false, urgent = false, icon, hint, open, onToggle, children,
}: {
  /** lib/todaySection todayCount. */
  count: number;
  /** The full list is still on its way: the number is not known yet, so none is shown. */
  loading?: boolean;
  /** The 48-hour list holds something. */
  urgent?: boolean;
  /** The warning icon, drawn only when urgent: red is never the only sign. */
  icon?: ReactNode;
  /** lib/todaySection todayHint: shown only while folded. */
  hint: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="todayFold" data-today={open ? "open" : "closed"} data-today-count={loading ? undefined : count} data-tone={urgent ? "red" : undefined}>
      <h2 className="todayFold__heading">
        <button type="button" className="todayFold__head" aria-expanded={open} aria-controls="todayBody" onClick={onToggle} data-today-toggle>
          {urgent && icon}
          <span className="todayFold__title">Today</span>
          <span className="todayFold__count" aria-label={loading ? "Counting" : `${count} to do`}>{loading ? "…" : count}</span>
          <span className="todayFold__action">{open ? "Hide" : "Show"}</span>
        </button>
      </h2>
      {!open && <p className="todayFold__hint" data-today-hint>{loading ? "Loading what is due…" : hint}</p>}
      <div className="todayFold__body" id="todayBody" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
