"use client";

import React, { useRef } from "react";
// projects now arrives keyed by index: { "0": [...bullets], "1": [...bullets] }
type ProjectsData = Record<string, string[]>;

type CvData = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: ProjectsData;
};


import type { Profile } from "@/lib/cvStore";

export default function CvPreview({
  data,
  profile,
  fileBaseName = "CV",
}: {
  data: CvData;
  profile?: Profile | null;
  fileBaseName?: string;
}) {
  // Fallbacks keep it working if profile is missing
  const p = profile || null;
  const name = p?.name || "YOUR NAME";
  const tagline = p?.tagline || "";
  const contactLine = [p?.location, p?.phone, p?.email].filter(Boolean).join(" | ");
  const linkedin = p?.linkedin || "";
  const github = p?.github || "";
  const ref = useRef<HTMLDivElement>(null);

  const lines = (text?: string) =>
    (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !/^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE|EDUCATION|CERTIFICATIONS)\s*:?\s*$/i.test(l));
  // Renders mixed subheads and bullet groups, grouping consecutive bullets into <ul>
  // Detects job-header lines (role | company) followed by a date line, and renders
  // them on one bold line (role left, date right). Groups bullets into <ul>.
  const isDateLine = (s: string) =>
    /\b(19|20)\d{2}\b/.test(s) && (s.includes("–") || s.includes("-") || /present/i.test(s)) && s.length < 40;

  const renderMixed = (text: string | undefined, prefix: string): React.ReactNode[] => {
    const ls = lines(text);
    const nodes: React.ReactNode[] = [];
    let i = 0;
    while (i < ls.length) {
      const l = ls[i];
      const isBullet = l.startsWith("•") || l.startsWith("-");

      if (isBullet) {
        const bullets: React.ReactNode[] = [];
        while (i < ls.length && (ls[i].startsWith("•") || ls[i].startsWith("-"))) {
          // strip the bullet marker AND the ** bold markers; force normal weight
          const clean = ls[i].replace(/^[•\-]\s*/, "").replace(/\*\*/g, "");
          bullets.push(
            <li className="cvBullet" key={`${prefix}-${i}`} style={{ fontWeight: 400, backgroundColor: "yellow" }}>
              {clean}
            </li>
          );
          i++;
        }
        nodes.push(<ul key={`${prefix}-ul-${i}`} style={{ fontWeight: 400 }}>{bullets}</ul>);
      } else {
        // Is the NEXT line a date? Then this is a job header — merge them.
        const next = ls[i + 1];
        if (next && isDateLine(next)) {
          nodes.push(
            <p className="cvJobHeader" key={`${prefix}-jh-${i}`}>
              <span className="cvJobRole">{l}</span>
              <span className="cvJobDate">{next}</span>
            </p>
          );
          i += 2;
        } else if (isDateLine(l)) {
          // a stray date line on its own — skip (already consumed with its header normally)
          i++;
        } else {
          // not a header, not a date → it's a body bullet (chain doesn't always prefix with •)
          nodes.push(
            <ul key={`${prefix}-ul-${i}`} style={{ fontWeight: 400 }}>
              <li className="cvBullet" style={{ fontWeight: 400 }}>{l.replace(/\*\*/g, "")}</li>
            </ul>
          );
          i++;
        }
      }
    }
    return nodes;
  };

  async function downloadPdf() {
    if (!ref.current) return;
    (document.activeElement as HTMLElement)?.blur();
    const html2pdf = (await import("html2pdf.js")).default;
     const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number],
      filename: `${fileBaseName}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };
    html2pdf().set(opt).from(ref.current).save();
  }

  async function downloadWord() {
    if (!ref.current) return;
    (document.activeElement as HTMLElement)?.blur();
    const root = ref.current; 
    const getSectionText = (headingText: string): string => {
      const heads = Array.from(root.querySelectorAll(".cvHead"));
      const head = heads.find((h) => (h.textContent || "").trim().toLowerCase() === headingText.toLowerCase());
      if (!head) return "";
      const out: string[] = [];
      let node = head.nextElementSibling as HTMLElement | null;
      while (node && !node.classList.contains("cvHead")) {
        if (node.tagName === "UL") {
          Array.from(node.children).forEach((li) => {
            const txt = (li.textContent || "").trim();
            if (txt) out.push(`- ${txt}`);
          });
        } else if (node.classList.contains("cvJobHeader")) {
          // role and date are separate spans — join with a tab marker so the Word route can split
          const role = (node.querySelector(".cvJobRole")?.textContent || "").trim();
          const date = (node.querySelector(".cvJobDate")?.textContent || "").trim();
          out.push(`@@JOB@@${role}@@${date}`);
        } else {
          const txt = (node.textContent || "").trim();
          if (txt) out.push(node.classList.contains("cvBullet") ? `- ${txt}` : txt);
        }
        node = node.nextElementSibling as HTMLElement | null;
      }
      return out.join("\n");
    };

  

   const payload = {
      summary: getSectionText("Professional Summary"),
      skills: getSectionText("Skills"),
      experience: getSectionText("Experience"),
      projects: data.projects || {},
      projectsMeta: p?.projects || [],
      profile: p,
      fileBaseName,
    };
    console.log("EXPERIENCE TEXT:", payload.experience);

    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.docx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="cvDocWrap">
      <div className="cvActions">
        <button className="cta" onClick={downloadPdf}>Download PDF</button>
        <button className="cta secondary" onClick={downloadWord}>Download Word</button>
      </div>
      <p className="editHint">Click any text to edit it. Your changes are included when you download.</p>
      <div className="cvDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}>
        <h1 className="cvName">{name}</h1>
        {tagline && <p className="cvTagline">{tagline}</p>}
        {contactLine && <p className="cvContact">{contactLine}</p>}
        {(linkedin || github) && (
          <p className="cvContact" contentEditable={false}>
            {linkedin && <a href={linkedin.startsWith("http") ? linkedin : "https://" + linkedin} className="cvLink">{linkedin.replace(/^https?:\/\//, "")}</a>}
            {linkedin && github && " | "}
            {github && <a href={github.startsWith("http") ? github : "https://" + github} className="cvLink">{github.replace(/^https?:\/\//, "")}</a>}
          </p>
        )}

        {data.summary && (
          <>
            <h2 className="cvHead">Professional Summary</h2>
            {lines(data.summary).map((l, i) => (<p className="cvText" key={`sum-${i}`}>{l}</p>))}
          </>
        )}

        {data.skills && (
          <>
            <h2 className="cvHead">Skills</h2>
            {lines(data.skills).map((l, i) => (<p className="cvText" key={`sk-${i}`}>{l}</p>))}
          </>
        )}

        {data.experience && (
          <>
            <h2 className="cvHead">Experience</h2>
            {renderMixed(data.experience, "exp")}
          </>
        )}

        {p?.projects && p.projects.length > 0 && (
          <>
            <h2 className="cvHead">Projects</h2>
            {p.projects.map((proj, idx) => {
              // tailored bullets for this project come keyed by index; fall back to original bullets
              const tailored = data.projects?.[String(idx)];
              const bullets = (Array.isArray(tailored) && tailored.length > 0)
                ? tailored
                : (proj.originalBullets || []);
              if (bullets.length === 0 && !proj.name) return null;
              return (
                <div key={`proj-${idx}`}>
                  <p className="cvProjTitle">{proj.name}</p>
                  {proj.tech && <p className="cvText">{proj.tech}</p>}
                  {proj.links && proj.links.length > 0 && (
                    <p className="cvText">
                      {proj.links.map((l, li) => (
                        <span key={li}>
                          {li > 0 ? "  |  " : ""}
                          {l.label}
                          <a href={l.url} className="cvLink">{l.text}</a>
                        </span>
                      ))}
                    </p>
                  )}
                  <ul>
                    {bullets.map((b, i) => (<li className="cvBullet" key={`${idx}-${i}`}>{b.replace(/^[-•]\s*/, "")}</li>))}
                  </ul>
                </div>
              );
            })}
          </>
        )}

        {p?.education && p.education.length > 0 && (
          <>
            <h2 className="cvHead">Education</h2>
            {p.education.map((e, i) => (
              <div key={`edu-${i}`}>
                <p className="cvSubhead">{e.degree}{e.dates ? ` — ${e.dates}` : ""}</p>
                {e.institution && <p className="cvText">{e.institution}</p>}
                {e.note && (
                  <ul>
                    <li className="cvBullet">{e.note}</li>
                  </ul>
                )}
              </div>
            ))}
          </>
        )}

        {p?.certifications && p.certifications.length > 0 && (
          <>
            <h2 className="cvHead">Certifications</h2>
            <ul>
              {p.certifications.map((c, i) => (
                <li className="cvBullet" key={`cert-${i}`}>{c}</li>
              ))}
            </ul>
          </>
        )}

        {p?.rightToWork && p.rightToWork.length > 0 && (
          <>
            <h2 className="cvHead">Right to Work</h2>
            <ul>
              {p.rightToWork.map((r, i) => (
                <li className="cvBullet" key={`rtw-${i}`}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
