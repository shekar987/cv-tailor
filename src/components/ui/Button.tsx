import Link from "next/link";
import { forwardRef } from "react";

// Wraps the existing .cta / .cta.secondary / .cta.ghost classes — no new
// styling here, just one place instead of 22+ hand-typed call sites. Every
// prop not listed below (onClick, disabled, type, data-*, aria-*, ...) is
// spread onto the real <button>/<Link> last, so it reaches the DOM unchanged.
// The ref (when rendering a <button>) is forwarded so callers can restore
// focus to it — the download disclosure does this on Escape.

type Variant = "primary" | "secondary" | "ghost";

type ButtonOwnProps = {
  variant?: Variant;
  // Full-width modifier. Emits `ctaBlock`, not `block`: a bare `block` class
  // collided with an old card rule and turned the login button charcoal.
  block?: boolean;
  className?: string;
};

function variantClass(variant: Variant, block?: boolean, className?: string) {
  return [
    "cta",
    variant !== "primary" ? variant : "",
    block ? "ctaBlock" : "",
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

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { variant = "primary", block, className } = props;
  const cls = variantClass(variant, block, className);

  if (props.href !== undefined) {
    const { variant: _v, block: _b, className: _c, ...linkRest } = props as ButtonAsLink;
    void _v; void _b; void _c;
    return <Link className={cls} {...linkRest} />;
  }

  const { variant: _v, block: _b, className: _c, href: _h, ...buttonRest } = props as ButtonAsButton;
  void _v; void _b; void _c; void _h;
  return <button ref={ref} className={cls} {...buttonRest} />;
});

export default Button;
