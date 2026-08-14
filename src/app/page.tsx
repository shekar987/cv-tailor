"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";

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
}: {
  as?: "section" | "div";
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const cls = `reveal${inView ? " reveal--visible" : ""}${className ? " " + className : ""}`;
  const style = delay ? { transitionDelay: `${delay}ms` } : undefined;
  if (as === "section") {
    return <section ref={ref} className={cls} style={style}>{children}</section>;
  }
  return <div ref={ref} className={cls} style={style}>{children}</div>;
}

// Counts up from 0 to `target` once `active` flips true — used for the score
// mockup below, so it reads as a live result rather than a static number.
function useCountUp(target: number, active: boolean, duration = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return value;
}

function AnimatedScoreValue({ target, total }: { target: number; total: number }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.5);
  const value = useCountUp(target, inView);
  return (
    <div ref={ref} className="lpShowScoreValue">
      {value}/{total}
    </div>
  );
}

// ─── Icons — small hand-drawn line icons, no icon library ──────────────────
function IconWarning() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}

export default function Landing() {
  return (
    <main className="lp">
      <noscript>
        <style>{`.reveal { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>

      <nav className="lpNav">
        <div className="lpWordmark">Jobhuntz</div>
        <div className="lpNavActions">
          <Link href="/auth/login" className="customizeLink">Sign in</Link>
          <Link href="/app" className="lpNavCta">Open the tool</Link>
        </div>
      </nav>

      {/* ── Hero — no scroll-reveal here, it's above the fold on load ────── */}
      <section className="lpHero">
        <p className="lpEyebrow">For backend, full-stack &amp; AI engineers</p>
        <h1 className="lpTitle">
          Every AI CV tool lies for you. This one <span className="lpAmber">won&apos;t</span>.
        </h1>
        <p className="lpSub">
          Paste your CV and the job description. Get back a tailored version built only from
          what&apos;s real — every line defensible in the interview.
        </p>
        <div className="lpHeroCta">
          <Button href="/app">Tailor my CV →</Button>
          <span className="lpHeroNote">3 free tailors, no card required.</span>
        </div>
      </section>

      {/* ── The problem ───────────────────────────────────────────────────── */}
      <Reveal as="section" className="lpProblem">
        <span className="lpKicker">The problem</span>
        <h2 className="lpH2">You&apos;ve got two options right now, and both cost you something.</h2>
        <div className="lpProblemGrid">
          <Reveal className="lpProblemCard">
            <div className="lpProblemIcon"><IconWarning /></div>
            <div className="lpProblemTitle">The AI tools embellish</div>
            <p className="lpProblemBody">
              Ask one to tailor your CV and it&apos;ll add &quot;Kubernetes&quot; because the job
              wants it — never mind that you&apos;ve never touched it. Fine, until an interviewer
              asks you a real question about it.
            </p>
          </Reveal>
          <Reveal className="lpProblemCard" delay={100}>
            <div className="lpProblemIcon"><IconClock /></div>
            <div className="lpProblemTitle">Doing it by hand works, but it&apos;s slow</div>
            <p className="lpProblemBody">
              Rewriting your CV properly for one role — rereading the posting, hunting the right
              phrasing, reformatting — takes about an hour. Most people stop customizing after the
              third application and start mass-applying with one generic version instead.
            </p>
          </Reveal>
        </div>
      </Reveal>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <Reveal as="section" className="lpHow">
        <span className="lpKicker">How it works</span>
        <h2 className="lpH2">Four steps. No wall of settings.</h2>
        <div className="lpSteps">
          <div className="lpStep">
            <span className="lpStepNum">1</span>
            <p><strong>Paste your CV and the job description.</strong></p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">2</span>
            <p><strong>We tailor your summary, skills, experience, and projects</strong> — using only what&apos;s already true in your CV.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">3</span>
            <p><strong>See exactly how you score</strong> against the job&apos;s top ATS keywords — what hits, what&apos;s missing, and why.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">4</span>
            <p><strong>Edit anything inline</strong>, then download a matching CV and cover letter — PDF or Word, ready to send.</p>
          </div>
        </div>
      </Reveal>

      {/* ── Show the product — the most important section on the page ────── */}
      <Reveal as="section" className="lpShow">
        <span className="lpKicker">See it for yourself</span>
        <h2 className="lpH2">This is what comes out the other end.</h2>
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
            <div className="lpShowTag">ATS score</div>
            <div className="lpShowScore">
              <div className="lpShowScoreLabel">Hey Jordan, here&apos;s your ATS keyword match</div>
              <AnimatedScoreValue target={12} total={15} />
              <div className="lpShowScoreSub">Required skills covered: 8/10</div>
              <div className="lpShowScoreGroup">
                <div className="lpShowScoreGroupLabel hits">Matched (12)</div>
                <ul className="lpShowScoreList">
                  <li className="hit"><span className="dot">✓</span>PostgreSQL — Experience</li>
                  <li className="hit"><span className="dot">✓</span>Kubernetes — Experience</li>
                  <li className="hit"><span className="dot">✓</span>Distributed systems — Summary</li>
                </ul>
              </div>
              <div className="lpShowScoreGroup">
                <div className="lpShowScoreGroupLabel misses">Missing (3)</div>
                <ul className="lpShowScoreList">
                  <li className="miss"><span className="dot">✕</span>GraphQL — not mentioned anywhere in your CV</li>
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </Reveal>

      {/* ── What makes it different ───────────────────────────────────────── */}
      <Reveal as="section" className="lpDiff">
        <span className="lpKicker">Why it&apos;s different</span>
        <h2 className="lpH2">Built around one constraint: nothing invented.</h2>
        <div className="lpDiffGrid">
          <Reveal className="lpDiffCard">
            <div className="lpDiffIcon"><IconShieldCheck /></div>
            <div className="lpDiffTitle">Nothing invented</div>
            <p className="lpDiffBody">
              Every skill and claim in your tailored CV already exists somewhere in your real one.
              If the job wants something you don&apos;t have, we surface the closest thing you
              actually do — never a line you&apos;d have to lie about in the interview.
            </p>
          </Reveal>
          <Reveal className="lpDiffCard" delay={100}>
            <div className="lpDiffIcon"><IconTarget /></div>
            <div className="lpDiffTitle">An honest ATS score</div>
            <p className="lpDiffBody">
              See exactly which of the job&apos;s top keywords you hit and which you&apos;re
              missing, and why — not an inflated 95% match designed to make you feel good and get
              you nowhere.
            </p>
          </Reveal>
          <Reveal className="lpDiffCard" delay={200}>
            <div className="lpDiffIcon"><IconMail /></div>
            <div className="lpDiffTitle">A cover letter too</div>
            <p className="lpDiffBody">
              Every tailor generates a matching cover letter alongside the CV — same job, same
              honesty, ready to send.
            </p>
          </Reveal>
        </div>
      </Reveal>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <Reveal as="section" className="lpClose">
        <h2 className="lpH2">Honest beats impressive.</h2>
        <p className="lpCloseSub">
          A CV with ten skills you can defend beats one with twenty that fall apart under questioning.
        </p>
        <Button href="/app">Tailor my CV →</Button>
      </Reveal>

      <footer className="lpFooter">
        Built by Soma Shekar Keesari · An honest CV tool for engineers
      </footer>
    </main>
  );
}
