"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearAllWorkspaces } from "@/lib/workspace";
import { clearAllPrepProgress } from "@/lib/prepProgress";

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
  { href: "/interviews", label: "Interview" },
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
  // At phone width the five pills become a menu behind one button (CSS hides
  // the list until `open`); a link click, Escape or Sign out closes it, and
  // Escape puts focus back on the button so a keyboard user is not stranded.
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  function closeMenu(refocus = false) {
    setOpen(false);
    if (refocus) menuBtnRef.current?.focus();
  }

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
    clearAllPrepProgress();
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    setOpen(false);
    router.refresh();
    router.push("/auth/login");
  }

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="appHeader">
      <div className="appBarSticky">
        <div className="appBar">
          <Link href="/app" className="wordmark">Jobhuntz</Link>
          <button
            ref={menuBtnRef}
            type="button"
            className="customizeLink appBarMenuBtn"
            aria-expanded={open}
            aria-controls="appBarNav"
            onClick={() => setOpen((v) => !v)}
            data-app-menu
          >
            {open ? "Close" : "Menu"}
          </button>
          <nav
            id="appBarNav"
            className={"appBarActions" + (open ? " open" : "")}
            aria-label="Main"
            onKeyDown={(e) => {
              if (e.key === "Escape" && open) {
                e.preventDefault();
                closeMenu(true);
              }
            }}
          >
            {email && <span className="appBarEmail" title={email}>{email}</span>}
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="customizeLink"
                aria-current={isCurrent(item.href) ? "page" : undefined}
                onClick={() => closeMenu()}
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
