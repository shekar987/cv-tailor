"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Button from "@/components/ui/Button";
// Real screenshots of the product from a test account (Alex Tester, Northwind
// Labs and every company in them are made up), captured by the smoke
// harness (scratchpad/smoke/shots-landing.mjs). Re-capture after a redesign.
import shotInterviewer from "../../public/landing/interviewer.jpg";
import shotCustomize from "../../public/landing/customize.jpg";
import shotPrecheck from "../../public/landing/precheck.jpg";
import shotTailored from "../../public/landing/tailored.jpg";
import shotScore from "../../public/landing/score.jpg";
import shotTracker from "../../public/landing/tracker.jpg";
import shotPrep from "../../public/landing/prep.jpg";
import shotInterview from "../../public/landing/interview.jpg";
import { createClient } from "@/lib/supabase/client";

// ─── Scroll-reveal: progressive enhancement ─────────────────────────────────
// Fires once per element via IntersectionObserver, then disconnects. The
// hidden state is scoped under `.js-ready` (added on mount, globals.css), so
// without JavaScript — or before hydration — everything is visible, and
// prefers-reduced-motion shows everything at once. This only adds polish,
// it never gates content.
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
        <div className="lpHeroText">
          <h1 className="lpTitle">
            Honest CVs. <span className="lpAmber">Real</span> interview practice.
          </h1>
          <p className="lpSub">
            Paste your CV and a job description. Every claim in what comes back is checked
            against your CV — figures, skills, and each sentence of the summary and letter —
            before you see it. Then an interviewer built from the same job asks you the
            questions out loud, UK round by UK round.
          </p>
          <div className="lpHeroCta">
            <Button href="/app">Tailor my CV →</Button>
            <a href="#journey" className="cta secondary">See the whole journey ↓</a>
          </div>
        </div>
        <figure className="lpHeroFigure">
          <Image
            src={shotInterviewer}
            alt="Emma Clarke, one of the two AI interviewers, rendered in the browser: a woman in a pinstriped jacket against a dark backdrop, with her name and role on a nameplate."
            className="lpShot lpShotPortrait"
            priority
            sizes="(max-width: 860px) 100vw, 420px"
          />
          <figcaption>
            Emma Clarke runs the screening, competency and strengths rounds; Daniel Okafor the technical ones.
            Rendered live in your browser — no video, no upload.
          </figcaption>
        </figure>
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
              Ask one to tailor your CV and it&apos;ll add &quot;Terraform&quot; because the job
              wants it — never mind that you&apos;ve never touched it. Fine, until an interviewer
              asks you a real question about it.
            </p>
          </Reveal>
          <Reveal className="lpProblemCard" delay={100}>
            <div className="lpProblemIcon"><IconClock /></div>
            <h3 className="lpProblemTitle">Doing it by hand works, but it&apos;s slow</h3>
            <p className="lpProblemBody">
              Rewriting your CV properly for one role — rereading the posting, hunting the right
              phrasing, reformatting — takes about an hour. Most people stop customising after the
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

      {/* ── The whole journey — real screenshots, a test account ──────────── */}
      <Reveal as="section" className="lpSection lpJourney" id="journey">
        <span className="lpKicker">The whole journey</span>
        <h2 className="lpH2">From one saved CV to the interview, in one place.</h2>
        <p className="lpShowNote">
          Screenshots of the real screens, from a test account: Alex Tester, Northwind Labs and every company in the
          tracker are made up. The checks, the numbers and the wording are exactly what the tool shows.
        </p>
        <ol className="lpJourneySteps">
          {[
            {
              n: 1,
              title: "Save your CV once.",
              body: "Paste or upload it on Customize. The details, projects and education are pulled out for you to check, and every skill gets a level — production, project or learning — that the tailoring must respect.",
              img: shotCustomize,
              alt: "The Customize page: a saved master CV, and the extracted details — name, tagline, location, email, LinkedIn, GitHub — in editable fields.",
            },
            {
              n: 2,
              title: "A free pre-check before a credit is spent.",
              body: "The posting's eligibility conditions are read against your own answers, your keyword match is counted, and the tracker says whether you have applied to this company before.",
              img: shotPrecheck,
              alt: "The pre-check card: the role and company read off the posting, a note that you already applied to this company once, and the read \"Apply\".",
            },
            {
              n: 3,
              title: "A tailored CV built only from what is true.",
              body: "Summary, skills, experience and projects, selected and reordered from your own bullets. Job titles, employers and dates are never touched; every figure is checked against the master CV.",
              img: shotTailored,
              alt: "The tailored CV preview: name and contact line, a professional summary, two skills lines and the first role's bullets with the figures in bold.",
            },
            {
              n: 4,
              title: "A score that is a count, not a compliment.",
              body: "How many of the role's terms the tailored text carries, with the matched and missing lists. 6 of 10 reads \"Borderline. Fix these before sending.\" — never \"strong\".",
              img: shotScore,
              alt: "The recruiter search visibility card: 6/10, Borderline, with six matched terms and four missing ones listed.",
            },
            {
              n: 5,
              title: "Applied, and it lands in the tracker.",
              body: "The exact CV and letter you sent, the posting, a follow-up date, and a \"What's working\" read that says plainly what it cannot measure.",
              img: shotTracker,
              alt: "The application tracker: status chips, the What's working card, and a sheet of applications with company, role, status, dates and notes.",
            },
            {
              n: 6,
              title: "A prep pack traced line by line.",
              body: "The questions this job will ask, with STAR answers built only from your CV — each line marked \"Traced to your CV\" or flagged for you to rephrase.",
              img: shotPrep,
              alt: "An interview prep question with a STAR answer and two lines marked Traced to your CV.",
            },
            {
              n: 7,
              title: "Then say it out loud.",
              body: "Pick the UK round — screening call, competency, strengths-based, technical, hiring manager, final — and an interviewer built from the same job asks the questions and checks each answer against your CV.",
              img: shotInterview,
              alt: "The mock interview setup: the 3D interviewer on the left, and the six UK rounds to choose from on the right.",
            },
          ].map((step) => (
            <li key={step.n} className="lpJourneyStep">
              <div className="lpJourneyText">
                <span className="lpStepNum">{step.n}</span>
                <h3 className="lpJourneyTitle">{step.title}</h3>
                <p className="lpJourneyBody">{step.body}</p>
              </div>
              <Image src={step.img} alt={step.alt} className="lpShot" sizes="(max-width: 860px) 100vw, 620px" />
            </li>
          ))}
        </ol>
      </Reveal>

      {/* ── Trust — an honest empty slot, never an invented quote ─────────── */}
      <Reveal as="section" className="lpSection lpTrust" id="trust">
        <span className="lpKicker">What people say</span>
        <h2 className="lpH2">Nothing yet — and nothing made up.</h2>
        <blockquote className="lpQuoteSlot" data-quotes-empty>
          <p>
            This is where real users&apos; words will go: unedited, with their permission, and only once someone has
            written to say what it did for them. Until then this space stays empty rather than filled with quotes we
            wrote ourselves.
          </p>
        </blockquote>
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
