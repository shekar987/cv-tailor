// Wraps the bare `textarea{}` tag rule — "default" adds no className at all
// (the tag rule already applies to every <textarea>). "feedback" is a
// reserved hook for FeedbackWidget's textarea if it ever needs its own skin;
// not required today, included for symmetry with the other variant props.

type TextareaVariant = "default" | "feedback";

export type TextareaProps = {
  variant?: TextareaVariant;
  className?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function Textarea({ variant: _variant = "default", className, ...rest }: TextareaProps) {
  return <textarea className={className} {...rest} />;
}
