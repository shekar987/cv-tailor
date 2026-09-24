// A card whose header is a disclosure button, with a one-line summary of what
// is inside so the state is legible while collapsed.
//
// WHY: /customize was nine identical always-open cards, ~3,900px tall — a
// setting you touch once looked exactly as important as your master CV, and a
// new user had to read the whole page before doing anything. The settings that
// matter once now collapse, and their summary line carries the state ("2 years
// · 8 unanswered") so nothing is hidden, only folded.
//
// Open state is OWNED BY THE PARENT so the section nav can open a section and
// scroll to it in one click.
//
// The body is hidden with the `hidden` attribute rather than unmounted: these
// sections hold unsaved drafts (an eligibility field, a pool textarea), and
// collapsing a section must never throw away what the user typed.

import Icon, { type IconName } from "./Icon";
import type { ReactNode } from "react";

export type SectionTone = "neutral" | "ok" | "warn";

export type CollapsibleSectionProps = {
  id: string;
  icon: IconName;
  title: string;
  /** One line describing the current state, shown whether open or closed. */
  summary?: ReactNode;
  tone?: SectionTone;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
};

export default function CollapsibleSection({
  id,
  icon,
  title,
  summary,
  tone = "neutral",
  open,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const bodyId = `${id}-body`;
  return (
    <section className="inputCard cstSection" id={id} data-open={open ? "" : undefined}>
      <button
        type="button"
        className="cstSectionHead"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(id)}
      >
        <Icon name={icon} />
        <span className="cstSectionTitle">{title}</span>
        {summary && (
          <span className="cstSectionSummary" data-tone={tone}>
            {summary}
          </span>
        )}
        <svg
          className="cstChevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="cstSectionBody" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
