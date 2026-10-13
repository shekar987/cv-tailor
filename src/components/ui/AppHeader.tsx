"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearAllWorkspaces } from "@/lib/workspace";
import { clearAllPrepProgress } from "@/lib/prepProgress";
import { clearAllGameCounts } from "@/lib/games/pick";
import Wordmark from "./Wordmark";

// The one header for every signed-in page. Previously each page hand-wrote
// its own bar and they drifted: Sign out existed only on /app, Applications
// was linked only from /app, and three pages had no <h1>.
//
// The nav renders immediately — these pages sit behind the auth middleware,
// so there is always a session — and only the account chip waits for it.
// That removes the bar popping in after load, and keeps Sign out reachable
// for an account whose provider released no email address (the chip then
// shows no initial but still opens).
//
// Four sections in the bar; the account's initial opens a small menu with
// Settings and Sign out, so a destructive action never sits as a sibling of
// Tailor and Applications. At phone width the whole list, Settings and Sign
// out included, sits behind one Menu button. Under the bar, the page's title
// and tagline sit on the dossier's left rule.

const NAV = [
  { href: "/app", label: "Tailor" },
  { href: "/applications", label: "Applications" },
  { href: "/interviews", label: "Interview" },
  { href: "/customize", label: "Customize" },
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
  // At phone width the links become a menu behind one button (CSS hides the
  // list until `open`); a link click, Escape or Sign out closes it, and
  // Escape puts focus back on the button so a keyboard user is not stranded.
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  // The account menu: the same discipline, on the initial chip.
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountBtnRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!accountOpen) return;
    function onDown(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAccountOpen(false);
        accountBtnRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    // Don't leave any tailored CV in this browser's storage after sign-out —
    // this account's or a previous one's.
    clearAllWorkspaces();
    clearAllPrepProgress();
    clearAllGameCounts();
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    setOpen(false);
    setAccountOpen(false);
    router.refresh();
    router.push("/auth/login");
  }

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const signOutLabel = signingOut ? "Signing out…" : "Sign out";

  return (
    <header className="appHeader">
      <div className="appBarSticky">
        <div
          className="appBar"
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.preventDefault();
              closeMenu(true);
            }
          }}
        >
          <Wordmark href="/app" className="wordmark" />
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
          <nav id="appBarNav" className={"appBarActions" + (open ? " open" : "")} aria-label="Main">
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
            {/* On a phone the whole list is the menu; on a desktop these two live under the account chip. */}
            <Link href="/settings" className="customizeLink appBarPhoneOnly" aria-current={isCurrent("/settings") ? "page" : undefined} onClick={() => closeMenu()}>
              Settings
            </Link>
            <button type="button" onClick={handleSignOut} className="customizeLink appBarPhoneOnly" disabled={signingOut}>
              {signOutLabel}
            </button>
            <div className="appBarAccount" ref={accountRef}>
              <button
                ref={accountBtnRef}
                type="button"
                className="appBarInitial"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-label={email ? `Account menu, signed in as ${email}` : "Account menu"}
                title={email ?? undefined}
                onClick={() => setAccountOpen((v) => !v)}
                data-account-menu
              >
                {email ? email[0].toUpperCase() : "·"}
              </button>
              {accountOpen && (
                <div className="appBarMenu" role="menu">
                  {email && <span className="appBarMenuEmail" title={email}>{email}</span>}
                  <Link href="/settings" className="dlItem" role="menuitem" aria-current={isCurrent("/settings") ? "page" : undefined} onClick={() => setAccountOpen(false)}>
                    Settings
                  </Link>
                  <button type="button" className="dlItem" role="menuitem" onClick={handleSignOut} disabled={signingOut}>
                    {signOutLabel}
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </div>
      {(title || tagline) && (
        <div className="pageHead">
          {title && <h1 className="pageTitle">{title}</h1>}
          {tagline && <p className="tagline">{tagline}</p>}
        </div>
      )}
    </header>
  );
}
