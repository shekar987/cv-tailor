// Wraps .inputCard / .gateCard. Only the 10 .inputCard sites are required
// migration targets — .scoreCard, .authCard, .feedbackWidget, .block each
// appear once and stay bespoke rather than being forced through this API.

type CardVariant = "default" | "dashed";

export type CardProps = {
  variant?: CardVariant;
  className?: string;
} & React.HTMLAttributes<HTMLElement>;

export default function Card({ variant = "default", className, ...rest }: CardProps) {
  const cls = [variant === "dashed" ? "gateCard" : "inputCard", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <section className={cls} {...rest} />;
}
