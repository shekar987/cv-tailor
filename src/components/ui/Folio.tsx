// A folio: the two-digit numeral the dossier's sections are filed under —
// section labels on the landing, the page head, Customize's index, the
// interview rounds. Decorative numbering, so it is hidden from assistive
// technology; the heading beside it carries the meaning.
export function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

export default function Folio({ n, className }: { n: number | string; className?: string }) {
  return (
    <span className={["folio", className].filter(Boolean).join(" ")} aria-hidden="true">
      {pad2(n)}
    </span>
  );
}
