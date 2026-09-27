// Wraps the bare `textarea{}` tag rule — the tag rule already applies to every
// <textarea>, so this component exists so call sites read like the other ui/
// wrappers. It carries no variants: the one it used to declare was never read.

export type TextareaProps = { className?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={className} {...rest} />;
}
