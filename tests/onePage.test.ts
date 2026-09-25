import test from "node:test";
import assert from "node:assert/strict";
import { fitOnePage, fitTwoPages, experienceRefillCandidates, projectRefillCandidates, capSummaryWords, bulletRelevance, leftOutCount, REFILL_DENSITIES, ONE_PAGE_ROLE_CAP_FIRST, ONE_PAGE_ROLE_CAP_REST, type RefillCandidate } from "../src/lib/onePage.ts";
import { parseMasterExperience } from "../src/lib/bulletIds.ts";
import { estimatePages } from "../src/lib/quality.ts";

const terms = { keywords: ["React", "TypeScript", "AWS", "PostgreSQL", "CI/CD"], required: ["React", "Node.js"] };

const bullet = (i: number, extra = "") => `Delivered improvement ${i} to the internal platform used across the business${extra}.`;
const role = (title: string, n: number, mk: (i: number) => string) =>
  [`${title} | Acme | Jan 2023 – Present`, ...Array.from({ length: n }, (_, i) => `• ${mk(i)}`)].join("\n");

const profile = {
  name: "Test Candidate",
  email: "tc@example.com",
  education: [{ degree: "MSc Computer Science", institution: "University", dates: "2025", note: "" }],
  certifications: ["AWS Certified Cloud Practitioner"],
  projects: [{ name: "Jobhuntz", tech: "Next.js, Supabase" }, { name: "RideX", tech: "React Native" }],
};

test("bulletRelevance: required skill > keyword > evidence > nothing", () => {
  const req = bulletRelevance("Built the checkout in React and Node.js.", terms);
  const kw = bulletRelevance("Deployed the service on AWS.", terms);
  const ev = bulletRelevance("Cut build time by 40%.", terms);
  const none = bulletRelevance("Worked with the team on the platform.", terms);
  assert.ok(req > kw && kw > ev && ev > none, `${req} ${kw} ${ev} ${none}`);
});

test("capSummaryWords keeps whole leading sentences within 60 words; the first always stays", () => {
  const s = [
    "Full Stack Engineer with two years building AI-enabled services at Brane Group, shipping 20+ API modules for real customers.",
    "Cut frontend load time by 20% and led the migration to Next.js across three product surfaces used by thousands of people every week, with zero regressions reported.",
    "Built Jobhuntz, a Next.js and Supabase CV tool with 90+ automated tests and a real PDF text layer.",
  ].join("\n");
  const r = capSummaryWords(s);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0], /^Built Jobhuntz/);
  assert.equal(r.summary, s.split("\n").slice(0, 2).join("\n"));
  const short = "One short line.\nAnother short line.";
  assert.deepEqual(capSummaryWords(short), { summary: short, dropped: [] });
  const oneLong = Array.from({ length: 80 }, () => "word").join(" ") + ".";
  assert.equal(capSummaryWords(oneLong).summary, oneLong, "a single sentence is never dropped");
});

test("fitOnePage: caps roles (4 then 3) and projects (2) by relevance, then trims the least relevant until one page fits", () => {
  const experience = [
    role("Engineer", 7, (i) => (i === 5 ? "Built the dashboard in React and Node.js for 3,000 users" : i === 6 ? "Reduced AWS costs by 30%" : bullet(i))),
    "",
    role("Intern", 5, (i) => (i === 4 ? "Wrote TypeScript services with CI/CD pipelines" : bullet(i + 10))),
    "",
    role("Research Assistant", 4, (i) => bullet(i + 20)),
  ].join("\n");
  const projects = { "0": ["Built a RAG pipeline in React.", bullet(30), bullet(31)], "1": [bullet(40)] };
  const summary = "Software Engineer with two years of experience.\nShipped 20+ API modules.\nBuilt Jobhuntz.";
  const skills = "**Functional Competencies:** APIs | Testing\n**Technical Tools:** Python | FastAPI | React | TypeScript | PostgreSQL | Docker | AWS | Redis | Kafka | Terraform | Grafana | Jenkins | Ansible | Vault | Consul";
  const { sections, report } = fitOnePage({ summary, skills, experience, projects }, profile, terms);

  // Caps: the relevant bullets survive, the generic ones go first.
  const exp = String(sections.experience);
  const roleBlocks = exp.split(/\n(?=[A-Z][^\n|]* \| )/);
  const count = (block: string) => (block.match(/^• /gm) ?? []).length;
  assert.ok(count(roleBlocks[0]) <= ONE_PAGE_ROLE_CAP_FIRST, roleBlocks[0]);
  assert.ok(count(roleBlocks[1]) <= ONE_PAGE_ROLE_CAP_REST, roleBlocks[1]);
  assert.match(roleBlocks[0], /React and Node\.js/);
  assert.match(roleBlocks[0], /AWS costs by 30%/);
  assert.match(roleBlocks[1], /TypeScript services/);
  assert.ok(exp.includes("Engineer | Acme") && exp.includes("Intern | Acme") && exp.includes("Research Assistant | Acme"), "no role is ever dropped");
  const p = sections.projects as Record<string, string[]>;
  assert.ok(p["0"].length <= 2 && p["0"][0].includes("RAG pipeline"), JSON.stringify(p));
  assert.deepEqual(p["1"], [bullet(40)]);
  // Tools cut to 12, keeping the JD's terms.
  const tools = String(sections.skills).split("\n")[1].split(":**")[1].split("|").map((t) => t.trim());
  assert.equal(tools.length, 12);
  assert.ok(tools.includes("React") && tools.includes("AWS"));
  assert.equal(report.leftOut.tools.length, 3);
  // Report: everything left out is listed with where it came from.
  assert.ok(report.leftOut.experience.every((e) => e.role && e.bullet));
  assert.ok(report.leftOut.experience.some((e) => e.role === "Engineer"));
  assert.equal(leftOutCount(report), report.leftOut.summary.length + 3 + report.leftOut.experience.length + report.leftOut.projects.length);
  assert.equal(report.fits, true, JSON.stringify(report));
  assert.ok(report.pagesAfter <= 1.05 && report.pagesBefore >= report.pagesAfter, `${report.pagesBefore} → ${report.pagesAfter}`);
  assert.equal(estimatePages(sections, profile, 1).fitsOnePage, true);
});

test("fitOnePage: a CV that already fits is returned untouched with nothing left out", () => {
  const sections = { summary: "Engineer.\nShipped things.", skills: "**Technical Tools:** React | Node.js", experience: role("Engineer", 3, bullet), projects: { "0": [bullet(1)] } };
  const { sections: out, report } = fitOnePage(sections, profile, terms);
  assert.deepEqual(out, sections);
  assert.equal(leftOutCount(report), 0);
  assert.equal(report.fits, true);
});

test("fitOnePage: never trims a role below 2 bullets or a project below 1, and says when it still does not fit", () => {
  const long = (i: number) => bullet(i, " — " + Array.from({ length: 60 }, () => "detail").join(" "));
  const experience = ["Engineer", "Intern", "Assistant", "Volunteer", "Tutor", "Analyst", "Fellow", "Mentor"].map((t) => role(t, 4, long)).join("\n\n");
  const projects = { "0": [long(50), long(51)], "1": [long(60), long(61)], "2": [long(70)], "3": [long(80), long(81)] };
  const { sections, report } = fitOnePage({ summary: "Engineer.", skills: "", experience, projects }, profile, terms);
  const exp = String(sections.experience);
  for (const block of exp.split(/\n(?=[A-Z][^\n|]* \| )/)) assert.ok((block.match(/^• /gm) ?? []).length >= 2, block);
  for (const list of Object.values(sections.projects as Record<string, string[]>)) assert.ok(list.length >= 1);
  assert.equal(report.fits, false);
});

// ── Two pages (the default) ──────────────────────────────────────────────────

const masterCv = [
  "EXPERIENCE",
  "",
  "Research Assistant — AI & Full-Stack Development",
  "University of East London — AssetGuard+ · London, UK · Jun 2026 – Present",
  "",
  "- Develop features for AssetGuard+ in React and Node.js used by 40 analysts.",
  "- Analysed 11 industry asset-management platforms from verified user reviews.",
  "",
  "Full Stack Engineer — Brane Group",
  "Jul 2023 – Sep 2024 (full-time)",
  "",
  "- Engineered enterprise web applications in Python, FastAPI, React and TypeScript, delivering 20+ production API modules.",
  "- Built secure FastAPI backend services with JWT authentication and RBAC.",
  "- Optimised data access across PostgreSQL and Redis, cutting query time by 30%.",
  "- Built AI-enabled services including LLM/RAG knowledge solutions.",
  "",
  "Full Stack Development Intern — CodSoft",
  "Jan 2022 – Jun 2022",
  "",
  "- Designed a Student Course Registration System across 4 layers.",
  "- Delivered 9 end-to-end projects solo across 2 GitHub repositories.",
  "",
  "PROJECTS",
].join("\n");

const tailoredExp = [
  "Research Assistant | University of East London | Jun 2026 – Present",
  "• Develop features for AssetGuard+ in React and Node.js used by 40 analysts.",
  "",
  "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024",
  "• Engineered enterprise web applications in Python, FastAPI, React and TypeScript, delivering 20+ production API modules.",
  "• Built secure FastAPI backend services with JWT authentication and RBAC.",
  "",
  "Full Stack Development Intern | CodSoft | Jan 2022 – Jun 2022",
  "• Designed a Student Course Registration System across 4 layers.",
  "• Delivered 9 end-to-end projects solo across 2 GitHub repositories.",
].join("\n");

test("experienceRefillCandidates: the master bullets the tailored text left out, with their role", () => {
  const c = experienceRefillCandidates(tailoredExp, parseMasterExperience(masterCv));
  assert.deepEqual(
    c.map((x) => (x.where === "experience" ? [x.role, x.text.slice(0, 20)] : null)),
    [[1, "Analysed 11 industry"], [2, "Optimised data acces"], [2, "Built AI-enabled ser"]]
  );
});

test("fitTwoPages: restores left-out master bullets under their own role, most relevant first", () => {
  // The route clears candidates with the claims registry first; the RAG
  // bullet (a project-level skill) is what that filter removes.
  const candidates = experienceRefillCandidates(tailoredExp, parseMasterExperience(masterCv)).filter((c) => !/RAG/.test(c.text));
  const sections = { summary: "Full Stack Engineer.", skills: "**Technical Tools:** Python | React", experience: tailoredExp, projects: { "0": ["Built a CV tool."] } };
  const { sections: out, report } = fitTwoPages(sections, profile, terms, candidates);
  assert.equal(report.target, 2);
  assert.equal(report.fits, true);
  assert.deepEqual(report.leftOut.experience, []);
  // PostgreSQL is a keyword and the bullet carries a figure: it ranks first.
  assert.deepEqual(report.restored.map((r) => r.bullet.slice(0, 20)), ["Optimised data acces", "Analysed 11 industry"]);
  assert.deepEqual(report.restored.map((r) => r.section), ["Full Stack Engineer — Brane Group", "Research Assistant — AI & Full-Stack Development"]);
  const lines = String(out.experience).split("\n");
  const at = (s: string) => lines.findIndex((l) => l.includes(s));
  assert.ok(at("Analysed 11") > at("Research Assistant |") && at("Analysed 11") < at("Full Stack Engineer |"), "under the Research Assistant role");
  assert.ok(at("Optimised data access") > at("Built secure FastAPI") && at("Optimised data access") < at("Full Stack Development Intern |"), "last in the Brane role");
  assert.ok(REFILL_DENSITIES.includes(estimatePages(out, profile, 2).density));
});

test("fitTwoPages: never places a bullet under a role its master header does not name, never repeats one, highlights lead", () => {
  const sections = { summary: "x", skills: "y", experience: tailoredExp, projects: {} };
  const candidates: RefillCandidate[] = [
    { where: "experience", role: 2, masterHeader: "Senior Engineer — Globex | 2019 – 2021", text: "Ran the Globex migration for 12 teams." },
    { where: "experience", role: 2, masterHeader: "Full Stack Engineer — Brane Group | Jul 2023 – Sep 2024", text: "Built secure FastAPI backend services with JWT authentication and RBAC for 3 clients." },
    { where: "experience", role: 2, masterHeader: "Full Stack Engineer — Brane Group | Jul 2023 – Sep 2024", text: "Highlight: Shipped 20+ API modules across 2 product lines." },
  ];
  const { sections: out, report } = fitTwoPages(sections, profile, terms, candidates);
  assert.deepEqual(report.restored.map((r) => r.bullet), ["Highlight: Shipped 20+ API modules across 2 product lines."]);
  const lines = String(out.experience).split("\n");
  assert.equal(lines[lines.findIndex((l) => l.startsWith("Full Stack Engineer |")) + 1], "• Highlight: Shipped 20+ API modules across 2 product lines.");
  assert.ok(!String(out.experience).includes("Globex"));
});

test("projectRefillCandidates + fitTwoPages: a project's own left-out bullets go back at the end of its list", () => {
  const projects = { "0": ["Built a CV tool with a real PDF text layer."] };
  const metas = [{ name: "Jobhuntz", originalBullets: ["- Built a CV tool with a real PDF text layer.", "- Wrote 90+ automated tests in Jest."] }];
  const c = projectRefillCandidates(projects, metas);
  assert.deepEqual(c, [{ where: "projects", key: "0", project: "Jobhuntz", text: "Wrote 90+ automated tests in Jest." }]);
  const { sections: out } = fitTwoPages({ summary: "x", skills: "y", experience: tailoredExp, projects }, profile, terms, c);
  assert.deepEqual((out.projects as Record<string, string[]>)["0"], ["Built a CV tool with a real PDF text layer.", "Wrote 90+ automated tests in Jest."]);
});

test("fitTwoPages: stops restoring before the layout reaches the tightest spacing", () => {
  const long = (i: number) => `Delivered platform improvement ${i} for the operations team, with a long explanation of scope, stakeholders and the measured outcome that wraps across two printed lines of the page.`;
  const candidates: RefillCandidate[] = Array.from({ length: 40 }, (_, i) => ({
    where: "experience" as const,
    role: 2,
    masterHeader: "Full Stack Engineer — Brane Group | Jul 2023 – Sep 2024",
    text: long(i),
  }));
  const { sections: out, report } = fitTwoPages({ summary: "x", skills: "y", experience: tailoredExp, projects: {} }, profile, terms, candidates);
  assert.ok(report.restored.length > 0 && report.restored.length < candidates.length, String(report.restored.length));
  const est = estimatePages(out, profile, 2);
  assert.equal(est.overBudget, false);
  assert.ok(REFILL_DENSITIES.includes(est.density), est.density);
});

test("fitTwoPages: a CV that runs past two pages is trimmed by relevance, floors kept, nothing restored", () => {
  const long = (i: number) => bullet(i, " — " + Array.from({ length: 40 }, () => "detail").join(" "));
  const experience = ["Engineer", "Intern", "Assistant"].map((t) => role(t, 14, long)).join("\n\n");
  const { sections: out, report } = fitTwoPages({ summary: "x", skills: "y", experience, projects: { "0": [long(90), long(91)] } }, profile, terms, [
    { where: "experience", role: 1, masterHeader: "Engineer | Acme", text: "Should never be restored." },
  ]);
  assert.equal(report.fits, true);
  assert.ok(report.leftOut.experience.length > 0);
  assert.deepEqual(report.restored, []);
  assert.equal(estimatePages(out, profile, 2).overBudget, false);
  for (const block of String(out.experience).split(/\n(?=[A-Z][^\n|]* \| )/)) assert.ok((block.match(/^• /gm) ?? []).length >= 2, block);
});
