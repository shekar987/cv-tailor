import Link from "next/link";

export default function Landing() {
  return (
    <main className="lp">
      <nav className="lpNav">
        <div className="lpWordmark">CV<span className="lpDot">.</span>Tailor</div>
        <Link href="/app" className="lpNavCta">Open the tool</Link>
      </nav>

      <section className="lpHero">
        <p className="lpEyebrow">For backend, full-stack & AI engineers</p>
        <h1 className="lpТitle">
          A CV tailor that <span className="lpAmber">won't lie</span> for you.
        </h1>
        <p className="lpSub">
          Most AI CV tools pad your experience with skills you don't have to match the job description.
          This one refuses — and shows you exactly where you really stand.
        </p>
        <Link href="/app" className="lpCta">Tailor my CV →</Link>
      </section>

      <section className="lpContrast">
        <div className="lpCard lpBad">
          <div className="lpCardLabel">Other AI CV tools</div>
          <p className="lpCardLine">JD wants Kubernetes? <strong>Adds "Kubernetes" to your skills.</strong></p>
          <p className="lpCardLine">JD wants 5 years? <strong>Quietly rounds your 2 up.</strong></p>
          <p className="lpCardLine">Result: a CV you can't defend in the interview.</p>
        </div>
        <div className="lpCard lpGood">
          <div className="lpCardLabel">CV.Tailor</div>
          <p className="lpCardLine">JD wants Kubernetes? <strong>Surfaces your real Docker experience instead.</strong></p>
          <p className="lpCardLine">Every claim traces back to your actual CV.</p>
          <p className="lpCardLine">Result: a CV that's sharp, honest, and yours.</p>
        </div>
      </section>

      <section className="lpHow">
        <h2 className="lpH2">How it works</h2>
        <div className="lpSteps">
          <div className="lpStep">
            <span className="lpStepNum">1</span>
            <p>Paste your CV and the job description.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">2</span>
            <p>Get a tailored CV, a cover letter, and an honest ATS keyword score — showing what matches and what genuinely doesn't.</p>
          </div>
          <div className="lpStep">
            <span className="lpStepNum">3</span>
            <p>Edit anything inline, then download as PDF or Word, ready to send.</p>
          </div>
        </div>
      </section>

      <section className="lpClose">
        <h2 className="lpH2">Honest beats impressive.</h2>
        <p className="lpCloseSub">
          A CV with ten skills you can defend beats one with twenty that fall apart under questioning.
        </p>
        <Link href="/app" className="lpCta">Tailor my CV →</Link>
      </section>

      <footer className="lpFooter">
        Built by Soma Shekar Keesari · An honest CV tool for engineers
      </footer>
    </main>
  );
}