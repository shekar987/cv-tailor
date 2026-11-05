// The owner's triage rules of 2 Nov 2026 (lib/triage/jdTriage, lib/knockouts):
// right to work a time-limited visa cannot give, and a language or framework the
// CV's work experience does not show. The Sonos and Flexera fixtures carry those
// postings' own wording; the CV is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { triageJd, buildTriageProfile, masterExperienceText, type TriageProfile } from "../src/lib/triage/jdTriage.ts";
import { detectGates, compareGates, normalizeEligibility } from "../src/lib/knockouts.ts";

const CV = `Alex Morgan
London | alex.morgan@example.com

PROFESSIONAL SUMMARY
Full stack engineer with two years of production experience.

EXPERIENCE
Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024
• Built customer web apps in React and TypeScript used by 40,000 people a month.
• Built Python FastAPI services on PostgreSQL behind those apps.
• Currently learning Rust on the job to read the team's parsers.

PROJECTS
RideX (personal portfolio project)
• Built a booking service in Node.js and Next.js.

SKILLS
Languages: Python, TypeScript, JavaScript
Currently learning: Go, Kotlin
`;

// Their answer as they described it: Student visa to May 2027, then Graduate Route.
const ELIGIBILITY = { rightToWork: { status: "time_limited", countries: ["United Kingdom"], permissionEnds: "2027-05" }, yearsExperience: 2 };
const OWNER = buildTriageProfile(ELIGIBILITY, CV) as TriageProfile;

const SONOS = `Software Engineer - Web and Marketing | Sonos | Glasgow (hybrid, 3 days in office) | Full time | Req R2850

What You'll Do
- Build and maintain responsive web features for the Sonos Pro storefront using React and Next.js.

Basic Qualifications
- Approximately two years of relevant software development experience, or equivalent practical experience delivering web applications.
- Working proficiency in JavaScript or TypeScript, HTML, CSS, and React.
- Familiarity with Next.js or a comparable modern web framework and responsive component development.

Preferred Qualifications
- Sanity or another headless CMS; Braze / lifecycle marketing integrations.

Visa Sponsorship: Sonos is unable to sponsor or take over sponsorship of an employment visa for this role at this time. Applicants must be authorized to work in the country of the role posting, both now and in the future.`;

const FLEXERA = `Fullstack Engineer | Flexera | Bracknell (hybrid) | Full time | Req 17461

About the Role
Develop customer-facing applications with React and TypeScript while designing backend services and APIs in Go (Golang).

Required Skills & Experience
- 2+ years of professional software engineering experience
- Strong React and TypeScript development experience
- Experience building backend services with Go (Golang) - at least 1 year

Nice to Have
gRPC and Protocol Buffers; MongoDB; AWS; Kubernetes and container orchestration.`;

const skips = (jd: string, p: TriageProfile | undefined = OWNER) => triageJd(jd, p).hits.filter((h) => h.level === "skip");

test("Sonos: now-and-future right to work, no sponsorship → Skip, on that exact sentence", () => {
  const t = triageJd(SONOS, OWNER);
  assert.equal(t.verdict, "skip");
  assert.deepEqual(t.reasons, ["authorized to work in the country of the role posting, both now and in the future"]);
  const hit = t.hits.find((h) => h.rule === "rtw_permanent");
  assert.equal(hit?.sentence, "Applicants must be authorized to work in the country of the role posting, both now and in the future.");
});

test("Flexera: 1+ year of Go required, not in the CV's experience → Skip, on that exact sentence", () => {
  const t = triageJd(FLEXERA, OWNER);
  assert.equal(t.verdict, "skip");
  assert.deepEqual(t.reasons, ["Go (not in your experience)"]);
  assert.equal(t.hits.find((h) => h.rule === "tech_required")?.sentence, "Experience building backend services with Go (Golang) - at least 1 year");
});

test("the right-to-work Skips for a time-limited visa, each with its sentence", () => {
  for (const [jd, rule] of [
    ["You must have the right to work in the UK now and in the future.", "rtw_permanent"],
    ["We will not sponsor now or in the future.", "sponsorship"],
    ["Candidates need unrestricted right to work in the UK.", "rtw_permanent"],
    ["You must hold permanent right to work.", "rtw_permanent"],
    ["Applicants must have indefinite leave to remain.", "rtw_permanent"],
    ["British citizenship required.", "rtw_permanent"],
    ["You must be a British citizen.", "rtw_permanent"],
  ]) {
    const [hit] = skips(jd);
    assert.equal(hit?.rule, rule, jd);
    assert.equal(hit?.sentence, jd, "the exact sentence is kept");
  }
});

test("needing sponsorship is the same Skip; full right to work meets them; unanswered is a Review, never guessed", () => {
  const jd = "You must have the right to work in the UK now and in the future.";
  assert.equal(triageJd(jd, { rightToWork: "needs_sponsorship" }).verdict, "skip");
  assert.equal(triageJd(jd, { rightToWork: "full" }).verdict, "apply");
  assert.equal(triageJd(jd, { rightToWork: null }).verdict, "review");
  assert.equal(triageJd(jd).verdict, "review");
  // Full right to work need not mean citizenship: still its own question.
  assert.equal(triageJd("British citizenship required.", { rightToWork: "full" }).verdict, "review");
});

test("not a knockout: at this time, a question, an alternative, a negation", () => {
  for (const jd of [
    "We are unable to sponsor visas at this time.",
    "Will you now or in the future require sponsorship?",
    "You must hold British citizenship, indefinite leave to remain or a valid work visa.",
    "British citizenship is not required for this role.",
    "You do not need indefinite leave to remain.",
    "Our customers include UK nationals and overseas residents.",
  ]) {
    assert.equal(skips(jd).length, 0, jd);
    assert.ok(!triageJd(jd, OWNER).hits.some((h) => h.rule === "rtw_permanent"), jd);
  }
});

test("right to work for the full duration of a scheme → Review, and its length is no years requirement", () => {
  // A start and a length the posting states, past the permission's end: a Skip
  // since 5 Nov (the owner's call), and covered by chunk17Guards.test.ts.
  const dated = triageJd("You must have the right to work in the UK for the full duration of the 2-year scheme starting September 2027.", OWNER);
  assert.equal(dated.verdict, "skip");
  assert.deepEqual(dated.hits.map((h) => h.rule), ["rtw_programme"]);
  for (const jd of [
    "Applicants must have the right to work in the UK for the entire duration of the 2 year graduate programme.",
    "Right to work: You must have the right to work in the UK for the length of the residency.",
  ]) {
    const t = triageJd(jd, OWNER);
    assert.equal(t.verdict, "review", jd);
    assert.deepEqual(t.hits.map((h) => h.rule), ["rtw_duration"], jd);
    assert.equal(t.hits[0].sentence, jd);
  }
  assert.equal(triageJd("You must have the right to work for the full duration of the scheme.", { rightToWork: "full" }).verdict, "apply");
});

test("a required language or framework the experience does not show → Skip; N+ years of X too", () => {
  assert.deepEqual(triageJd("Requirements\n- Strong Kotlin in production", OWNER).reasons, ["Kotlin (not in your experience)"]);
  assert.deepEqual(triageJd("Essential\n- Commercial Django", OWNER).reasons, ["Django (not in your experience)"]);
  assert.deepEqual(triageJd("Responsibilities\n- You will own services.\n- 1+ year of Rust", OWNER).reasons, ["Rust (not in your experience)"]);
  assert.equal(triageJd("Requirements\n- Java or Kotlin", OWNER).verdict, "skip", "every option is missing");
  assert.equal(triageJd("Backend Engineer\nYou'll have strong Scala experience.", OWNER).verdict, "skip", "a requirement cue with no heading");
  assert.equal(triageJd("Backend Engineer\nExperience with Scala.", OWNER).verdict, "skip", "no headings at all");
});

test("'Currently learning: X' is not experience; a project is not either; the CV's real experience passes", () => {
  const exp = masterExperienceText(CV) ?? "";
  assert.doesNotMatch(exp, /Rust/, "a role's 'currently learning' line is dropped");
  assert.doesNotMatch(exp, /\bGo\b|Kotlin/, "the skills list's learning line is not experience");
  assert.doesNotMatch(exp, /Node\.js/, "a project is not work experience");
  assert.equal(triageJd("Requirements\n- Experience with Go", OWNER).verdict, "skip");
  assert.equal(triageJd("Requirements\n- Experience with Rust", OWNER).verdict, "skip");
  assert.equal(triageJd("Requirements\n- Experience with Node.js", OWNER).verdict, "skip");
  for (const jd of ["Requirements\n- Strong Python", "Requirements\n- FastAPI and PostgreSQL", "Requirements\n- React and TypeScript", "Requirements\n- JavaScript"]) {
    assert.equal(triageJd(jd, OWNER).verdict, "apply", jd);
  }
});

test("a language or framework on a Desirable list → Review, with its sentence", () => {
  const t = triageJd("Nice to have\n- Experience with Go", OWNER);
  assert.equal(t.verdict, "review");
  assert.deepEqual(t.reasons, ["Go (desirable, not in your experience)"]);
  assert.equal(t.hits[0].sentence, "Experience with Go");
  assert.equal(triageJd("Desirable\n- Kotlin", OWNER).verdict, "review");
  assert.equal(triageJd("Requirements\n- C++ experience is an advantage.", OWNER).verdict, "review");
  assert.equal(triageJd("Desirable\n- Python", OWNER).verdict, "apply", "they have it");
});

test("options and examples: one the CV has is enough; 'or similar' is at most a Review", () => {
  for (const jd of [
    "Requirements\n- Python or Java",
    "Requirements\n- Python/Java",
    "Requirements\n- Strong programming skills in Python, Java, Go,",
    "Requirements\n- Languages such as Python, Go or Rust",
  ]) {
    assert.equal(triageJd(jd, OWNER).verdict, "apply", jd);
  }
  for (const jd of [
    "Requirements\n- Django (or equiv. web framework)",
    "Requirements\n- Exposure to Golang (Go) or another backend programming language",
    "Requirements\n- Some experience with strongly-typed languages (Go, Java, Scala etc.)",
    "Requirements\n- ML fundamentals, PyTorch, LLM systems or evals.",
  ]) {
    assert.equal(triageJd(jd, OWNER).verdict, "review", jd);
  }
});

test("the same words outside a requirement, or not as a technology, are nothing", () => {
  for (const jd of [
    "What You'll Do\n- Design Go microservices with the team.",
    "About us\nOur app is 100% Kotlin.",
    "Requirements\n- Go-to-market awareness",
    "Requirements\n- Go above and beyond for customers",
    "Requirements\n- Available for our Spring 2027 intake",
    "Requirements\n- Experience with CI/CD",
  ]) {
    assert.equal(triageJd(jd, OWNER).verdict, "apply", jd);
  }
});

test("with no CV experience the language rule stays off: never a Skip for every posting", () => {
  assert.equal(masterExperienceText("Alex Morgan\nNo sections here."), undefined);
  assert.equal(masterExperienceText(null), undefined);
  const noCv = buildTriageProfile(ELIGIBILITY, "");
  assert.equal(noCv?.experience, undefined);
  assert.equal(skips("Requirements\n- Experience with Go", noCv).length, 0);
});

test("a long Desirable list cannot crowd out a Skip further down", () => {
  const nice = ["Go", "Kotlin", "Scala", "Rust", "Ruby", "PHP", "Swift", "Elixir", "Haskell", "Perl", "Dart", "Lua", "Django", "Flask", "Laravel", "Angular", "Vue", "Svelte"];
  const t = triageJd(`Nice to have\n${nice.map((n) => `- ${n}`).join("\n")}\nEssential\n- 6+ years of engineering`, OWNER);
  assert.equal(t.verdict, "skip");
  assert.equal(t.hits[0].rule, "years");
  assert.ok(t.hits.length <= 16);
});

test("the knockout gates read the same answer: hard on now-and-future, soft on 'at this time'", () => {
  const e = normalizeEligibility(ELIGIBILITY);
  const verdicts = (jd: string) => compareGates(detectGates(jd), e).filter((v) => v.gate.category === "sponsorship").map((v) => v.verdict);
  assert.deepEqual(verdicts("Applicants must be authorized to work in the country of the role posting, both now and in the future."), ["hard"]);
  assert.deepEqual(verdicts("We will not sponsor now or in the future."), ["hard"]);
  assert.deepEqual(verdicts("Candidates need unrestricted right to work in the UK."), ["hard"]);
  assert.deepEqual(verdicts("We cannot sponsor visas at this time."), ["soft"]);
  const reason = compareGates(detectGates("You must have the right to work in the UK now and in the future."), e)[0].reason;
  assert.match(reason, /until May 2027/, "the gate uses the month they typed");
  // Nothing changes for a full right to work, and unanswered stays unknown.
  const full = normalizeEligibility({ rightToWork: { status: "full", countries: ["United Kingdom"] } });
  assert.deepEqual(compareGates(detectGates("You must have the right to work in the UK now and in the future."), full).map((v) => v.verdict), ["pass"]);
  const unset = normalizeEligibility({ rightToWork: { status: "unknown" } });
  assert.deepEqual(compareGates(detectGates("You must have the right to work in the UK now and in the future."), unset).map((v) => v.verdict), ["unknown"]);
});
