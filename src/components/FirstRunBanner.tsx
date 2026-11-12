"use client";

// "Start here: upload your CV" (12 Nov 2026, Chunk 24) on every signed-in page
// that has no first-run state of its own (Actions, Applications, Interviews,
// Settings, prep and interview pages), for an account with no master CV.
// Tailor, What's next and Customise draw their own (lib/firstRun).
//
// One count query (master_cvs, RLS: the caller's own row), never the CV's
// text. A failed read shows nothing: asking for a CV the user has saved would
// be worse than not asking. Once a CV is found it is remembered for this tab,
// so moving between pages costs nothing.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

const HAS_CV_KEY = "cvtailor:has-cv:";

/** After the CV is replaced or deleted: the next page asks the database again. */
export function forgetSavedCv(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    window.sessionStorage.removeItem(HAS_CV_KEY + userId);
  } catch {
    // Storage blocked: nothing was remembered.
  }
}

// Pages that show the first step themselves, or are where it is taken.
export function bannerIsOwnedByPage(pathname: string): boolean {
  return pathname === "/app" || pathname === "/app/next" || pathname === "/customize" || pathname.startsWith("/customize/");
}

export default function FirstRunBanner() {
  const pathname = usePathname() ?? "";
  const [noCv, setNoCv] = useState(false);
  const skip = bannerIsOwnedByPage(pathname);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        try {
          if (window.sessionStorage.getItem(HAS_CV_KEY + uid) === "1") return;
        } catch {
          // Storage blocked: ask the database.
        }
        const { count, error } = await supabase.from("master_cvs").select("user_id", { count: "exact", head: true }).neq("text", "");
        if (cancelled || error) return;
        if ((count ?? 0) > 0) {
          try {
            window.sessionStorage.setItem(HAS_CV_KEY + uid, "1");
          } catch {
            // Asked again next page.
          }
          return;
        }
        setNoCv(true);
      } catch {
        // Nothing shown.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skip]);

  if (skip || !noCv) return null;
  return <FirstRunBannerView />;
}

/** The banner itself, for a page that already knows the account has no CV (What's next). */
export function FirstRunBannerView() {
  return (
    <div className="limitNotice firstRunBanner" role="status" data-first-run-banner>
      <div className="limitNotice__title">Start here: upload your CV</div>
      <div className="limitNotice__body">
        Everything here is built from your master CV, and nothing goes in that it doesn&apos;t say. Add it once on Customise.
      </div>
      <div className="limitNotice__cta">
        <Button href="/customize#master-cv" data-first-run-cv>Upload your CV</Button>
      </div>
    </div>
  );
}
