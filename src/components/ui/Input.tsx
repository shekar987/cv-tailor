// Wraps the bare-<input> styling classes: new .textInput (default), and the
// existing .authInput / .keyInput used on the auth and settings pages.

type InputVariant = "default" | "auth" | "key";

const VARIANT_CLASS: Record<InputVariant, string> = {
  default: "textInput",
  auth: "authInput",
  key: "keyInput",
};

export type InputProps = {
  variant?: InputVariant;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export default function Input({ variant = "default", className, ...rest }: InputProps) {
  const cls = [VARIANT_CLASS[variant], className ?? ""].filter(Boolean).join(" ");
  return <input className={cls} {...rest} />;
}
