// Wraps .error / .savedMsg. `as` defaults to "p" but every existing <span>
// call site passes as="span" to keep the same element. `role` (some sites
// have role="alert"/"status", some don't today) flows through ...rest
// unchanged — this preserves that inconsistency rather than silently
// "fixing" it, since that's a behavior change outside this refactor's scope.

type Tone = "error" | "success";

const TONE_CLASS: Record<Tone, string> = {
  error: "error",
  success: "savedMsg",
};

export type StatusTextProps = {
  tone?: Tone;
  as?: "p" | "span";
  className?: string;
} & React.HTMLAttributes<HTMLParagraphElement | HTMLSpanElement>;

export default function StatusText({ tone = "error", as = "p", className, ...rest }: StatusTextProps) {
  const cls = [TONE_CLASS[tone], className ?? ""].filter(Boolean).join(" ");
  const Tag = as;
  return <Tag className={cls} {...rest} />;
}
