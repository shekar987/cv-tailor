// Wraps .inputCard / .gateCard / .ruledCard. A box (.inputCard) means "this
// is the product" — the fields' cards, the paper CV, the score. Settings-like
// content that is read, not worked in, sits in a ruled section instead: no
// box, one hairline across the top. The 10 original .inputCard sites were the
// migration targets — .scoreCard, .authCard, .feedbackWidget each appear once
// and stay bespoke rather than being forced through this API.

type CardVariant = "default" | "dashed" | "ruled";

export type CardProps = {
  variant?: CardVariant;
  className?: string;
} & React.HTMLAttributes<HTMLElement>;

const CLASS: Record<CardVariant, string> = {
  default: "inputCard",
  dashed: "gateCard",
  ruled: "ruledCard",
};

export default function Card({ variant = "default", className, ...rest }: CardProps) {
  const cls = [CLASS[variant], className ?? ""].filter(Boolean).join(" ");
  return <section className={cls} {...rest} />;
}
