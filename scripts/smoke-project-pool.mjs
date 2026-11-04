// The project pool end to end, with the real /api/tailor and a stand-in model
// (scripts/mock-model.mjs): the code chooses the projects, the model only writes them. Each
// scenario gets its own throwaway user, because tailoring is metered. Removed at the end.
//
//   node scripts/mock-model.mjs &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock npx next start -p 3100
//   node scripts/smoke-project-pool.mjs
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("This script tailors: run it only against a local server with the mock model.");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const users = [];
async function makeUser() {
  const email = `pool-${Date.now()}-${users.length}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  users.push(created.id);
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return (path, body) => fetch(BASE + path, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const LABEL = "Personal portfolio project modelled on a real-world brief";
const card = (id, over = {}) => ({ id, name: id, start: "", end: "", ongoing: false, tech: [], body: `- Did the work on ${id}`, label: "", links: [], pinned: false, ...over });
const CARDS = [
  card("Alpha", { end: "2021", tech: ["Java"] }),
  card("Bravo", { end: "Jun 2025", tech: ["Python", "AWS"], label: LABEL }),
  card("Charlie", { start: "Jan 2024", ongoing: true, tech: ["Go"] }),
  card("Delta", { end: "Sep 2026", tech: ["Rust"] }),
  card("Echo", { tech: ["Python"] }),
];
const poolText = (cards) => cards.map((c) => [`${c.name}${c.end || c.ongoing ? ` | ${c.end || "Present"}` : ""}`, c.body].join("\n")).join("\n\n");
const CV = (roles) => `Alex Tester\nalex.tester@example.com\n\nWORK EXPERIENCE\n${Array.from({ length: roles }, (_, i) => `Software Engineer | Company ${i} | Jan 20${10 + i} – Dec 20${10 + i}\n• Built the service\n• Wrote the tests`).join("\n")}\n\nEDUCATION\nMSc Computing`;
const profile = { name: "Alex Tester", email: "alex.tester@example.com", phone: "", linkedin: "", github: "", website: "", education: [], certifications: [], rightToWork: [], projects: [] };
const analysis = { company_name: "Acme", role_title: "Software Engineer", seniority: "mid", required_skills: ["Python"], nice_to_have_skills: [], top_15_ats_keywords: ["Python", "AWS", "Docker"], key_responsibilities: [], tone: "plain" };

async function tailor(call, { cards = CARDS, settings, cvLength = "two", roles = 3 } = {}) {
  const res = await call("/api/tailor", {
    jobDescription: "We need a Software Engineer who knows Python, AWS and Docker to build web services for our customers in London.",
    cvText: CV(roles),
    projectNames: [],
    projectsPool: poolText(cards),
    analysis,
    profile,
    preferences: { projectCards: cards, cvLength, projectPoolSettings: settings ?? { count: "auto", order: "relevance" } },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const baseNames = (r) => (r.body.selectedProjects ?? []).map((p) => p.name.split(" (")[0]);

try {
  // Count 3, newest first.
  let call = await makeUser();
  let r = await tailor(call, { settings: { count: 3, order: "date" } });
  check("the run answers", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  check("count 3, newest first: exactly 3, latest end date first", baseNames(r).join(",") === "Charlie,Delta,Bravo", baseNames(r).join(","));
  const bravo = r.body.selectedProjects.find((p) => p.name.startsWith("Bravo"));
  check("the label is on the heading verbatim", bravo.name === `Bravo (${LABEL})`, bravo.name);
  check("the model cannot rename a project", !r.body.selectedProjects.some((p) => /reworded/.test(p.name)));
  check("nor change its dates or tech", bravo.date === "Jun 2025" && bravo.tech === "Python, AWS", `${bravo.date} / ${bravo.tech}`);
  check("projects used names what ran", r.body.projectsUsed.map((p) => p.cardId).join(",") === "Charlie,Delta,Bravo");
  check("with what each matched", r.body.projectsUsed.find((p) => p.cardId === "Bravo").matches.includes("Python"));

  // A pin, under the other order.
  r = await tailor(call, { cards: CARDS.map((c) => (c.id === "Alpha" ? { ...c, pinned: true } : c)), settings: { count: 2, order: "relevance" } });
  check("a pinned project is always included, and first", baseNames(r)[0] === "Alpha" && baseNames(r).length === 2, baseNames(r).join(","));
  check("the rest by relevance", baseNames(r)[1] === "Bravo", baseNames(r).join(","));
  check("it says it is pinned", r.body.projectsUsed[0].pinned === true);

  // Pins past the number.
  r = await tailor(call, { cards: CARDS.map((c, i) => ({ ...c, pinned: i < 3 })), settings: { count: 2, order: "date" } });
  check("three pins with two chosen: all three stay", baseNames(r).length === 3, baseNames(r).join(","));
  check("and the warning says so", r.body.poolFit?.pinWarning === "You pinned 3 but chose 2.", JSON.stringify(r.body.poolFit));

  // Auto.
  call = await makeUser();
  r = await tailor(call, { cvLength: "one", roles: 3 });
  check("Auto on one page with 3 jobs: 2 projects", r.body.selectedProjects?.length === 2 || !!r.body.poolFit?.message, `${baseNames(r).join(",")} ${JSON.stringify(r.body.poolFit)}`);
  r = await tailor(call, { cvLength: "one", roles: 1 });
  check("Auto on one page with 1 job chooses 3", r.body.poolFit?.count === 3, JSON.stringify(r.body.poolFit));
  r = await tailor(call, { cvLength: "two", roles: 3 });
  check("Auto on two pages: 3 projects", baseNames(r).length === 3, baseNames(r).join(","));

  // Fit: four long projects on a page that cannot hold them.
  call = await makeUser();
  const packed = CARDS.slice(0, 4);
  r = await tailor(call, { cards: packed, settings: { count: 4, order: "date" }, cvLength: "one", roles: 6 });
  const shown = r.body.selectedProjects?.length ?? 0;
  const bulletCounts = (r.body.selectedProjects ?? []).map((p) => p.bullets.length);
  check("a tight page reduces bullets first: top ≤ 3, others ≤ 2", bulletCounts.every((n, i) => n <= (i === 0 ? 3 : 2)), bulletCounts.join(","));
  if (shown < 4) {
    check("a project that had to go is named in the message", r.body.poolFit?.message === `4 projects don't fit on 1 page; showing ${shown}. Switch to 2 pages or pick ${shown}.`, JSON.stringify(r.body.poolFit));
  } else {
    check("all four fitted, so nothing to say", r.body.poolFit?.message === null, JSON.stringify(r.body.poolFit));
  }

  // Fit, the last resort: tech lines so long that reducing bullets cannot save the page.
  call = await makeUser();
  const stack = Array.from({ length: 30 }, (_, i) => `Some Long Technology Name Number ${i}`);
  const heavy = ["One", "Two", "Three", "Four"].map((n, i) => card(n, { end: `${2020 + i}`, tech: stack, pinned: i === 0 }));
  r = await tailor(call, { cards: heavy, settings: { count: 4, order: "date" }, cvLength: "one", roles: 2 });
  const kept = baseNames(r);
  check("when it still runs over, projects go rather than the page", kept.length < 4, kept.join(","));
  check("and the message says exactly that", r.body.poolFit?.message === `4 projects don't fit on 1 page; showing ${kept.length}. Switch to 2 pages or pick ${kept.length}.`, JSON.stringify(r.body.poolFit));
  check("a pinned project is never the one to go", kept.includes("One"), kept.join(","));
  check("projects used lists only what stayed", r.body.projectsUsed.length === kept.length);

  // The text pool's old path still works.
  const text = await (await call("/api/tailor", { jobDescription: "We need a Software Engineer who knows Python, AWS and Docker to build web services for our customers in London.", cvText: CV(2), projectNames: [], projectsPool: poolText(CARDS.slice(0, 3)), analysis, profile, preferences: {} })).json();
  check("with no cards, the old text path answers as before", Array.isArray(text.selectedProjects) && !text.projectsUsed, JSON.stringify(Object.keys(text)).slice(0, 120));

  // Swap.
  call = await makeUser();
  const swap = await (await call("/api/swap-project", { cardId: "Bravo", cards: CARDS, cvText: CV(3), analysis, claims: null, retiredClaims: [] })).json();
  check("a swap writes that project", swap.project?.name === `Bravo (${LABEL})` && swap.project.bullets.length > 0, JSON.stringify(swap).slice(0, 200));
  check("and says what it matched", swap.used?.matches?.includes("Python"));
  check("a project not in the pool is refused", (await call("/api/swap-project", { cardId: "Nope", cards: CARDS, cvText: CV(3), analysis })).status === 404);
  const retired = await (await call("/api/swap-project", { cardId: "Bravo", cards: CARDS, cvText: CV(3), analysis, retiredClaims: [{ phrase: "automated tests", replacement: "tests" }] })).json();
  check("a swap holds to the user's list", !/automated tests/.test(retired.project.bullets.join(" ")));

  // The link check.
  const links = await (await call("/api/check-link", { urls: ["http://localhost:3100/", "http://169.254.169.254/latest/meta-data/", "https://www.jobhuntz.app/this-page-does-not-exist", "https://www.jobhuntz.app/"] })).json();
  const of = (needle) => links.results.find((l) => l.url.includes(needle));
  check("a bare local name is not even an address here", of("localhost") === undefined, JSON.stringify(of("localhost")));
  check("the cloud metadata address is never fetched, and never warns", of("169.254") === undefined || (of("169.254").status === null && of("169.254").missing === false), JSON.stringify(of("169.254")));
  check("a 404 warns", of("does-not-exist")?.missing === true, JSON.stringify(of("does-not-exist")));
  check("a live page does not", of("jobhuntz.app/")?.missing === false || links.results.at(-1)?.missing === false, JSON.stringify(links.results.at(-1)));

  // The label reaches the file.
  const pdf = await call("/api/download-pdf", {
    profile,
    summary: "Software engineer who builds web services for real customers.",
    skills: "Technical Tools: Python",
    experience: "Software Engineer | Acme | Jan 2024 – Present\n• Built the service\n• Wrote the tests",
    projects: { "0": ["Built it"] },
    projectsMeta: [{ name: `Bravo (${LABEL}) | Jun 2025`, tech: "Python", links: [], originalBullets: [] }],
    targetPages: 2,
    formatStyle: "ukji",
  });
  check("the PDF builds", pdf.status === 200, String(pdf.status));
  if (pdf.status === 200) {
    const { text: pdfText } = await extractText(await getDocumentProxy(new Uint8Array(await pdf.arrayBuffer())), { mergePages: true });
    check("with the label verbatim in the text layer", pdfText.replace(/\s+/g, " ").includes(LABEL));
  }
} finally {
  for (const id of users) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
