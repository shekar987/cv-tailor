"use client";

import { useState } from "react";

type Result = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: string;
  coverLetter?: string;
  atsScore?: {
    keyword_coverage?: string;
    overall_assessment?: string;
  };
};

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [cvText, setCvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function handleTailor() {
    if (!jobDescription.trim()) {
      setError("Paste a job description to get started.");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, cvText }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Something went wrong. Try again.");
      else setResult(data);
    } catch {
      setError("Couldn't reach the server. Check it's running and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div className="wordmark">
            CV<span className="dot">.</span>Tailor
          </div>
          <p className="tagline">
            Honest, ATS-ready tailoring. Every claim traces back to your real CV — nothing invented.
          </p>
        </header>

        <section className="inputCard">
          <label className="label" htmlFor="cv">Your CV</label>
          <textarea
            id="cv"
            value={cvText}
            onChange={(e) => setCvText(e.target.value)}
            placeholder="Paste your current CV here… (leave blank to use the demo CV)"
            rows={8}
          />

          <label className="label" htmlFor="jd" style={{ marginTop: 16 }}>Job description</label>
          <textarea
            id="jd"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the full job description here…"
            rows={8}
          />
          <div className="actions">
            <button onClick={handleTailor} disabled={loading} className="cta">
              {loading ? "Tailoring…" : "Tailor my CV"}
            </button>
            {error && <span className="error">{error}</span>}
          </div>
        </section>

        {loading && (
          <section className="loading">
            <div className="pulse" />
            <ul>
              <li>Analysing the job description</li>
              <li>Researching the company</li>
              <li>Tailoring summary, skills, experience, projects</li>
              <li>Writing your cover letter</li>
              <li>Scoring against ATS keywords</li>
            </ul>
          </section>
        )}

        {result && (
          <section className="results">
            {result.atsScore?.keyword_coverage && (
              <div className="scoreCard">
                <div className="scoreLabel">ATS keyword match</div>
                <div className="scoreValue">{result.atsScore.keyword_coverage}</div>
                {result.atsScore.overall_assessment && (
                  <p className="scoreNote">{result.atsScore.overall_assessment}</p>
                )}
              </div>
            )}

            <Block title="Professional summary" content={result.summary} />
            <Block title="Skills" content={result.skills} />
            <Block title="Work experience" content={result.experience} />
            <Block title="Projects" content={result.projects} />
            <Block title="Cover letter" content={result.coverLetter} />
          </section>
        )}
      </div>
    </main>
  );
}

function Block({ title, content }: { title: string; content?: string }) {
  if (!content) return null;
  return (
    <article className="block">
      <h2>{title}</h2>
      <div className="blockBody">{content}</div>
    </article>
  );
}