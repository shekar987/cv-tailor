import { test } from "node:test";
import assert from "node:assert/strict";
import { labelProjectName, projectLabels, splitProjectLabel, withProjectLabels } from "../src/lib/projectLabels.ts";
import { buildCvPdf } from "../src/lib/buildCvPdf.ts";
import { extractPdfText } from "../src/lib/pdfTextCheck.ts";

const CV = `Alex Tester
PROJECTS
Hailo — Ride-Hailing Platform	2025
Personal portfolio project modelled on a real-world brief  |  Tech: React, Node.js
• Built the booking flow
Beta Project	2024
Tech: Python
• Wrote a parser
Gamma App
Live: https://example.com
Group project for a university module
• Led the API
EDUCATION
MSc Computing`;

test("a label is read from the line under the heading", () => {
  const labels = projectLabels(CV);
  assert.equal(labels.get("hailo"), "personal portfolio project modelled on a real-world brief");
  assert.equal(labels.has("betaproject"), false, "a title with Project in it is not a label");
  assert.equal(labels.has("gammaapp"), false, "the line above it said its links, so it is not that heading");
  assert.equal(projectLabels("").size, 0);
  assert.equal(projectLabels(null, undefined).size, 0);
});

test("a later source fills in only what the first did not give", () => {
  const pool = `PROJECTS\nDelta Tool\nUniversity coursework project\n• Did it\nHailo — Another Title\nSide project\n• Other`;
  const labels = projectLabels(CV, pool);
  assert.equal(labels.get("deltatool"), "university coursework project");
  assert.equal(labels.get("hailo"), "personal portfolio project modelled on a real-world brief");
});

test("the name gains the label, before its date, once", () => {
  const labels = projectLabels(CV);
  const out = "Hailo — Ride-Hailing Platform (personal portfolio project modelled on a real-world brief)";
  assert.equal(labelProjectName("Hailo — Ride-Hailing Platform", labels), out);
  assert.equal(labelProjectName("Hailo — Ride-Hailing Platform | 2025", labels), `${out} | 2025`);
  assert.equal(labelProjectName(out, labels), out, "already there");
  assert.equal(labelProjectName("Hailo (2025)", labels), "Hailo (personal portfolio project modelled on a real-world brief) | 2025");
  assert.equal(labelProjectName("Unlisted Tool | 2024", labels), "Unlisted Tool | 2024", "no label, no change");
});

test("a heading splits from its label, and a plain title stays whole", () => {
  assert.deepEqual(splitProjectLabel("Hailo (personal portfolio project)"), { head: "Hailo", label: "(personal portfolio project)" });
  assert.deepEqual(splitProjectLabel("Hailo — Platform"), { head: "Hailo — Platform", label: "" });
  assert.deepEqual(splitProjectLabel("Hailo (v2)"), { head: "Hailo (v2)", label: "" });
});

test("the PDF keeps the date beside the heading and prints the label in the text layer", async () => {
  const name = labelProjectName("Hailo — Full-Stack Ride-Hailing Platform | 2025", projectLabels(CV));
  const bytes = buildCvPdf({
    summary: "Software engineer.",
    skills: "Technical Tools: React",
    experience: "Software Engineer | Acme | Jan 2024 – Present\n• Built it",
    projects: { "0": ["Built the booking flow"] },
    projectsMeta: [{ name, tech: "React", links: [], originalBullets: [] }],
    profile: { name: "Alex Tester", email: "alex@example.com", education: [], certifications: [], rightToWork: [], projects: [] },
    targetPages: 2,
  });
  const text = (await extractPdfText(bytes)).replace(/\s+/g, " ");
  assert.match(text, /Hailo — Full-Stack Ride-Hailing Platform 2025/);
  assert.match(text, /\(personal portfolio project modelled on a real-world brief\)/);
});

test("a list keeps its objects when nothing changed", () => {
  const labels = projectLabels(CV);
  const plain = [{ name: "Unlisted Tool" }];
  assert.equal(withProjectLabels(plain, labels), plain);
  assert.equal(withProjectLabels(plain, new Map()), plain);
  const changed = withProjectLabels([{ name: "Hailo", tech: "React" }, { name: 5 } as unknown as { name: string; tech: string }], labels);
  assert.equal(changed[0].name, "Hailo (personal portfolio project modelled on a real-world brief)");
  assert.equal(changed[0].tech, "React");
});
