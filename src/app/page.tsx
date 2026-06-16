"use client";

import { useState } from "react";

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  async function handleTailor() {
    if (!jobDescription.trim()) {
      setError("Please paste a job description first.");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Failed to reach the server. Is it running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen max-w-4xl mx-auto p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">CV Tailor</h1>
        <p className="text-gray-600">
          Paste a job description and get an honest, ATS-tailored CV.
        </p>
      </header>

      <section className="mb-6">
        <label className="block font-medium mb-2">Job Description</label>
        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the full job description here..."
          rows={10}
          className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </section>

      <button
        onClick={handleTailor}
        disabled={loading}
        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Tailoring..." : "Tailor My CV"}
      </button>

      {error && (
        <p className="mt-4 text-red-600 text-sm">{error}</p>
      )}

      {loading && (
        <div className="mt-8 text-gray-600">
          <p>Running the chain — this takes 10-20 seconds:</p>
          <ul className="list-disc list-inside mt-2 text-sm">
            <li>Analyzing the job description</li>
            <li>Researching the company</li>
            <li>Tailoring summary, skills, experience, projects</li>
            <li>Writing your cover letter</li>
            <li>Scoring against ATS keywords</li>
          </ul>
        </div>
      )}

      {result && (
        <section className="mt-8 space-y-6">
          <ResultBlock title="Professional Summary" content={result.summary} />
          <ResultBlock title="Skills" content={result.skills} />
          <ResultBlock title="Work Experience" content={result.experience} />
          <ResultBlock title="Projects" content={result.projects} />
          <ResultBlock title="Cover Letter" content={result.coverLetter} />

          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h2 className="font-semibold mb-2">
              ATS Score: {result.atsScore?.keyword_coverage}
            </h2>
            <p className="text-sm text-gray-700 mb-2">
              {result.atsScore?.overall_assessment}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function ResultBlock({ title, content }: { title: string; content: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h2 className="font-semibold mb-2">{title}</h2>
      <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
        {content}
      </pre>
    </div>
  );
}