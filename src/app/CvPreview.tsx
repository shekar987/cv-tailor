"use client";

import React, { useRef } from "react";

type ProjectsData = { ridex?: string[]; financial?: string[] };

type CvData = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: ProjectsData;
};

const PROJECTS_META: Record<string, { name: string; tech: string; links: { label: string; url: string; text: string }[] }> = {
  ridex: {
    name: "RideX — Full-Stack Ride-Hailing Platform",
    tech: "React 19, Firebase, Stripe, Mapbox, Vercel",
    links: [
      { label: "Live: ", url: "https://uber-demo-omega.vercel.app", text: "uber-demo-omega.vercel.app" },
      { label: "Code: ", url: "https://github.com/shekar987/RideX-app", text: "github.com/shekar987/RideX-app" },
    ],
  },
  financial: {
    name: "AI-Powered Financial Analysis System",
    tech: "Python, Anthropic Claude API, pandas",
    links: [
      { label: "Code: ", url: "https://github.com/shekar987/finsight-financial-chatbot", text: "github.com/shekar987/finsight-financial-chatbot" },
    ],
  },
};

export default function CvPreview({
  data,
  fileBaseName = "Soma_Shekar_CV",
}: {
  data: CvData;
  fileBaseName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const lines = (text?: string) =>
    (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !/^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE)\s*$/i.test(l));

  // Renders mixed subheads and bullet groups, grouping consecutive bullets into <ul>
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
          const clean = ls[i].replace(/^[•\-]\s*/, "");
          bullets.push(<li className="cvBullet" key={`${prefix}-${i}`}>{clean}</li>);
          i++;
        }
        nodes.push(<ul key={`${prefix}-ul-${i}`}>{bullets}</ul>);
      } else {
        nodes.push(<p className="cvSubhead" key={`${prefix}-${i}`}>{l}</p>);
        i++;
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
      pagebreak: { mode: ["css", "legacy"] },
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
        } else {
          const txt = (node.textContent || "").trim();
          if (txt) out.push(node.classList.contains("cvBullet") ? `- ${txt}` : txt);
        }
        node = node.nextElementSibling as HTMLElement | null;
      }
      return out.join("\n");
    };

    const readProjects = () => {
      const heads = Array.from(root.querySelectorAll(".cvHead"));
      const projHead = heads.find((h) => (h.textContent || "").trim().toLowerCase() === "projects");
      const result: { ridex: string[]; financial: string[] } = { ridex: [], financial: [] };
      if (!projHead) return result;
      let node = projHead.nextElementSibling as HTMLElement | null;
      let currentKey: "ridex" | "financial" | null = null;
      while (node && !node.classList.contains("cvHead")) {
        const titleEl = node.querySelector?.(".cvProjTitle") || (node.classList.contains("cvProjTitle") ? node : null);
        if (titleEl) {
          const t = (titleEl.textContent || "").toLowerCase();
          currentKey = t.includes("ridex") ? "ridex" : t.includes("financial") ? "financial" : currentKey;
        }
        const bulletEls = node.querySelectorAll?.(".cvBullet") || [];
        bulletEls.forEach((b: Element) => {
          const txt = (b.textContent || "").trim();
          if (txt && currentKey) result[currentKey].push(txt);
        });
        node = node.nextElementSibling as HTMLElement | null;
      }
      return result;
    };

    const payload = {
      summary: getSectionText("Professional Summary"),
      skills: getSectionText("Skills"),
      experience: getSectionText("Experience"),
      projects: readProjects(),
      companyName: "",
      roleTitle: "",
      fileBaseName,
    };

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
        <h1 className="cvName">SOMA SHEKAR KEESARI</h1>
        <p className="cvTagline">MSc Computer Science, University of East London | 2+ YoE | Java &amp; Spring Boot | Full Stack Engineer</p>
        <p className="cvContact">London, UK | +44 7553 449836 | somashekarkeesari18@gmail.com</p>
        {/* contentEditable={false} so clicks navigate the links rather than entering edit mode */}
        <p className="cvContact" contentEditable={false}>
          <a href="https://www.linkedin.com/in/shekar-keesari-4bbaa6234/" className="cvLink">linkedin.com/in/shekar-keesari-4bbaa6234</a>
          {" | "}
          <a href="https://github.com/shekar987" className="cvLink">github.com/shekar987</a>
        </p>

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

        {data.projects && (
          <>
            <h2 className="cvHead">Projects</h2>
            {(["ridex", "financial"] as const).map((key) => {
              const bullets = data.projects?.[key];
              if (!Array.isArray(bullets) || bullets.length === 0) return null;
              const meta = PROJECTS_META[key];
              return (
                <div key={key}>
                  <p className="cvProjTitle">{meta.name}</p>
                  <p className="cvText">{meta.tech}</p>
                  <p className="cvText">
                    {meta.links.map((l, li) => (
                      <span key={li}>
                        {li > 0 ? "  |  " : ""}
                        {l.label}
                        <a href={l.url} className="cvLink">{l.text}</a>
                      </span>
                    ))}
                  </p>
                  <ul>
                    {bullets.map((b, i) => (<li className="cvBullet" key={`${key}-${i}`}>{b.replace(/^[-•]\s*/, "")}</li>))}
                  </ul>
                </div>
              );
            })}
          </>
        )}

        <h2 className="cvHead">Education</h2>
        <p className="cvSubhead">MSc Computer Science (Industrial Placement) — Jan 2025 – Jan 2027</p>
        <p className="cvText">University of East London</p>
        <ul>
          <li className="cvBullet">AWS-accredited programme focused on Software Engineering, Cloud Computing, and AI applications.</li>
        </ul>
        <p className="cvSubhead">BSc Computer Science, Distinction — Jul 2019 – Jul 2023</p>
        <p className="cvText">Keshav Memorial Institute of Technology, India</p>
        <ul>
          <li className="cvBullet">Graduated with Distinction; coursework in Data Structures, OOP, Databases, and Software Engineering.</li>
        </ul>

        <h2 className="cvHead">Certifications</h2>
        <ul>
          <li className="cvBullet">AWS Certified Cloud Practitioner — Amazon Web Services</li>
          <li className="cvBullet">Java Developer Certificate — CodSoft</li>
        </ul>

        <h2 className="cvHead">Right to Work</h2>
        <ul>
          <li className="cvBullet">Full-time work authorised during MSc Industrial Placement.</li>
          <li className="cvBullet">Eligible for the UK Graduate Route visa upon MSc completion in January 2027.</li>
        </ul>
      </div>
    </div>
  );
}
