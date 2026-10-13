// A folio (or an icon) beside a card's label. Replaces the bare
// `<div className="label">` on the cards that stay open, so an always-open
// card and a collapsible one read as the same kind of thing. With `folio`
// the section is filed under its two-digit number; with `icon` alone it
// keeps the line icon.

import Icon, { type IconName } from "./Icon";
import Folio from "./Folio";
import type { ReactNode } from "react";

export type SectionHeadingProps = {
  icon?: IconName;
  folio?: number | string;
  children: ReactNode;
  className?: string;
};

export default function SectionHeading({ icon, folio, children, className }: SectionHeadingProps) {
  return (
    <div className={["sectionHead", className].filter(Boolean).join(" ")}>
      {folio !== undefined ? <Folio n={folio} /> : icon ? <Icon name={icon} /> : null}
      <span className="label">{children}</span>
    </div>
  );
}
