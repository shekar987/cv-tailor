// The header tagline for five sample postings, both styles, frozen (Chunk 2,
// 24 Oct 2026). One synthetic candidate: held "Full Stack Engineer", two
// years answered, a registry with a project-level and a learning skill and a
// junk label entry, and a saved tagline copied from a skills line. Every
// expected line was read and checked by hand before it was frozen; change one
// only when the header is meant to change.
//
// Beyond the strings, every line must be: one line, at most
// MAX_TAGLINE_CHARS, free of skills group labels and of repeated brackets —
// and on the real PDF (lib/buildCvPdf, the download's own layout, read back
// with unpdf) it must sit on a single printed row.
import test from "node:test";
import assert from "node:assert/strict";
import { buildHeadline, MAX_TAGLINE_CHARS } from "../src/lib/headline.ts";
import { coreTitle, titleAsIdentity } from "../src/lib/roleTitle.ts";
import { buildCvPdf } from "../src/lib/buildCvPdf.ts";
import { UKJI } from "../src/lib/formatStyles/ukji.ts";
import { CAREERSET } from "../src/lib/formatStyles/careerset.ts";

const claims = {
  skills: [
    ...["Python", "FastAPI", "React", "TypeScript", "PostgreSQL", "AWS", "Docker"].map((name) => ({ name, level: "production" })),
    { name: "LangChain", level: "project" },
    { name: "Kubernetes", level: "learning" },
    { name: "Languages & Frameworks: Python", level: "production" },
  ],
};
const heldTitles = ["Full Stack Engineer", "Software Developer Intern"];
const candidate = {
  claims,
  yearsExperience: 2,
  heldTitles,
  savedTagline: "Languages & Frameworks: Python, React | Full Stack Engineer (Python, FastAPI) (Python, FastAPI)",
};

type Jd = { title: string; required: string[]; keywords: string[]; variant?: string; ukji: string; careerset: string };
const JDS: Jd[] = [
  {
    title: "Software Engineer (AI/Backend)",
    required: ["Python", "FastAPI", "AWS", "LangChain"],
    keywords: ["Docker", "PostgreSQL"],
    ukji: "Software Engineer · 2 years' experience · Python, FastAPI, AWS",
    careerset: "Software Engineer | 2 years' experience | Python, FastAPI, AWS",
  },
  {
    // Senior: never the candidate's identity — their own role instead.
    title: "Senior Data Engineer - London",
    required: ["SQL", "Python", "Kubernetes"],
    keywords: ["AWS", "Airflow"],
    ukji: "Full Stack Engineer · 2 years' experience · Python, AWS",
    careerset: "Full Stack Engineer | 2 years' experience | Python, AWS",
  },
  {
    // A title they have held (developer ≡ engineer) is their identity.
    title: "Full Stack Developer",
    required: ["React", "TypeScript", "Node.js"],
    keywords: ["PostgreSQL", "Docker"],
    ukji: "Full Stack Developer · 2 years' experience · React, TypeScript, PostgreSQL",
    careerset: "Full Stack Developer | 2 years' experience | React, TypeScript, PostgreSQL",
  },
  {
    // The 30 Sep case: the posting's long title never reaches the header.
    title: "Python Developer - Data & Analytics Team - Options Market Making",
    required: ["Python", "pandas", "SQL"],
    keywords: ["AWS"],
    ukji: "Full Stack Engineer · 2 years' experience · Python, AWS",
    careerset: "Full Stack Engineer | 2 years' experience | Python, AWS",
  },
  {
    // A positioning variant whose headline lists tools in a bracket: the
    // role stays, the tools move to the one stack phrase.
    title: "Machine Learning Engineer",
    required: ["Python", "LangChain", "PyTorch"],
    keywords: ["FastAPI", "Docker", "AWS"],
    variant: "AI engineer (Python, FastAPI, LLM pipelines)",
    ukji: "AI engineer · 2 years' experience · Python, FastAPI, Docker",
    careerset: "AI engineer | 2 years' experience | Python, FastAPI, Docker",
  },
];

function taglineFor(jd: Jd, render: { headlineSeparator: string }): string {
  const core = coreTitle(jd.title);
  return buildHeadline(
    {
      ...candidate,
      requiredSkills: jd.required,
      keywords: jd.keywords,
      identityTitle: titleAsIdentity(core, heldTitles) ? core : null,
      positioning: jd.variant ?? null,
    },
    render
  ).headline;
}

const GROUP_LABEL = /(?:languages|frameworks|databases|ai & llm|cloud & devops|testing|technical tools|competencies|skills|tech stack)\s*:/i;
function assertClean(line: string, where: string) {
  assert.ok(line.length > 0, `${where}: empty`);
  assert.ok(!/[\r\n]/.test(line), `${where}: more than one line`);
  assert.ok(line.length <= MAX_TAGLINE_CHARS, `${where}: ${line.length} chars`);
  assert.ok(!GROUP_LABEL.test(line), `${where}: a skills group label`);
  const brackets = [...line.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].toLowerCase().replace(/\s+/g, " ").trim());
  assert.equal(new Set(brackets).size, brackets.length, `${where}: a repeated bracket`);
  assert.ok(!/\b(?:LangChain|Kubernetes)\b/.test(line), `${where}: a project or learning skill headlined`);
  assert.ok(!/\bproduction\b/i.test(line), `${where}: "production" is not in the answer`);
}

for (const jd of JDS) {
  test(`tagline snapshot: ${jd.title}`, () => {
    const u = taglineFor(jd, UKJI.render);
    const c = taglineFor(jd, CAREERSET.render);
    assert.equal(u, jd.ukji);
    assert.equal(c, jd.careerset);
    assertClean(u, "UKJI");
    assertClean(c, "CareerSet");
  });
}

// The printed check: the tagline is one row of the real PDF. A short CV gets
// the roomiest spacing (lib/cvDensity), i.e. the widest margins and the
// narrowest text column — the hardest case for one line.
async function pdfRows(bytes: Uint8Array): Promise<string[]> {
  const { getDocumentProxy, extractTextItems } = await import("unpdf");
  const doc = await getDocumentProxy(bytes.slice());
  const { items } = await extractTextItems(doc);
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of items[0] as unknown as { str: string; x: number; y: number }[]) {
    const key = Math.round(it.y);
    rows.set(key, [...(rows.get(key) ?? []), { x: it.x, s: it.str }]);
  }
  return [...rows.values()].map((r) => r.sort((a, b) => a.x - b.x).map((p) => p.s).join(" "));
}
const squash = (s: string) => s.replace(/\s+/g, "");

function cvWith(tagline: string): Uint8Array {
  return buildCvPdf({
    profile: { name: "Alex Tester", tagline, email: "alex.tester@example.com", phone: "+44 7700 900123", location: "London, UK" },
    summary: "Software engineer with two years building Python services.",
    targetPages: 2,
  });
}

test("every snapshot tagline prints on one row of the real PDF", async () => {
  for (const jd of JDS) {
    for (const line of [jd.ukji, jd.careerset]) {
      const rows = await pdfRows(cvWith(line));
      assert.ok(rows.some((r) => squash(r).includes(squash(line))), `"${line}" wrapped:\n${rows.join("\n")}`);
    }
  }
});

test(`a tagline at the ${MAX_TAGLINE_CHARS}-character cap still prints on one row`, async () => {
  const widest = "Senior Machine Learning Platform Infrastructure Engineer · 12 years' experience · AWS";
  const padded = (widest + " · PostgreSQL, TypeScript, AWS").slice(0, MAX_TAGLINE_CHARS).trim();
  assert.equal(padded.length >= MAX_TAGLINE_CHARS - 1, true);
  const rows = await pdfRows(cvWith(padded));
  assert.ok(rows.some((r) => squash(r).includes(squash(padded))), `"${padded}" wrapped:\n${rows.join("\n")}`);
});
