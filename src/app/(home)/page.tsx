"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image, { type StaticImageData } from "next/image";
import Button from "@/components/ui/Button";
import Wordmark from "@/components/ui/Wordmark";
import Folio from "@/components/ui/Folio";
import HeroCanvas from "./HeroCanvas";
// Real screenshots of the product from a test account (Alex Tester, Northwind
// Labs and every company in them are made up), captured by the design-loop
// harness (scratchpad/design-loop/recapture.mjs): one 600×400 frame each, a
// single detail at 1× set on the surface tone, 2× density. Re-capture after
// a redesign.
import shotPrecheck from "../../../public/landing/precheck.jpg";
import shotScore from "../../../public/landing/score.jpg";
import shotPrep from "../../../public/landing/prep.jpg";
import shotInterview from "../../../public/landing/interview.jpg";
import { createClient } from "@/lib/supabase/client";

// ─── Scroll-reveal: progressive enhancement ─────────────────────────────────
// Fires once per element via IntersectionObserver, then disconnects. The
// hidden state is scoped under `.js-ready` (added on mount, globals.css), so
// without JavaScript — or before hydration — everything is visible, and
// prefers-reduced-motion shows everything at once. This only adds polish,
// it never gates content. Threshold 0 with a small bottom margin: a section
// taller than the viewport (the journey) could never reach 15% visible.
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px 0px -10% 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView } as const;
}

function Reveal({
  as = "div",
  children,
  className = "",
  id,
}: {
  as?: "section" | "div";
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const cls = `reveal${inView ? " reveal--visible" : ""}${className ? " " + className : ""}`;
  if (as === "section") {
    return <section ref={ref} id={id} className={cls}>{children}</section>;
  }
  return <div ref={ref} id={id} className={cls}>{children}</div>;
}

// A section's label: its folio (two-digit numeral on the dossier's rule)
// and its name.
function Kicker({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <span className="lpKicker">
      <Folio n={n} />
      {children}
    </span>
  );
}


// The journey: four rows on one rhythm — a numeral, a one-line claim, one
// sentence or two, and ONE real detail of that screen at 1:1 (480×280, no
// scaling; captured by the harness's recapture.mjs from a test account).
// The interviewer is not pictured: the room is the product, and the round
// picker says what it is without a face standing in for it.
const JOURNEY: { n: number; title: string; body: string; img: StaticImageData; alt: string }[] = [
  {
    n: 1,
    title: "A free pre-check before any credit is spent.",
    body: "Paste a posting. Its eligibility conditions are read against your own answers, your keyword match is counted, and the tracker says whether you have applied to this company before.",
    img: shotPrecheck,
    alt: "The pre-check: a notice that you have already applied to this company three times, then the read \"Apply\" and a rough keyword match of 6/10.",
  },
  {
    n: 2,
    title: "A tailored CV, and a score that is a count.",
    body: "Summary, skills, experience and projects are selected from your own bullets; titles, employers and dates are never touched. The score is how many of the role's terms the text carries — 6 of 10 reads \"Borderline\", never \"strong\".",
    img: shotScore,
    alt: "Recruiter search visibility: 6/10, \"Borderline. Fix these before sending.\", required skills 3 of 4, then the matched list.",
  },
  {
    n: 3,
    title: "Interview answers traced, line by line, to your CV.",
    body: "A prep pack for the job: the questions it will ask, STAR answers built only from your CV, and every line marked as traced to your CV or flagged for you to rephrase.",
    img: shotPrep,
    alt: "One prep question with its STAR answer — situation, task, action, result — and under it the CV line it was traced to, ticked.",
  },
  {
    n: 4,
    title: "Then a UK interview, out loud.",
    body: "Pick the round — screening, competency, strengths-based, technical, hiring manager, final — and an interviewer built from the same job asks the questions aloud and checks each answer against your CV. In your browser; no video, no upload.",
    img: shotInterview,
    alt: "The round picker: a screening call with a talent acquisition partner, and the competency interview selected, with its length and question count.",
  },
];

export default function Landing() {
  // The scroll-reveal hides content ONLY once JS is running: the `.reveal`
  // hidden state is scoped under `.js-ready` (see globals.css), so the
  // server-rendered page is fully visible until hydration has actually
  // happened — slow networks, failed hydration and crawlers all see it all.
  // Adaptive nav: someone already signed in doesn't need "Sign in" — they need
  // the app. Fail-soft: any error keeps the signed-out pair.
  const [signedIn, setSignedIn] = useState(false);
  // Settings sends the user here with ?deleted=1 after an account deletion.
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("js-ready");
    // After paint, never during the effect: the server rendered no notice
    // (it cannot see the query), so the state flips in a frame callback.
    const frame = requestAnimationFrame(() => {
      if (new URLSearchParams(window.location.search).get("deleted") === "1") {
        setDeleted(true);
        window.history.replaceState(null, "", "/");
      }
    });
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) setSignedIn(true);
      })
      .catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="lpShell">
      <div className="lp">
        {deleted && (
          <div className="limitNotice" role="status" data-account-deleted>
            Your account and everything in it have been deleted. Thank you for trying Jobhuntz.
          </div>
        )}

        <nav className="lpNav">
          <Wordmark href="/" className="wordmark lpWordmark" />
          <div className="lpNavActions">
            {signedIn ? (
              <Link href="/app" className="customizeLink">Open the app →</Link>
            ) : (
              <>
                <Link href="/auth/login" className="lpNavLink">Sign in</Link>
                <Link href="/app" className="customizeLink">Open the tool</Link>
              </>
            )}
          </div>
        </nav>

        {/* ── Hero — the lamp, and the product's own output beside the promise.
            No scroll-reveal here, it's above the fold on load. The worked
            example is hand-built with its own scoped classes (never
            CvPreview), static, and says so. ──────────────────────────────── */}
        <section className="lpHero">
          <HeroCanvas />
          <div className="lpHeroText">
            <h1 className="lpTitle">
              Honest CVs.<br />
              Real interview practice.
            </h1>
            <p className="lpSub">
              Paste your CV and a job description. Every claim in what comes back is checked
              against your CV before you see it. Then an interviewer built from the same job
              asks you the questions out loud, UK round by UK round.
            </p>
            <div className="lpHeroCta">
              <Button href="/app">Tailor my CV →</Button>
              <a href="#journey" className="cta secondary">See the journey ↓</a>
            </div>
          </div>
          <div className="lpExample" id="example">
            <div className="lpShowCv" aria-label="A worked example of a tailored CV">
              <div className="lpCvName">JORDAN REYES</div>
              <div className="lpCvContact">London · jordan@email.com · linkedin.com/in/jordanreyes</div>
              <div className="lpCvHead">Experience</div>
              <div className="lpCvJob">
                <span>Senior Backend Engineer, Northwind Systems</span>
                <span className="lpCvDate">2022 — Present</span>
              </div>
              <ul className="lpCvBullets">
                <li>Redesigned the payments service using <mark>PostgreSQL</mark> and event-driven queues, cutting checkout latency 40%.</li>
                <li>Led migration to <mark>Kubernetes</mark>, reducing deploy time from 25 minutes to under 3.</li>
                <li>Built internal tooling in <mark>Python</mark> to catch schema drift before it reached production.</li>
              </ul>
            </div>
            <div className="lpShowScore">
              <div className="lpShowScoreLabel">Recruiter search visibility</div>
              <div className="lpShowScoreRow">
                <div className="lpShowScoreValue">12/15</div>
                <div className="lpShowScoreSub">Ready to send. Required skills in the tailored CV: 8/10 — not present: Go, Kafka.</div>
              </div>
              <div className="lpShowScoreLists">
                <div className="lpShowScoreGroup">
                  <div className="lpShowScoreGroupLabel hits">Matched (12)</div>
                  <ul className="lpShowScoreList">
                    <li className="hit"><span className="dot">✓</span>PostgreSQL — Experience</li>
                    <li className="hit"><span className="dot">✓</span>Kubernetes — Experience</li>
                    <li className="hit"><span className="dot">✓</span>Distributed systems — Summary</li>
                    <li className="more">and 9 more</li>
                  </ul>
                </div>
                <div className="lpShowScoreGroup">
                  <div className="lpShowScoreGroupLabel misses">Missing (3)</div>
                  <ul className="lpShowScoreList">
                    <li className="miss"><span className="dot">✕</span>GraphQL — not in your CV</li>
                    <li className="miss"><span className="dot">✕</span>Go — not in your CV</li>
                    <li className="miss"><span className="dot">✕</span>Kafka — not in your CV</li>
                  </ul>
                </div>
              </div>
            </div>
            <p className="lpShowNote">A worked example — Jordan and Northwind are made up; the layout, the score and the lists are exactly what the tool produces.</p>
          </div>
        </section>

        {/* ── The dossier: everything below hangs on one left rule ──────────── */}
        <div className="lpDossier">
          {/* ── The problem ─────────────────────────────────────────────────── */}
          <Reveal as="section" className="lpSection lpProblem">
            <Kicker n={1}>The problem</Kicker>
            <h2 className="lpH2">You&apos;ve got two options right now, and both cost you something.</h2>
            <div className="lpColumns">
              <div className="lpColumn">
                <h3 className="lpColumnTitle">The AI tools embellish</h3>
                <p className="lpColumnBody">
                  Ask one to tailor your CV and it&apos;ll add &quot;Terraform&quot; because the job
                  wants it — never mind that you&apos;ve never touched it. Fine, until an interviewer
                  asks you a real question about it.
                </p>
              </div>
              <div className="lpColumn">
                <h3 className="lpColumnTitle">Doing it by hand works, but it&apos;s slow</h3>
                <p className="lpColumnBody">
                  Rewriting your CV properly for one role — rereading the posting, hunting the right
                  phrasing, reformatting — takes about an hour. Most people stop customising after the
                  third application and start mass-applying with one generic version instead.
                </p>
              </div>
            </div>
          </Reveal>

          {/* ── The whole journey — real screenshots, a test account ────────── */}
          <Reveal as="section" className="lpSection lpJourney" id="journey">
            <Kicker n={2}>The whole journey</Kicker>
            <h2 className="lpH2">From one saved CV to the interview, in one place.</h2>
            <ol className="lpJourneySteps">
              {JOURNEY.map((step) => (
                <li key={step.n} className="lpJourneyStep">
                  <Folio n={step.n} />
                  <div className="lpJourneyText">
                    <h3 className="lpJourneyTitle">{step.title}</h3>
                    <p className="lpJourneyBody">{step.body}</p>
                  </div>
                  <Image src={step.img} alt={step.alt} className="lpShot" sizes="(max-width: 860px) 100vw, 480px" />
                </li>
              ))}
            </ol>
          </Reveal>

          {/* ── What makes it different ─────────────────────────────────────── */}
          <Reveal as="section" className="lpSection lpDiff">
            <Kicker n={3}>Why it&apos;s different</Kicker>
            <h2 className="lpH2">Built around one constraint: nothing invented.</h2>
            <div className="lpColumns lpColumns--3">
              <div className="lpColumn">
                <h3 className="lpColumnTitle">Checked, not trusted</h3>
                <p className="lpColumnBody">
                  Every figure is checked against your CV, every skill against the level you set for
                  it, and every sentence of the summary and letter against the line it came from. If
                  the job wants something you don&apos;t have, you see the gap — we don&apos;t invent
                  the skill.
                </p>
              </div>
              <div className="lpColumn">
                <h3 className="lpColumnTitle">It tells you when it&apos;s wrong</h3>
                <p className="lpColumnBody">
                  The score is a count of the job&apos;s terms your CV carries — never an inflated
                  percentage. Your tracker then measures whether that score predicts which
                  applications progress, and says so plainly when it doesn&apos;t.
                </p>
              </div>
              <div className="lpColumn">
                <h3 className="lpColumnTitle">A tracker built in</h3>
                <p className="lpColumnBody">
                  Click Applied and the run lands in your tracker — the exact CV you sent, the job
                  description you sent it for, and a follow-up date, ready for the week the recruiter
                  calls back.
                </p>
              </div>
            </div>
          </Reveal>

          {/* ── What it costs — said here, not discovered at the limit ──────── */}
          <Reveal as="section" className="lpSection lpCost">
            <Kicker n={4}>What it costs</Kicker>
            <h2 className="lpH2">Free to start. Honest about what happens after.</h2>
            <dl className="lpCostRows">
              <div>
                <dt>Three tailors on us, no card</dt>
                <dd>Your first three runs are on Claude — CV, cover letter and search-visibility score.</dd>
              </div>
              <div>
                <dt>The cap</dt>
                <dd>Three a day, whoever pays.</dd>
              </div>
              <div>
                <dt>Then your own free key</dt>
                <dd>
                  Add a free OpenRouter key in Settings and keep going at no cost. One honest note:
                  OpenRouter&apos;s free models may train on what you send — Settings says how to
                  check that in your OpenRouter account.
                </dd>
              </div>
            </dl>
          </Reveal>

          {/* ── Final CTA ───────────────────────────────────────────────────── */}
          <Reveal as="section" className="lpClose">
            <h2 className="lpH2">Honest beats impressive.</h2>
            <p className="lpCloseSub">
              A CV with ten skills you can defend beats one with twenty that fall apart under questioning.
            </p>
            <Button href="/app">Tailor my CV →</Button>
            {/* The page's one footnote: privacy, the screenshots, and the honest
                note on testimonials — never an invented quote. */}
            <p className="lpFootnote" data-quotes-empty>
              Your CV stays in your account and is processed only by the AI provider that runs your tailoring. The
              screenshots above are the real screens on a test account — Alex Tester and every company are made up.
              Testimonials: Nothing yet — and nothing made up. Real users&apos; words will go here, unedited and with their
              permission.
            </p>
          </Reveal>
        </div>

        <footer className="lpFooter">
          <span>Built by Soma Shekar Keesari · <span className="lpFooterTag">Welcome to the jungle.</span></span>
          <nav className="lpFooterLinks" aria-label="Footer">
            <Link href="/auth/login">Sign in</Link>
            <Link href="/app">Tailor my CV</Link>
            <a href="#example">See an example</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
