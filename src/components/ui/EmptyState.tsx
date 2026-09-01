// A centred empty state: optional icon, a title, a short explanation and the
// one or two actions that get the user out of it. Used inside a Card.

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
};

export default function EmptyState({ icon, title, children, actions }: EmptyStateProps) {
  return (
    <div className="emptyState">
      {icon && <div className="emptyStateIcon" aria-hidden="true">{icon}</div>}
      <p className="emptyStateTitle">{title}</p>
      {children && <div className="emptyStateBody">{children}</div>}
      {actions && <div className="emptyStateActions">{actions}</div>}
    </div>
  );
}
