// An icon beside a card's label. Replaces the bare `<div className="label">`
// on the cards that stay open, so an always-open card and a collapsible one
// read as the same kind of thing.

import Icon, { type IconName } from "./Icon";
import type { ReactNode } from "react";

export type SectionHeadingProps = { icon: IconName; children: ReactNode; className?: string };

export default function SectionHeading({ icon, children, className }: SectionHeadingProps) {
  return (
    <div className={["sectionHead", className].filter(Boolean).join(" ")}>
      <Icon name={icon} />
      <span className="label">{children}</span>
    </div>
  );
}
