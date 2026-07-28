import Link from "next/link";

// Wraps the existing .cta / .cta.secondary / .cta.ghost classes — no new
// styling here, just one place instead of 22+ hand-typed call sites. Every
// prop not listed below (onClick, disabled, type, data-*, aria-*, ...) is
// spread onto the real <button>/<Link> last, so it reaches the DOM unchanged.

type Variant = "primary" | "secondary" | "ghost";

type ButtonOwnProps = {
  variant?: Variant;
  block?: boolean;
  className?: string;
};

function variantClass(variant: Variant, block?: boolean, className?: string) {
  return [
    "cta",
    variant !== "primary" ? variant : "",
    block ? "block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

type ButtonAsButton = ButtonOwnProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    href?: undefined;
  };

type ButtonAsLink = ButtonOwnProps &
  Omit<React.ComponentProps<typeof Link>, "className">;

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export default function Button(props: ButtonProps) {
  const { variant = "primary", block, className } = props;
  const cls = variantClass(variant, block, className);

  if (props.href !== undefined) {
    const { variant: _v, block: _b, className: _c, ...linkRest } = props as ButtonAsLink;
    return <Link className={cls} {...linkRest} />;
  }

  const { variant: _v, block: _b, className: _c, href: _h, ...buttonRest } = props as ButtonAsButton;
  return <button className={cls} {...buttonRest} />;
}
