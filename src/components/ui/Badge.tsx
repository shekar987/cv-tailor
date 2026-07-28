// Wraps three structurally different small status indicators: an inline ATS
// hit/miss/rec marker (.dot), a "saved" pill (.savedBadge), and the
// pre-check score number (.gateValue). Kept in one file for discoverability,
// not because they're visually interchangeable — they aren't.

type BadgeVariant = "dot" | "pill" | "value";
type BadgeTone = "hit" | "miss" | "rec" | "success" | "neutral";

export type BadgeProps = {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  className?: string;
} & React.HTMLAttributes<HTMLElement>;

export default function Badge({ variant = "dot", tone = "neutral", className, ...rest }: BadgeProps) {
  if (variant === "pill") {
    const cls = ["savedBadge", className ?? ""].filter(Boolean).join(" ");
    return <span className={cls} {...rest} />;
  }
  if (variant === "value") {
    const cls = ["gateValue", tone === "success" ? "good" : "low", className ?? ""]
      .filter(Boolean)
      .join(" ");
    return <div className={cls} {...rest} />;
  }
  const cls = ["dot", tone, className ?? ""].filter(Boolean).join(" ");
  return <span className={cls} {...rest} />;
}
