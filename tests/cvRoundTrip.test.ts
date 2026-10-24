// The generated CV read back the way a recruiter's system reads it: build the
// PDF and the .docx from a fixture profile, extract the text with pure-JS
// parsers (unpdf, mammoth — the same engines the upload path uses; no system
// tools, so this runs on the Vercel build too), and require every contact
// detail in that text. From 17 to 22 Oct 2026 every CV's header printed
// "Gmail" instead of the address and nothing read a built file's header; this
// suite runs in `npm test`, in CI and before every `next build` (prebuild).
//
// The second half is the upload side: a CV whose email is a link labelled
// "Gmail" must come back from lib/parseCv with the address.
import test from "node:test";
import assert from "node:assert/strict";
import mammoth from "mammoth";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, ExternalHyperlink } from "docx";
import { buildCvPdf } from "../src/lib/buildCvPdf.ts";
import { buildCvDocx } from "../src/lib/buildCvDocx.ts";
import { extractPdfText } from "../src/lib/pdfTextCheck.ts";
import { parseCvFile } from "../src/lib/parseCv.ts";
import { checkContact } from "../src/lib/contactCheck.ts";

// Synthetic — no real person's details.
const profile = {
  name: "Alex Tester",
  tagline: "Software Engineer",
  location: "London, UK",
  phone: "+44 7700 900123",
  email: "alex.tester@example.com",
  linkedin: "linkedin.com/in/alex-tester",
  github: "https://github.com/alextester",
  website: "alextester.dev",
  education: [{ degree: "BSc Computer Science", dates: "2019 – 2022", institution: "University of Testing", note: "" }],
  certifications: [],
  projects: [],
  rightToWork: [],
};
const EXPECTED = ["alex.tester@example.com", "+44 7700 900123", "linkedin.com/in/alex-tester", "github.com/alextester", "alextester.dev"];

const payload = {
  summary: "Software engineer with two years building TypeScript services and React interfaces for a logistics platform.",
  skills: "Technical Tools: TypeScript | React | Node.js | PostgreSQL",
  experience: "Software Engineer | Example Logistics | Jan 2023 – Present\n• Built a delivery tracking service in Node.js handling 40,000 events a day.\n• Rebuilt the dispatch dashboard in React, cutting page load from 4 s to 1.2 s.",
  projects: {},
  projectsMeta: [],
  profile,
  targetPages: 2,
};

// Extraction may break a line anywhere and folds spacing: compare without whitespace.
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function assertContact(text: string, where: string) {
  const hay = squash(text);
  for (const want of EXPECTED) assert.ok(hay.includes(squash(want)), `${where}: "${want}" is missing from the extracted text`);
  assert.ok(!/\bgmail\b/i.test(text), `${where}: a bare "Gmail" is in the text`);
}

test("the fixture's contact details pass the contact check (the generation gate)", () => {
  assert.deepEqual(checkContact(profile), []);
});

for (const formatStyle of ["ukji", "careerset"]) {
  test(`PDF (${formatStyle}): email, phone and every URL come back out of the text layer`, async () => {
    const bytes = buildCvPdf({ ...payload, formatStyle });
    assertContact(await extractPdfText(bytes), `PDF ${formatStyle}`);
  });

  test(`DOCX (${formatStyle}): email, phone and every URL come back out of the document text`, async () => {
    const bytes = await buildCvDocx({ ...payload, formatStyle });
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    assertContact(value, `DOCX ${formatStyle}`);
  });
}

test("the check bites: a profile whose email is 'Gmail' fails it on both files", async () => {
  const broken = { ...payload, profile: { ...profile, email: "Gmail" } };
  const pdf = await extractPdfText(buildCvPdf(broken));
  const docx = (await mammoth.extractRawText({ buffer: Buffer.from(await buildCvDocx(broken)) })).value;
  assert.throws(() => assertContact(pdf, "PDF"));
  assert.throws(() => assertContact(docx, "DOCX"));
});

// ── Upload side: the link target, not the label ─────────────────────────────

const BODY = [
  "PROFESSIONAL SUMMARY",
  "Software engineer with two years building TypeScript services and React interfaces.",
  "EXPERIENCE",
  "Software Engineer | Example Logistics | Jan 2023 - Present",
  "Built a delivery tracking service in Node.js handling 40,000 events a day.",
];

test("upload (.docx): an email link labelled 'Gmail' is read as the address behind it", async () => {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun("Alex Tester")] }),
        new Paragraph({
          children: [
            new TextRun("London | "),
            new ExternalHyperlink({ link: "mailto:alex.tester@example.com", children: [new TextRun("Gmail")] }),
            new TextRun(" | "),
            new ExternalHyperlink({ link: "https://www.linkedin.com/in/alex-tester", children: [new TextRun("LinkedIn")] }),
          ],
        }),
        ...BODY.map((line) => new Paragraph({ children: [new TextRun(line)] })),
      ],
    }],
  });
  const bytes = new Uint8Array(await Packer.toBuffer(doc));
  const { text, kind } = await parseCvFile(bytes, "cv.docx");
  assert.equal(kind, "docx");
  assert.match(text, /London \| alex\.tester@example\.com \| LinkedIn: linkedin\.com\/in\/alex-tester/);
  assert.ok(!/\bGmail\b/.test(text), "the label is gone");
});

test("upload (PDF): an email link labelled 'Gmail' is read as the address behind it", async () => {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  pdf.setFontSize(11);
  pdf.text("Alex Tester", 72, 72);
  pdf.text("London |", 72, 90);
  pdf.textWithLink("Gmail", 120, 90, { url: "mailto:alex.tester@example.com" });
  pdf.text("|", 152, 90);
  pdf.textWithLink("GitHub", 160, 90, { url: "https://github.com/alextester" });
  BODY.forEach((line, i) => pdf.text(line, 72, 120 + i * 16));
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  const { text, kind } = await parseCvFile(bytes, "cv.pdf");
  assert.equal(kind, "pdf");
  assert.match(text, /alex\.tester@example\.com/);
  assert.match(text, /GitHub: github\.com\/alextester/);
  assert.ok(!/\bGmail\b/.test(text), "the label is gone");
});
