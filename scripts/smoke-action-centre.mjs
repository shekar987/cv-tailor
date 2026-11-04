// Route-level check of the Action Centre on real Postgres: user A cannot see or touch
// user B's events, auto-close, snooze, the note append, and the fact guard on all four
// downloads, reading the built PDF back. Two throwaway users, removed at the end; no
// model call. What needs migration 20261104120000 says SKIP until it is applied.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-action-centre.mjs     (reads .env.local; SMOKE_BASE to override)
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const skipped = (name) => { skip++; console.log(`SKIP ${name} (needs migration 20261104120000)`); };
const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

async function makeUser(tag) {
  const email = `actions-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const call = (path, method = "GET", body) => fetch(BASE + path, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return {
    id: created.id,
    call,
    json: async (path, method, body) => {
      const res = await call(path, method, body);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    rest: (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: PUB, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates", ...(opts.headers ?? {}) } }),
  };
}

const a = await makeUser("a");
const b = await makeUser("b");
try {
  const row = async (user, company_name, status, notes) => (await user.json("/api/applications", "POST", { company_name, role: "Software Engineer", status, date_applied: "2026-10-20", notes })).body.id;
  const event = async (user, body) => (await user.json("/api/events", "POST", body)).body.event;

  // ── What the page lists ──────────────────────────────────────────────────
  const applied = await row(a, "Applied Ltd", "Applied");
  const live = await row(a, "Screening Ltd", "Screening");
  const gone = await row(a, "Gone Ltd", "Rejected");
  const onApplied = await event(a, { application_id: applied, kind: "assessment", title: "Test on an Applied row", due_at: hours(100) });
  await event(a, { application_id: gone, kind: "interview", title: "Hidden interview", starts_at: hours(50) });
  const soon = await event(a, { application_id: live, kind: "deadline", title: "Due soon", due_at: hours(5) });
  await event(a, { kind: "networking", title: "A call with no row", starts_at: hours(30) });

  let view = await a.json("/api/actions");
  const titles = view.body.events.map((e) => e.title);
  check("the Action Centre answers", view.status === 200);
  check("an event on an Applied row is listed", titles.includes("Test on an Applied row"));
  check("a rejected row's event is not", !titles.includes("Hidden interview"));
  check("a networking call is", titles.includes("A call with no row"));
  check("the plan still leaves out the Applied row", !(await a.json("/api/plan")).body.events.some((e) => e.title === "Test on an Applied row"));

  // ── RLS ──────────────────────────────────────────────────────────────────
  const asB = await b.json("/api/actions");
  check("user B's Action Centre is empty", asB.status === 200 && asB.body.events.length === 0);
  check("B reads none of A's events through the database", (await (await b.rest("application_events?select=id")).json()).length === 0);
  check("B cannot mark A's event done", (await b.json("/api/events", "PUT", { id: soon.id, status: "done" })).status === 404);
  check("B cannot snooze A's event", (await b.json("/api/events", "PUT", { id: onApplied.id, snooze: true })).status === 404);
  check("B cannot add a note to A's row", [404, 503].includes((await b.json("/api/applications", "PATCH", { id: live, append_note: "x" })).status));

  // ── Whether the migration is there ───────────────────────────────────────
  const probe = await a.json("/api/applications", "PATCH", { id: live, append_note: "First line" });
  const migrated = probe.status !== 503;
  if (!migrated) {
    check("without the migration the note route names the file", /20261104120000/.test(probe.body.error));
    check("a new kind names the file too", /20261104120000/.test((await a.json("/api/events", "POST", { application_id: live, kind: "work_trial", title: "x", due_at: hours(90) })).body.error));
    check("and snoozing", /20261104120000/.test((await a.json("/api/events", "PUT", { id: onApplied.id, snooze: true })).body.error));
    for (const name of ["the note append", "auto-close", "snooze", "the new kinds"]) skipped(name);
  } else {
    // ── The note append ────────────────────────────────────────────────────
    const stamp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date());
    check("the note is dated", probe.status === 200 && probe.body.notes === `${stamp}: First line`, JSON.stringify(probe.body));
    const second = await a.json("/api/applications", "PATCH", { id: live, append_note: "  Second   line " });
    check("the next goes on top and the first stays", second.body.notes === `${stamp}: Second line\n${stamp}: First line`, JSON.stringify(second.body.notes));
    check("the detail read agrees", (await a.json(`/api/applications?id=${live}`)).body.application?.notes === second.body.notes);
    check("empty is refused", (await a.json("/api/applications", "PATCH", { id: live, append_note: "   " })).status === 400);
    check("a non-string is refused", (await a.json("/api/applications", "PATCH", { id: live, append_note: 5 })).status === 400);
    check("over 500 characters is refused", (await a.json("/api/applications", "PATCH", { id: live, append_note: "x".repeat(501) })).status === 400);
    check("a bad id is a 404", (await a.json("/api/applications", "PATCH", { id: "nope", append_note: "x" })).status === 404);
    const full = await row(a, "Full Ltd", "Applied", "y".repeat(1990));
    const refused = await a.json("/api/applications", "PATCH", { id: full, append_note: "This will not fit in the notes" });
    check("full notes refuse and say so", refused.status === 400 && refused.body.errorType === "notes_full");
    check("and nothing was cut", (await a.json(`/api/applications?id=${full}`)).body.application?.notes === "y".repeat(1990));

    // ── Auto-close ─────────────────────────────────────────────────────────
    const etleap = await row(a, "Etleap Style Ltd", "Applied", "Filling the form.");
    const upload = await event(a, { application_id: etleap, kind: "deadline", title: "Upload CV and submit", due_at: hours(40) });
    const hacker = await event(a, { application_id: etleap, kind: "assessment", title: "HackerRank test", status: "to_book" });
    const quiet = await a.json("/api/applications", "PUT", { id: etleap, notes: "Filling the form. Still going." });
    check("notes with no confirmation close nothing", !quiet.body.autoClose);
    const saved = await a.json("/api/applications", "PUT", { id: etleap, notes: 'Filling the form. "Your response has been recorded" seen 11:45.' });
    check("the stale item closes itself", saved.body.autoClose?.closed?.[0]?.title === "Upload CV and submit", JSON.stringify(saved.body.autoClose));
    check("a test stays open and is named", saved.body.autoClose?.stillOpen?.[0] === "HackerRank test");
    view = await a.json("/api/actions");
    check("it leaves the list", !view.body.events.some((e) => e.id === upload.id));
    check("the test does not", view.body.events.some((e) => e.id === hacker.id));
    check("it is shown as closed by the notes", view.body.closedByNote.some((e) => e.id === upload.id));
    const reopened = await a.json("/api/events", "PUT", { id: upload.id, status: "scheduled", reopen: true });
    check("undo reopens it with no mark", reopened.body.event?.status === "scheduled" && reopened.body.event?.closed_by === null);
    const again = await a.json("/api/applications", "PUT", { id: etleap, notes: 'Filling the form. "Your response has been recorded" seen 11:45. Later note.' });
    check("the old line never closes it again", !again.body.autoClose?.closed?.length);
    const asking = await a.json("/api/applications", "PATCH", { id: etleap, append_note: "Thanks for applying. Please complete the form" });
    check("a note asking for more closes nothing", !asking.body.autoClose?.closed?.length);
    const viaPatch = await a.json("/api/applications", "PATCH", { id: etleap, append_note: "Thanks for applying email arrived" });
    check("a dated note can close it too", viaPatch.body.autoClose?.closed?.[0]?.title === "Upload CV and submit", JSON.stringify(viaPatch.body.autoClose));
    const older = await row(a, "Old Note Ltd", "Applied", "Application submitted on 1 Nov.");
    const later = await event(a, { application_id: older, kind: "deadline", title: "A later task", due_at: hours(40) });
    await a.json("/api/applications", "PUT", { id: older, notes: "Application submitted on 1 Nov. Then they wrote back." });
    check("an item added after the confirmation stays open", (await a.json("/api/actions")).body.events.some((e) => e.id === later.id));

    // ── Snooze ─────────────────────────────────────────────────────────────
    const snoozed = await a.json("/api/events", "PUT", { id: onApplied.id, snooze: true });
    check("a far deadline snoozes", snoozed.status === 200 && !!snoozed.body.event.snoozed_until);
    check("the deadline itself does not move", snoozed.body.event.due_at === onApplied.due_at, `${snoozed.body.event.due_at} vs ${onApplied.due_at}`);
    const near = await a.json("/api/events", "PUT", { id: soon.id, snooze: true });
    check("one due within 24 hours will not", near.status === 400);
    check("a request cannot name its own time", (await a.json("/api/events", "PUT", { id: onApplied.id, snoozed_until: "2030-01-01T00:00:00Z", title: "Renamed" })).body.event?.snoozed_until === snoozed.body.event.snoozed_until);
    check("bringing it back clears it", (await a.json("/api/events", "PUT", { id: onApplied.id, snooze: false })).body.event?.snoozed_until === null);

    // ── New kinds and sources ──────────────────────────────────────────────
    for (const kind of ["video", "work_trial", "screening_questions"]) {
      check(`kind ${kind} saves`, (await a.json("/api/events", "POST", { application_id: live, kind, title: kind, due_at: hours(90) })).status === 200);
    }
    check("an inbox is kept", (await event(a, { application_id: live, kind: "video", title: "From AIApply", due_at: hours(90), source: "aiapply" })).source === "aiapply");
    check("a calendar import cannot be claimed", (await event(a, { application_id: live, kind: "deadline", title: "Claimed", due_at: hours(90), source: "calendar" })).source === "manual");
  }

  // ── The fact guard on the downloads ──────────────────────────────────────
  const profile = { name: "Alex Tester", email: "alex.tester@example.com", phone: "+44 7700 900123", linkedin: "https://linkedin.com/in/alex-tester", github: "https://github.com/alex-tester", website: "", education: [], certifications: [], rightToWork: [], projects: [] };
  const master = `Alex Tester\nPROJECTS\nHailo — Ride-Hailing Platform\t2025\nPersonal portfolio project modelled on a real-world brief  |  Tech: React\n• Built the booking flow\nEDUCATION\nMSc Computing`;
  await a.rest("master_cvs?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: a.id, text: master }) });
  const prefs = await a.rest("user_settings?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: a.id, preferences: { version: 1, retiredClaims: [{ phrase: "sharded platform architecture", replacement: null }] } }) });
  check("the list is saved", prefs.ok, String(prefs.status));

  const body = (over = {}) => ({
    profile,
    summary: "Software engineer who builds web services with React and Node.js for real customers.",
    skills: "Technical Tools: React, Node.js",
    experience: "Software Engineer | Acme | Jan 2024 – Present\n• Built the payments service\n• Wrote the tests",
    projects: { "0": ["Built the booking flow"] },
    projectsMeta: [{ name: "Hailo — Ride-Hailing Platform | 2025", tech: "React", links: [], originalBullets: [] }],
    targetPages: 2,
    formatStyle: "ukji",
    ...over,
  });
  const clean = await a.call("/api/download-pdf", "POST", body());
  check("a clean CV builds as a PDF", clean.status === 200, String(clean.status));
  if (clean.status === 200) {
    const doc = await getDocumentProxy(new Uint8Array(await clean.arrayBuffer()));
    const { text } = await extractText(doc, { mergePages: true });
    check("the project's own label is on the heading", /personal portfolio project modelled on a real-world brief/.test(text), text.slice(0, 200));
  }
  check("a clean CV builds as Word", (await a.call("/api/download", "POST", body())).status === 200);
  const summaryHit = body({ summary: "Built a sharded platform architecture for real customers at Acme, end to end." });
  const heldPdf = await a.json("/api/download-pdf", "POST", summaryHit);
  check("the PDF is held on the user's list", heldPdf.status === 422 && heldPdf.body.errorType === "retired_claim", JSON.stringify(heldPdf.body));
  check("the Word file too", (await a.json("/api/download", "POST", summaryHit)).status === 422);
  check("in a project bullet", (await a.json("/api/download-pdf", "POST", body({ projects: { "0": ["Designed a sharded platform architecture"] } }))).status === 422);
  check("in a project heading", (await a.json("/api/download", "POST", body({ projectsMeta: [{ name: "Sharded Platform Architecture", tech: "", links: [] }] }))).status === 422);
  const letter = (coverLetter) => ({ coverLetter, profile });
  const cleanLetter = "Dear team,\n\nI am applying for the role. I built the payments service at Acme and it serves real customers every day.\n\nKind regards,\nAlex";
  check("a clean letter builds", (await a.call("/api/download-cover", "POST", letter(cleanLetter))).status === 200);
  check("a clean letter builds as a PDF", (await a.call("/api/download-cover-pdf", "POST", letter(cleanLetter))).status === 200);
  check("a built-in phrase holds the letter", (await a.json("/api/download-cover", "POST", letter(`${cleanLetter}\nMicroservices: listed in my functional competencies`))).status === 422);
  check("and its PDF", (await a.json("/api/download-cover-pdf", "POST", letter(`${cleanLetter}\nthese are the one areas where I can help`))).status === 422);
  check("user B's list is empty, so B's CV builds", (await b.call("/api/download-pdf", "POST", summaryHit)).status === 200);
} finally {
  for (const u of [a, b]) await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: admin });
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
