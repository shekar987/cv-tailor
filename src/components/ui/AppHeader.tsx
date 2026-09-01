"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearAllWorkspaces } from "@/lib/workspace";

// The one header for every signed-in page. Previously each page hand-wrote
// its own bar and they drifted: Sign out existed only on /app, Applications
// was linked only from /app, and three pages had no <h1>.
//
// The nav renders immediately — these pages sit behind the auth middleware,
// so there is always a session — and only the email chip waits for it. That
// removes the bar popping in after load, and keeps Sign out reachable for an
// account whose provider released no email address.

const NAV = [
  { href: "/app", label: "Tailor" },
  { href: "/applications", label: "Applications" },
  { href: "/customize", label: "Customize" },
  { href: "/settings", label: "Settings" },
];

export default function AppHeader({
  title,
  tagline,
}: {
  title?: string;
  tagline?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    // Don't leave any tailored CV in this browser's storage after sign-out —
    // this account's or a previous one's.
    clearAllWorkspaces();
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.refresh();
    router.push("/auth/login");
  }

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="appHeader">
      <div className="appBarSticky">
        <div className="appBar">
          <Link href="/app" className="wordmark">Jobhuntz</Link>
          <nav className="appBarActions" aria-label="Account">
            {email && <span className="appBarEmail" title={email}>{email}</span>}
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="customizeLink"
                aria-current={isCurrent(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
            <button type="button" onClick={handleSignOut} className="customizeLink" disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </nav>
        </div>
      </div>
      {title && <h1 className="pageTitle">{title}</h1>}
      {tagline && <p className="tagline">{tagline}</p>}
    </header>
  );
}
