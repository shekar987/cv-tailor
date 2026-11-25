import { notFound } from "next/navigation";
import LocalSummaryCompare from "../../LocalSummaryCompare";

// Dev-only preview of the Local Tailor "Local (£0)" comparison (Chunk TL-1),
// for the screenshot harness. It renders the REAL component with the REAL
// globals.css tokens, seeded with a fictional Alex Tester summary — so the
// screenshot is faithful without needing auth, the database migration or a
// running Ollama. Returns 404 in production; it is never a public page.

export const dynamic = "force-static";

const PAID = [
  "Full Stack Engineer with 2 years' production experience building and shipping web applications in TypeScript, React and Node.js.",
  "Rebuilt a logistics dashboard used by 40 depots and cut page load time by 35%.",
  "Comfortable owning features end to end, from Postgres schema to deployment on AWS.",
].join("\n");

const LOCAL = [
  "Full Stack Engineer with 2 years' experience delivering TypeScript, React and Node.js web apps in production.",
  "Rebuilt a logistics dashboard for 40 depots and reduced page load time by 35%.",
  "Takes features from Postgres schema through to AWS deployment.",
].join("\n");

export default function Tl1PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="page">
      <div className="container">
        <section className="results">
          <div className="resultsMain">
            <p className="folio folio--text" aria-hidden="true">Tailored result</p>
            <div className="localTailor" data-local-tailor>
              <div className="localTailor__bar">
                <div>
                  <p className="localTailor__title">Compare with Local (£0)</p>
                  <p className="cvHelp">
                    Run the summary on the free model on your own PC and see it beside the paid one. No key, no per-CV cost.
                  </p>
                </div>
                <button type="button" className="cta secondary">Run again (£0)</button>
              </div>
              <LocalSummaryCompare
                paidSummary={PAID}
                status="done"
                savedGbp={0.07}
                local={{
                  summary: LOCAL,
                  model: "qwen2.5:7b-instruct-q4_K_M",
                  tokensPerSec: 11.4,
                  numbersOk: true,
                  unsupportedNumbers: [],
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
