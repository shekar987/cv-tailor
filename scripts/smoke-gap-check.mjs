// Chunk 17 end to end on a local server with the stand-in model (scripts/mock-model.mjs): the
// pre-check's gap read and its banner terms, the seniority label and early-career only, the
// summary's "applying for" clause and placement wording, the score's suggestions, and the
// job-link import of a Greenhouse short link and an EU board (a real fetch of public postings,
// no model call). One throwaway user, removed at the end. No paid call anywhere.
//
//   node scripts/mock-model.mjs &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock OPENROUTER_API_KEY= GEMINI_API_KEY= npx next start -p 3100
//   node scripts/smoke-gap-check.mjs
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("This script tailors: run it only against a local server with the mock model.");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const email = `gaps-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const post = async (path, body) => {
  const res = await fetch(BASE + path, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const CV = `Alex Tester
alex.tester@example.com

EXPERIENCE
Software Engineer (Industrial Placement) | Example Lab | Oct 2025 – Present
• Diagnosed and resolved production incidents across three Python services, cutting repeat tickets by 30%
• Built REST APIs in FastAPI serving 2,000 daily users
• Added structured logging and Grafana dashboards for the payments service

SKILLS
Python, FastAPI, PostgreSQL, Docker, Grafana

EDUCATION
MSc Computing`;
const analysis = {
  company_name: "Acme",
  role_title: "Customer Support Engineer",
  seniority: "junior",
  required_skills: ["Troubleshooting", "DNS", "Routing", "Firewalls", "Root cause analysis"],
  nice_to_have_skills: ["Observability"],
  top_15_ats_keywords: ["HTTP", "Python", "DNS"],
  key_responsibilities: [],
  tone: "plain",
};
const JD = `Customer Support Engineer\nMinimum experience: Mid-level\nResolve networking issues for customers: DNS, routing and firewalls.\nMOCK ANALYSIS: ${JSON.stringify(analysis)}`;

try {
  // ── The pre-check ─────────────────────────────────────────────────────────
  const pre = await post("/api/analyze", { jobDescription: JD, cvText: CV, eligibility: { yearsExperience: 6, earlyCareerOnly: true } });
  check("the pre-check answers", pre.status === 200, `${pre.status} ${JSON.stringify(pre.body).slice(0, 200)}`);
  const items = pre.body.gapCheck?.items ?? [];
  const cls = (t) => items.find((i) => i.term === t)?.class;
  check("troubleshooting is a rename, mapped to the incident bullet", cls("Troubleshooting") === "rename" && /incidents/.test(items.find((i) => i.term === "Troubleshooting")?.line ?? ""), JSON.stringify(items.find((i) => i.term === "Troubleshooting")));
  check("the model's rename counts where its line is in the CV", cls("Root cause analysis") === "rename" && items.find((i) => i.term === "Root cause analysis")?.via === "model");
  check("DNS, routing and firewalls are core gaps", ["DNS", "Routing", "Firewalls"].every((t) => cls(t) === "core"), items.map((i) => `${i.term}:${i.class}`).join(", "));
  check("the gap read ran", pre.body.gapCheck?.model === "ok", pre.body.gapCheck?.model);
  check("the tracker's level label reads as mid-level", pre.body.seniority?.level === "mid" && pre.body.seniority?.signals?.some((s) => s.kind === "label"), JSON.stringify(pre.body.seniority?.signals));
  check("early-career only holds it, whatever the years", pre.body.seniority?.fits === false && /early-career roles only/.test(pre.body.seniority?.reason ?? ""), pre.body.seniority?.reason);
  const years = await post("/api/analyze", { jobDescription: JD, cvText: CV, eligibility: { yearsExperience: 6 } });
  check("without it, six years cover a mid-level read", years.body.seniority?.fits === true, years.body.seniority?.reason);

  // ── The tailor ────────────────────────────────────────────────────────────
  const run = await post("/api/tailor", { jobDescription: JD, cvText: CV, projectNames: [], analysis: pre.body.result, profile: { name: "Alex Tester", email: "alex.tester@example.com", phone: "", linkedin: "", github: "", website: "", education: [], certifications: [], rightToWork: [], projects: [] }, preferences: { cvLength: "two" } });
  check("the tailor answers", run.status === 200, `${run.status} ${JSON.stringify(run.body).slice(0, 200)}`);
  const summary = String(run.body.summary ?? "");
  check("the summary never names the job applied for", !/applying for/i.test(summary) && (run.body.formatFixes?.appliedFor ?? []).length === 1, summary);
  check("and keeps the sentence the clause hung off", /Software engineer building web services in Python\./.test(summary), summary);
  check("the title retry is not spent on a title that isn't theirs", run.body.titleCheck?.asIdentity === false && run.body.titleCheck?.retried === false, JSON.stringify(run.body.titleCheck));
  check("a current placement is never called completed", !/Completed an industrial placement/.test(summary) && (run.body.factGuard?.roleStatus ?? []).some((s) => /Completed an industrial placement/.test(s)), JSON.stringify(run.body.factGuard?.roleStatus));
  const score = run.body.atsScore ?? {};
  check("a suggestion the CV can't back is never a line to paste", !(score.recommendations ?? []).some((r) => /Optimised HTTP/.test(r)), JSON.stringify(score.recommendations));
  check("it is shown as needing evidence, by its term", (score.needs_evidence ?? []).some((n) => n.term === "HTTP" && !/Optimised/.test(n.note)), JSON.stringify(score.needs_evidence));
  check("a suggestion it can back stays", (score.recommendations ?? []).some((r) => /Move Python/.test(r)), JSON.stringify(score.recommendations));

  // ── The job-link import (public postings, no model call) ──────────────────
  const short = await post("/api/jd/fetch", { url: "grnh.se/eag5dvw2teu" });
  check("a grnh.se short link imports the posting", short.status === 200 && /Man Group/.test(short.body.company ?? "") && (short.body.description ?? "").length > 500, `${short.status} ${short.body.company} ${short.body.title} ${short.body.error ?? ""}`);
  const eu = await post("/api/jd/fetch", { url: "https://job-boards.eu.greenhouse.io/mangroup/jobs/5008805101" });
  check("an EU board link imports through the same API", eu.status === 200 && eu.body.title === short.body.title, `${eu.status} ${eu.body.title} ${eu.body.error ?? ""}`);
  const tailscale = await post("/api/jd/fetch", { url: "https://job-boards.greenhouse.io/tailscale/jobs/4724314005" });
  check("Tailscale Tier 1 still imports", tailscale.status === 200 && /Tier 1/.test(tailscale.body.title ?? ""), `${tailscale.status} ${tailscale.body.title} ${tailscale.body.error ?? ""}`);
  const bamboo = await post("/api/jd/fetch", { url: "https://unifeye.bamboohr.com/careers/34" });
  check("BambooHR's level field reaches the text", bamboo.status !== 200 || /Minimum experience: /.test(bamboo.body.description ?? ""), `${bamboo.status} ${bamboo.body.error ?? ""}`);
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  const removed = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; throwaway user removed: ${removed.ok}`);
  process.exit(fail ? 1 : 0);
}
