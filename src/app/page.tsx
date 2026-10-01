"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// ─── Scroll-reveal: progressive enhancement ─────────────────────────────────
// Fires once per element via IntersectionObserver, then disconnects. The
// <noscript> block in the page body forces full visibility if JS never runs,
// so nothing is ever permanently invisible — this only ever adds polish, it
// never gates content.
function useInView<T extends HTMLElement>(threshold = 0.15) {
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
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView } as const;
}

function Reveal({
  as = "div",
  children,
  className = "",
  delay = 0,
  id,
}: {
  as?: "section" | "div";
  children: React.ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const cls = `reveal${inView ? " reveal--visible" : ""}${className ? " " + className : ""}`;
  const style = delay ? { transitionDelay: `${delay}ms` } : undefined;
  if (as === "section") {
    return <section ref={ref} id={id} className={cls} style={style}>{children}</section>;
  }
  return <div ref={ref} id={id} className={cls} style={style}>{children}</div>;
}

// ─── Icons — small hand-drawn line icons, no icon library ──────────────────
function IconWarning() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a3 3 0 0 1 6 0" />
      <path d="M9 11h6M9 15h6" />
    </svg>
  );
}

export default function Landing() {
  // The scroll-reveal hides content ONLY once JS is running: the `.reveal`
  // hidden state is scoped under `.js-ready` (see globals.css), so the
  // server-rendered page is fully visible until hydration has actually
  // happened — slow networks, failed hydration and crawlers all see it all.
  // Adaptive nav: someone already signed in doesn't need "Sign in" — they need
  // the app. Fail-soft: any error keeps the signed-out pair.
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("js-ready");
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) setSignedIn(true);
      })
      .catch(() => {});
  }, []);

  return (
    <main className="lp">

      <nav className="lpNav">
        <div>
          <div className="lpWordmark">Jobhuntz</div>
          <p className="lpTagline">Welcome to the jungle.</p>
        </div>
        <div className="lpNavActions">
          {signedIn ? (
            <Link href="/app" className="lpNavCta">Open the app →</Link>
          ) : (
            <>
              <Link href="/auth/login" className="customizeLink">Sign in</Link>
              <Link href="/app" className="lpNavCta">Open the tool</Link>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero — no scroll-reveal here, it's above the fold on load ────── */}
      <section className="lpHero">
        <h1 className="lpTitle">
          Every AI CV tool lies for you. This one <span className="lpAmber">won&apos;t</span>.
        </h1>
        <p className="lpSub">
          Paste your CV and a job description. Every claim in what comes back is checked
          against your CV — figures, skills, and each sentence of the summary and letter —
          before you see it.
        </p>
        <div className="lpHeroCta">
          <Button href="/app">Tailor my CV →</Button>
          <a href="#example" className="cta secondary">See an example ↓</a>
        </div>
      </section>

      {/* ── The problem ───────────────────────────────────────────────────── */}
      <Reveal as="section" className="lpSection lpProblem">
        <span className="lpKicker">The problem</span>
        <h2 className="lpH2">You&apos;ve got two options right now, and both cost you something.</h2>
        <div className="lpProblemGrid">
          <Reveal className="lpProblemCard">
            <div className="lpProblemIcon"><IconWarning /></div>
            <h3 className="lpProblemTitle">The AI tools embellish</h3>
            <p className="lpProblemBody">
              Ask one to tailor your CV and it&apos;ll add &quot;Kubernetes&quot; because the job
              wants it — never mind that you&apos;ve never touched it. Fine, until an interviewer
              asks you a real question about it.
            </p>
          </Reveal>
          <Reveal className="lpProblemCard" delay={100}>
            <div className="lpProblemIcon"><IconClock /></div>
            <h3 className="lpProblemTitle">Doing it by hand works, but it&apos;s slow</h3>
            <p className="lpProblemBody">
              Rewriting your CV properly for one role — rereading the posting, hunting the right
              phrasing, reformatting — takes about an hour. Most people stop customizing after the
              third application and start mass-applying with one generic version instead.
            </p>
          </Reveal>
        </div>
      </Reveal>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <Reveal as="section" className="lpSection lpHow">
        <span className="lpKicker">How it works</span>
        <h2 className="lpH2">Four steps. No wall of settings.</h2>
        <div className="lpSteps">
          <div className="lpStep">
            <span className="lpStepNum">1</span>
            <p><strong>Save your CV once, then paste a job description.</strong> A free pre-check reads the conditions the form screens on — right to work, years, location — and your keyword match before a tailor is spent.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">2</span>
            <p><strong>We tailor your summary, skills, experience, and projects</strong> — using only what&apos;s already true in your CV.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">3</span>
            <p><strong>See exactly how visible you are</strong> to a recruiter searching for the job&apos;s top terms — what hits, what&apos;s missing, and why.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">4</span>
            <p><strong>Edit anything inline</strong>, then download a matching CV and cover letter — PDF or Word, ready to send. One click saves the run to your application tracker.</p>
          </div>
        </div>
      </Reveal>

      {/* ── Show the product — the most important section on the page ────── */}
      <Reveal as="section" className="lpSection lpBand lpShow" id="example">
        <span className="lpKicker">See it for yourself</span>
        <h2 className="lpH2">This is what comes out the other end.</h2>
        <p className="lpShowNote">A worked example: Jordan and Northwind are made up. The layout, the score and the two lists are exactly what the tool produces for a real CV and posting.</p>
        <div className="lpShowStage">
          <Reveal>
            <div className="lpShowTag">Tailored CV</div>
            <div className="lpShowCv">
              <div className="lpCvName">JORDAN REYES</div>
              <div className="lpCvContact">San Francisco, CA · jordan@email.com · linkedin.com/in/jordanreyes</div>
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
          </Reveal>
          <Reveal delay={120}>
            <div className="lpShowTag">Search visibility</div>
            <div className="lpShowScore">
              <div className="lpShowScoreLabel">Hey Jordan, here&apos;s your recruiter search visibility</div>
              <div className="lpShowScoreValue">12/15</div>
              <div className="lpShowScoreSub">Ready to send. · Required skills in the tailored CV: 8/10 — not present: Go, Kafka</div>
              <div className="lpShowScoreGroup">
                <div className="lpShowScoreGroupLabel hits">Matched (12)</div>
                <ul className="lpShowScoreList">
                  <li className="hit"><span className="dot">✓</span>PostgreSQL — Experience</li>
                  <li className="hit"><span className="dot">✓</span>Kubernetes — Experience</li>
                  <li className="hit"><span className="dot">✓</span>Distributed systems — Summary</li>
                  <li className="hit"><span className="dot">…</span>and 9 more</li>
                </ul>
              </div>
              <div className="lpShowScoreGroup">
                <div className="lpShowScoreGroupLabel misses">Missing (3)</div>
                <ul className="lpShowScoreList">
                  <li className="miss"><span className="dot">✕</span>GraphQL — not mentioned anywhere in your CV</li>
                  <li className="miss"><span className="dot">✕</span>Go — not mentioned anywhere in your CV</li>
                  <li className="miss"><span className="dot">✕</span>Kafka — not mentioned anywhere in your CV</li>
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </Reveal>

      {/* ── What makes it different ───────────────────────────────────────── */}
      <Reveal as="section" className="lpSection lpDiff">
        <span className="lpKicker">Why it&apos;s different</span>
        <h2 className="lpH2">Built around one constraint: nothing invented.</h2>
        <div className="lpDiffGrid">
          <Reveal className="lpDiffCard">
            <div className="lpDiffIcon"><IconShieldCheck /></div>
            <h3 className="lpDiffTitle">Checked, not trusted</h3>
            <p className="lpDiffBody">
              Every figure is checked against your CV, every skill against the level you set for
              it, and every sentence of the summary and letter against the line it came from. If
              the job wants something you don&apos;t have, you see the gap — we don&apos;t invent
              the skill.
            </p>
          </Reveal>
          <Reveal className="lpDiffCard" delay={100}>
            <div className="lpDiffIcon"><IconTarget /></div>
            <h3 className="lpDiffTitle">It tells you when it&apos;s wrong</h3>
            <p className="lpDiffBody">
              The score is a count of the job&apos;s terms your CV carries — never an inflated
              percentage. Your tracker then measures whether that score predicts which
              applications progress, and says so plainly when it doesn&apos;t.
            </p>
          </Reveal>
          <Reveal className="lpDiffCard" delay={200}>
            <div className="lpDiffIcon"><IconClipboard /></div>
            <h3 className="lpDiffTitle">A tracker built in</h3>
            <p className="lpDiffBody">
              Click Applied and the run lands in your tracker — the exact CV you sent, the job
              description you sent it for, and a follow-up date, ready for the week the recruiter
              calls back.
            </p>
          </Reveal>
        </div>
      </Reveal>

      {/* ── What it costs — said here, not discovered at the limit ────────── */}
      <Reveal as="section" className="lpSection lpCost">
        <span className="lpKicker">What it costs</span>
        <h2 className="lpH2">Free to start. Honest about what happens after.</h2>
        <div className="lpCostGrid">
          <div className="lpCostCard">
            <h3 className="lpCostTitle">Three tailors on us, no card</h3>
            <p className="lpCostBody">
              Your first three runs are on Claude — CV, cover letter and search-visibility score.
              Three a day is the cap, whoever pays.
            </p>
          </div>
          <div className="lpCostCard">
            <h3 className="lpCostTitle">Then your own free key</h3>
            <p className="lpCostBody">
              Add a free OpenRouter key in Settings and keep going at no cost. One honest note:
              OpenRouter&apos;s free models may train on what you send — Settings says how to
              check that in your OpenRouter account.
            </p>
          </div>
        </div>
      </Reveal>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <Reveal as="section" className="lpClose">
        <h2 className="lpH2">Honest beats impressive.</h2>
        <p className="lpCloseSub">
          A CV with ten skills you can defend beats one with twenty that fall apart under questioning.
        </p>
        <Button href="/app">Tailor my CV →</Button>
        <p className="lpPrivacy">
          Your CV stays in your account and is processed only by the AI provider that runs your tailoring.
        </p>
      </Reveal>

      <footer className="lpFooter">
        <span>Built by Soma Shekar Keesari</span>
        <nav className="lpFooterLinks" aria-label="Footer">
          <Link href="/auth/login">Sign in</Link>
          <Link href="/app">Tailor my CV</Link>
          <a href="#example">See an example</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </main>
  );
}
