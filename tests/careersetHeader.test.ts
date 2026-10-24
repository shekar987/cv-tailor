// The CareerSet header (lib/formatStyles): the headline's slots and
// separator, the CV-voice availability sentence, the contact line's pieces
// as the three renderers draw them, and the fact check's furniture hook.
// Each test also pins the UKJI path to what it always was.
import test from "node:test";
import assert from "node:assert/strict";
import { buildHeadline, topProductionSkills, topProductionSkill, CAREERSET_HEADLINE_TOOLS, HEADLINE_SEP } from "../src/lib/headline.ts";
import { availabilityCvSentence, type RtwFacts } from "../src/lib/rightToWorkText.ts";
import { prepareCvDocument, contactPieces, contactRowText, contactRowLines } from "../src/lib/cvDocument.ts";
import { normalizeProfile } from "../src/lib/profile.ts";
import { estimatePages } from "../src/lib/quality.ts";
import { supportSentences } from "../src/lib/supportCheck.ts";
import { RENDER_OPTIONS } from "../src/lib/formatStyles/ids.ts";
import { CAREERSET } from "../src/lib/formatStyles/careerset.ts";
import { UKJI } from "../src/lib/formatStyles/ukji.ts";

const claims = {
  skills: [
    { name: "Python", level: "production" },
    { name: "FastAPI", level: "production" },
    { name: "React", level: "production" },
    { name: "TypeScript", level: "production" },
    { name: "AWS", level: "production" },
    { name: "PostgreSQL", level: "production" },
    { name: "LangChain", level: "project" },
    { name: "Kubernetes", level: "learning" },
  ],
};
const base = {
  education: [{ degree: "MSc Computer Science", dates: "Jan 2025 – Jan 2027" }],
  claims,
  requiredSkills: ["Python", "LangChain", "FastAPI", "Kubernetes", "React"],
  keywords: ["TypeScript", "AWS", "PostgreSQL", "Docker"],
  yearsExperience: 2,
  positioning: null,
  roleFamily: "Full Stack & AI Engineer",
};

test("CareerSet headline: positioning | years | up to five production tools in posting order, ' | ' between slots", () => {
  const { headline, parts } = buildHeadline(base, CAREERSET.render);
  assert.equal(headline, "Full Stack & AI Engineer | 2 years' experience | Python · FastAPI · React · TypeScript · AWS");
  assert.equal(parts.qualification, "", "no qualification slot in this style");
  assert.deepEqual(topProductionSkills(claims, base.requiredSkills, base.keywords, CAREERSET_HEADLINE_TOOLS), ["Python", "FastAPI", "React", "TypeScript", "AWS"], "LangChain (project) and Kubernetes (learning) never headline; the sixth production term is cut");
  // The variant's own headline outranks the tagline's role family.
  assert.equal(buildHeadline({ ...base, positioning: "Backend engineer (Python, FastAPI)" }, CAREERSET.render).headline.split(" | ")[0], "Backend engineer (Python, FastAPI)");
  // Empty slots are left out, never a dangling separator.
  assert.equal(buildHeadline({ ...base, yearsExperience: null }, CAREERSET.render).headline, "Full Stack & AI Engineer | Python · FastAPI · React · TypeScript · AWS");
  assert.equal(buildHeadline({ ...base, claims: null, yearsExperience: 0 }, CAREERSET.render).headline, "Full Stack & AI Engineer");
  assert.equal(buildHeadline({ ...base, roleFamily: null, claims: null, yearsExperience: null }, CAREERSET.render).headline, "");
  assert.equal(buildHeadline({ ...base, roleFamily: "  Full  Stack   Engineer " }, CAREERSET.render).headline.split(" | ")[0], "Full Stack Engineer");
});

test("UKJI headline is untouched: the same slots, ' · ', the role family ignored", () => {
  const u = buildHeadline(base, UKJI.render);
  assert.equal(u.headline, "MSc Computer Science (in progress, expected 2027) · Python · 2 years' experience");
  assert.equal(buildHeadline(base).headline, u.headline, "no render = UKJI");
  assert.equal(UKJI.render.headlineSeparator, HEADLINE_SEP);
  assert.equal(topProductionSkill(claims, base.requiredSkills, base.keywords), "Python");
  assert.equal(topProductionSkill(null, base.requiredSkills, base.keywords), null);
});

const elig = (availability: RtwFacts["availability"], canWorkFullTime: RtwFacts["canWorkFullTime"]): RtwFacts => ({
  rightToWork: { status: "full", countries: ["UK"], permissionEnds: null },
  availability,
  canWorkFullTime,
});

test("availabilityCvSentence: the CV voice, from Eligibility alone, nothing when unanswered", () => {
  assert.equal(availabilityCvSentence(elig({ status: "now", from: null }, "yes")), "Available immediately for full-time employment.");
  assert.equal(availabilityCvSentence(elig({ status: "from", from: "2027-01" }, "yes")), "Available from January 2027 for full-time employment.");
  assert.equal(availabilityCvSentence(elig({ status: "now", from: null }, "no")), "Available immediately for part-time employment.");
  assert.equal(availabilityCvSentence(elig({ status: "now", from: null }, "unknown")), "Available immediately.");
  assert.equal(availabilityCvSentence(elig({ status: "unknown", from: null }, "yes")), null);
  assert.equal(availabilityCvSentence(elig({ status: "from", from: null }, "yes")), null, "a start with no month is no answer");
});

const profile = normalizeProfile({
  name: "Jane Doe", tagline: "Backend Engineer", location: "London, UK", phone: "+44 7000 000000",
  email: "jane@example.com", linkedin: "linkedin.com/in/jane", github: "https://github.com/jane", website: "jane.dev",
  education: [], certifications: [], rightToWork: [], projects: [], extraSections: [],
});
const input = { profile, summary: "S.", skills: "", experience: "", projects: {}, projectsMeta: [], targetPages: 2 as const };

// The label mode is still code (contactPieces honours it); since 24 Oct no
// style uses it — both print addresses (lib/formatStyles ids).
const LABELS = { ...RENDER_OPTIONS.ukji, contactLinks: "labels" as const };

test("contact pieces: both styles print the addresses, still linked; the separators follow the style", () => {
  const u = prepareCvDocument(input);
  assert.equal(u.render, RENDER_OPTIONS.ukji);
  assert.deepEqual(u.contactPieces, [
    { text: "London, UK", link: null },
    { text: "+44 7000 000000", link: null },
    { text: "jane@example.com", link: "mailto:jane@example.com" },
    { text: "linkedin.com/in/jane", link: "https://linkedin.com/in/jane" },
    { text: "github.com/jane", link: "https://github.com/jane" },
    { text: "jane.dev", link: "https://jane.dev" },
  ]);
  assert.equal(contactRowText(u.contactPieces, u.render), "London, UK · +44 7000 000000 · jane@example.com · linkedin.com/in/jane · github.com/jane · jane.dev");
  assert.equal(contactRowLines(u.contactPieces, u.render), 2, "printed addresses run to a second line in UKJI too");
  assert.deepEqual(contactPieces(u.contact, LABELS).slice(3).map((p) => p.text), ["LinkedIn", "GitHub", "Portfolio"], "the label mode, unused, still works");
  assert.equal(contactRowLines(contactPieces(u.contact, LABELS), LABELS), 1);
  const c = prepareCvDocument({ ...input, formatStyle: "careerset" });
  assert.equal(c.render, RENDER_OPTIONS.careerset);
  assert.deepEqual(c.contactPieces.slice(3), [
    { text: "linkedin.com/in/jane", link: "https://linkedin.com/in/jane" },
    { text: "github.com/jane", link: "https://github.com/jane" },
    { text: "jane.dev", link: "https://jane.dev" },
  ]);
  assert.equal(contactRowText(c.contactPieces, c.render), "London, UK | +44 7000 000000 | jane@example.com | linkedin.com/in/jane | github.com/jane | jane.dev");
  assert.equal(contactRowLines(c.contactPieces, c.render), 2, "99 characters of printed addresses run to a second printed line");
  const shortProfile = normalizeProfile({ ...profile, phone: "", website: "" });
  const s = prepareCvDocument({ ...input, profile: shortProfile, formatStyle: "careerset" });
  assert.equal(contactRowText(s.contactPieces, s.render), "London, UK | jane@example.com | linkedin.com/in/jane | github.com/jane");
  assert.equal(contactRowLines(s.contactPieces, s.render), 1, "70 characters fit one printed line");
  const longProfile = normalizeProfile({ ...profile, linkedin: "linkedin.com/in/jane-doe-the-very-long-handle-for-a-test", website: "jane-doe-portfolio-site-with-a-long-name.vercel.app" });
  const long = prepareCvDocument({ ...input, profile: longProfile, formatStyle: "careerset" });
  assert.equal(contactRowLines(long.contactPieces, long.render), 2, "printed addresses that run past a line are counted");
  assert.equal(contactRowLines(contactPieces(prepareCvDocument({ ...input, profile: longProfile }).contact, LABELS), LABELS), 1, "labels: one line, as always");
  assert.deepEqual(contactPieces({ ...u.contact, location: "", phone: "", email: "", linkedin: "", github: "", website: "", hasRow: false }, RENDER_OPTIONS.careerset), []);
  assert.deepEqual(prepareCvDocument({ ...input, formatStyle: "nope" }).render, RENDER_OPTIONS.ukji, "an unknown style is UKJI");
});

test("estimatePages counts the printed contact row the same way", () => {
  const longProfile = { ...profile, linkedin: "linkedin.com/in/jane-doe-the-very-long-handle-for-a-test", website: "jane-doe-portfolio-site-with-a-long-name.vercel.app" };
  const sections = { summary: "S.", skills: "", experience: "", projects: {} };
  const labels = estimatePages(sections, longProfile, 2, LABELS);
  const addresses = estimatePages(sections, longProfile, 2, RENDER_OPTIONS.careerset);
  assert.equal(addresses.bodyLines, labels.bodyLines + 1);
  assert.equal(estimatePages(sections, longProfile, 2, RENDER_OPTIONS.ukji).bodyLines, addresses.bodyLines, "UKJI prints addresses too");
  assert.equal(estimatePages(sections, longProfile, 2).bodyLines, addresses.bodyLines, "the default is UKJI's");
});

test("supportSentences skips a style's furniture in the summary and the letter, and nothing else", () => {
  const summary = "Full stack engineer with two years at Brane.\nAvailable immediately for full-time employment.";
  const letter = "Dear Acme Hiring Team,\nI am applying for the Engineer role at Acme. I am particularly interested in this role because Acme builds payment rails.\nHaving read the job description, these are the four areas where I can add value from the start:\n1. Python: I built services in Python at Brane.\nKind regards,\nJane";
  const furniture = [...CAREERSET.letter.furniture, /^Available immediately for full-time employment\.$/];
  const got = supportSentences(summary, letter, { projects: [], paidWork: "", furniture });
  assert.deepEqual(got.map((s) => s.sentence), [
    "Full stack engineer with two years at Brane.",
    "I am applying for the Engineer role at Acme.",
    "1.",
    "Python: I built services in Python at Brane.",
  ]);
  const plain = supportSentences(summary, letter, { projects: [], paidWork: "" });
  assert.equal(plain.length, got.length + 3, "without the hook every sentence is checked, as UKJI does");
});
