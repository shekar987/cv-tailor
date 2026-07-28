// Wraps a .label (+ optional .cvHelp) pair. `htmlFor` decides the label
// element: present -> a real <label> for a paired control (e.g. the JD or
// master-CV textarea); absent -> a heading-style <div> (e.g. "Master CV" on
// /app, which has no single paired control). Always rendering <label> would
// attach it to nothing in the second case — an accessibility regression, not
// a neutral refactor — so the distinction in the current markup is kept.

export type FormFieldProps = {
  label: React.ReactNode;
  htmlFor?: string;
  help?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

export default function FormField({ label, htmlFor, help, extra, className, children }: FormFieldProps) {
  return (
    <div className={className}>
      {htmlFor ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {extra}
        </label>
      ) : (
        <div className="label">
          {label}
          {extra}
        </div>
      )}
      {help && <p className="cvHelp">{help}</p>}
      {children}
    </div>
  );
}
