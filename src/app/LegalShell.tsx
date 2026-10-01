import Link from "next/link";

// The frame the two legal pages share: wordmark home, title, the date, the
// text, and a footer with the other legal page. Server component; the text
// is static. Anything a lawyer or the owner has to decide is written in the
// page as a visible "TODO(owner)" line rather than guessed.
export default function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page legalPage">
      <div className="container">
        <header className="legalHead">
          <Link href="/" className="authWordmark authWordmarkLink">Jobhuntz</Link>
          <h1 className="pageTitle">{title}</h1>
          <p className="tagline">Last updated {updated}. Plain English, on purpose.</p>
        </header>
        <article className="legalBody inputCard">{children}</article>
        <footer className="lpFooter legalFoot">
          <span>Built by Soma Shekar Keesari</span>
          <nav className="lpFooterLinks" aria-label="Legal">
            <Link href="/privacy">Privacy notice</Link>
            <Link href="/terms">Terms of use</Link>
            <Link href="/">Home</Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}

// A decision only the owner can make, shown in the page until it is made so
// nothing here claims what has not been decided.
export function OwnerTodo({ children }: { children: React.ReactNode }) {
  return (
    <p className="legalTodo" data-owner-todo>
      <strong>TODO(owner):</strong> {children}
    </p>
  );
}
