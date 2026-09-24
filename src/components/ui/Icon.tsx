// One line-icon set for the signed-in app.
//
// WHY: the app was text-in-boxes — customize and settings carried zero icons
// across nine and three cards, so every section header looked identical and
// nothing anchored the eye. These are deliberately plain: 24px grid, stroke
// only, currentColor, no fills, so they inherit the label's colour and never
// become decoration competing with the one amber accent.
//
// Sized by the `--icon-size` custom property (default 1em), so a heading sets
// the size once in CSS rather than each caller passing numbers.

import type { ReactNode } from "react";

export type IconName =
  | "document"
  | "user"
  | "shield"
  | "verified"
  | "target"
  | "list"
  | "globe"
  | "sliders"
  | "search"
  | "key"
  | "gauge"
  | "building"
  | "clipboard"
  | "mail";

const PATHS: Record<IconName, ReactNode> = {
  document: (
    <>
      <path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  verified: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1.25" />
    </>
  ),
  list: (
    <>
      <path d="M8 7h12M8 12h12M8 17h8" />
      <circle cx="4.5" cy="7" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="17" r="1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 8h10M18 8h2" />
      <path d="M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.9 12.1L20 3" />
      <path d="M17 6l2 2" />
      <path d="M14.5 8.5l2 2" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a9 9 0 1 1 16 0" />
      <path d="M12 14l4.5-4.5" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
      <path d="M15 9h3a2 2 0 0 1 2 2v10" />
      <path d="M2 21h20" />
      <path d="M8 7h3M8 11h3M8 15h3" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.6 7.2l8.4 5.9 8.4-5.9" />
    </>
  ),
};

export type IconProps = { name: IconName; className?: string };

export default function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={["icon", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
