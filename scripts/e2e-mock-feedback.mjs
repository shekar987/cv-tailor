// A screenshot of the mock-interview FEEDBACK page (Chunk 32) in a real browser
// (Edge), on a throwaway account. The interview API is answered by an in-memory
// stand-in whose feedback is built from the REAL lib/mockInterview rules
// (reconcileFeedback), so the rubric rows, delivery stats and the stronger
// version are exactly what a real competency round produces. No database, no
// model call. The company, the role and every answer are made up.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs \
//   OUT="C:/Users/shekar/Desktop/shekar/RTS/jobhuntz-audit/2026-11-15/screenshots/13-mock-feedback-desktop.png" \
//   node --disable-warning=ExperimentalWarning scripts/e2e-mock-feedback.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP = process.cwd();
const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(path.join(APP, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const { normalizePlan, openingEntries, reconcileFeedback } = await import(pathToFileURL(APP + "/src/lib/mockInterview.ts").href);
const { ROUNDS } = await import(pathToFileURL(APP + "/src/lib/interviewTypes.ts").href);

const OUT = process.env.OUT || path.join(APP, "e2e-mock-feedback.png");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// ── Fictional competency round, scored by the real rules ─────────────────────
const CV = `EXPERIENCE
Software Developer | Harbour Labs | Sep 2023 – Present
- Built the booking API in FastAPI, cutting checkout time by 20%.
- Wrote 120 Jest tests for the payments flow.
- Rebuilt the onboarding screen in React, used by 4,000 users.

PROJECTS
RouteMate (personal project)
- A journey planner in TypeScript and Node.js with a Postgres backend.`;

const ctx = { firstName: "Alex", company: "Northwind Robotics", role: "Graduate Software Engineer", cvText: CV };
const rawQuestions = {
  questions: [
    { text: "Tell me about a time you had to deliver something under a tight deadline.", rubric: "star", intent: "how you work under pressure", cvAnchor: "Built the booking API in FastAPI, cutting checkout time by 20%." },
    { text: "Describe a time you disagreed with a teammate on a technical decision.", rubric: "star", intent: "how you handle conflict", strongAnswer: ["A specific disagreement", "Your own position", "How it resolved"] },
    { text: "Give an example of a time you improved the quality of a codebase.", rubric: "star", intent: "ownership of quality" },
  ],
};
const { plan } = normalizePlan(rawQuestions, "competency", ctx);
// The star questions (q1 is the fixed background opener).
const stars = plan.questions.filter((q) => q.rubric === "star");

const transcript = [
  ...openingEntries(plan),
  // A strong, complete STAR answer.
  { who: "candidate", kind: "answer", questionId: stars[0].id, mode: "voice", seconds: 78, pauseMs: 1600,
    text: "At Harbour Labs the checkout was slow before a launch. I profiled the booking API, found the bottleneck in the payment call, and rebuilt it in FastAPI. I did the work myself over two days and cut checkout time by 20%, which meant we shipped on time." },
  // A weaker, team-only answer with no result — rubric shows Missing/Partly.
  { who: "candidate", kind: "answer", questionId: stars[1].id, mode: "voice", seconds: 34, pauseMs: 4200,
    text: "Um, we had a disagreement about the database once, you know. We talked it through as a team and, sort of, we picked an approach in the end." },
  // A reasonable answer with a figure the CV does not show (flagged).
  { who: "candidate", kind: "answer", questionId: stars[2].id, mode: "voice", seconds: 64, pauseMs: 2100,
    text: "I added tests to the payments flow at Harbour Labs. I wrote the suite myself and raised coverage to 95%, so regressions were caught before release." },
];

const feedbackModel = {
  answers: [
    { id: stars[0].id,
      answered: { pass: true, quote: "the checkout was slow before a launch" },
      example: { pass: true, quote: "At Harbour Labs the checkout was slow before a launch" },
      ownActions: { pass: true, quote: "I did the work myself over two days" },
      result: { pass: true, quote: "cut checkout time by 20%" },
      relevance: { level: "clear", quote: "I profiled the booking API, found the bottleneck" },
      tryInstead: "Before the launch I profiled the slow booking API, rebuilt the payment call in FastAPI myself, and cut checkout time by 20%, so we shipped on time.",
      cvLine: "Built the booking API in FastAPI, cutting checkout time by 20%." },
    { id: stars[1].id,
      answered: { pass: true, quote: "we had a disagreement about the database once" },
      example: { pass: false, quote: "" },
      ownActions: { pass: false, quote: "" },
      result: { pass: false, quote: "" },
      relevance: { level: "partly", quote: "we had a disagreement about the database once" },
      tryInstead: "I disagreed about the database and raised it with the team. I migrated us to a sharded Postgres cluster. Add your real result here.",
      cvLine: "" },
    { id: stars[2].id,
      answered: { pass: true, quote: "I added tests to the payments flow" },
      example: { pass: true, quote: "I added tests to the payments flow at Harbour Labs" },
      ownActions: { pass: true, quote: "I wrote the suite myself" },
      result: { pass: false, quote: "" },
      relevance: { level: "clear", quote: "I wrote the suite myself and raised coverage" },
      tryInstead: "I wrote 120 Jest tests for the payments flow at Harbour Labs myself, so regressions were caught before release.",
      cvLine: "Wrote 120 Jest tests for the payments flow." },
  ],
};
const feedback = reconcileFeedback(feedbackModel, plan, transcript, CV);
const questions = plan.questions.map((q) => ({ id: q.id, text: q.text, intent: q.intent }));

const INTERVIEW_ID = "00000000-0000-4000-8000-000000000001";
const APP_ID = "00000000-0000-4000-8000-0000000000a1";
const application = { id: APP_ID, company_name: ctx.company, role: ctx.role, status: "Interview", job_description: "We are hiring a Graduate Software Engineer to build our robotics control dashboard in TypeScript and Python." };
const past = { id: INTERVIEW_ID, type: "competency", status: "finished", created_at: "2026-11-15T10:00:00Z", finished_at: "2026-11-15T10:28:00Z", readout: feedback.readout };

async function route(page) {
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(/\/api\/applications(\?.*)?$/, (r) => json(r, { application }));
  await page.route(/\/api\/interview(\?.*)?$/, (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() === "GET" && url.searchParams.get("id")) {
      return json(r, { interview: { id: INTERVIEW_ID, applicationId: APP_ID, type: "competency", status: "finished", feedback, questions } });
    }
    if (req.method() === "GET") return json(r, { interviews: [past] });
    // POST retry: re-score the one question (not needed for the still, but keeps the button live).
    if (req.method() === "POST") {
      const body = req.postDataJSON() || {};
      if (body.action === "retry") return json(r, { answer: feedback.answers[0] });
      return json(r, { error: "not supported in this harness" }, 400);
    }
    json(r, {});
  });
  // The usage chip and anything else the page may touch: keep them quiet.
  await page.route("**/rest/v1/**", (r) => json(r, []));
}

const email = `fb-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  browser = await chromium.launch({ channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1600 }, timezoneId: "Europe/London" });
  await context.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const page = await context.newPage();
  await route(page);

  await page.goto(`${BASE}/applications/${APP_ID}/interview`, { waitUntil: "load" });
  // Open the finished interview's feedback.
  await page.getByRole("button", { name: /View feedback/i }).first().click();
  await page.waitForSelector("[data-interview-feedback]", { timeout: 15000 });
  await page.waitForSelector("[data-interview-rubric]", { timeout: 15000 });
  await page.waitForTimeout(400);

  const rubricRows = await page.locator("[data-interview-rubric]").count();
  const stronger = await page.locator("[data-stronger-version]").count();
  const retry = await page.locator("[data-retry-open]").count();
  console.log(`rubric blocks: ${rubricRows}, stronger-version blocks: ${stronger}, retry buttons: ${retry}`);

  await page.screenshot({ path: OUT, fullPage: true });
  console.log(`Saved ${OUT}`);
  if (rubricRows === 0 || stronger === 0 || retry === 0) { console.error("FAIL: a feedback section is missing"); process.exitCode = 1; }
} finally {
  await browser?.close();
}
