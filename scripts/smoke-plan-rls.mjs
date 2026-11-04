// Route-level check of the plan on real Postgres, once migration 20261103120000 is
// applied: user A cannot read or touch user B's events or free and busy times
// (through PostgREST and through the routes), and the active rule holds end to end.
// Two throwaway users, removed at the end; no model call.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-plan-rls.mjs          (reads .env.local; SMOKE_BASE to override)
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

async function makeUser(tag) {
  const email = `plan-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return {
    id: created.id,
    route: (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { cookie, "Content-Type": "application/json", ...(opts.headers ?? {}) } }),
    rest: (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: PUB, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers ?? {}) } }),
  };
}
const json = (body) => JSON.stringify(body);

const a = await makeUser("a");
const b = await makeUser("b");
try {
  const added = await (await a.route("/api/applications", { method: "POST", body: json({ company_name: "Acme", role: "Engineer", status: "screening", date_applied: "2026-10-20" }) })).json();
  const appId = added.id;
  check("user A adds a row", !!appId, json(added).slice(0, 120));

  const when = new Date(Date.now() + 86_400_000).toISOString();
  const created = await (await a.route("/api/events", { method: "POST", body: json({ application_id: appId, kind: "interview", title: "First round", starts_at: when }) })).json();
  const eventId = created.event?.id;
  check("user A adds an event", !!eventId, json(created).slice(0, 160));
  const windowRow = await (await a.route("/api/availability", { method: "POST", body: json({ kind: "busy", date: "2026-11-20", start_time: "09:00", end_time: "10:00", label: "Shift" }) })).json();
  check("user A adds a busy time", !!windowRow.window?.id);

  // PostgREST, as user B.
  check("B reads none of A's events", (await (await b.rest("application_events?select=id")).json()).length === 0);
  check("B reads none of A's busy times", (await (await b.rest("availability_windows?select=id")).json()).length === 0);
  const patched = await b.rest(`application_events?id=eq.${eventId}`, { method: "PATCH", body: json({ title: "changed" }) });
  check("B cannot change A's event", (await patched.json()).length === 0);
  const removed = await b.rest(`application_events?id=eq.${eventId}`, { method: "DELETE" });
  check("B cannot delete A's event", (await removed.json()).length === 0);
  const asA = await b.rest("application_events", { method: "POST", body: json({ user_id: a.id, kind: "interview", title: "x", starts_at: when }) });
  check("B cannot write as A", asA.status === 403, String(asA.status));
  const onto = await b.rest("application_events", { method: "POST", body: json({ user_id: b.id, application_id: appId, kind: "interview", title: "x", starts_at: when }) });
  check("B cannot attach an event to A's application", onto.status === 403, String(onto.status));

  // The routes, as user B.
  check("B's /api/events is empty", (await (await b.route("/api/events")).json()).events.length === 0);
  const bPlan = await (await b.route("/api/plan")).json();
  check("B's plan is empty", bPlan.events.length === 0 && bPlan.applications.length === 0 && bPlan.availability.length === 0);
  check("B's PUT on A's event answers 404", (await b.route("/api/events", { method: "PUT", body: json({ id: eventId, title: "x" }) })).status === 404);
  check("B cannot add an event to A's application", (await b.route("/api/events", { method: "POST", body: json({ application_id: appId, kind: "interview", title: "x", starts_at: when }) })).status === 404);

  // The active rule, end to end.
  const plan = async () => (await (await a.route("/api/plan")).json());
  check("the event is on A's plan", (await plan()).events.some((e) => e.id === eventId));
  await a.route("/api/applications", { method: "PUT", body: json({ id: appId, status: "rejected", outcome_reason: "Wanted more years", confirmed_by_user: true }) });
  const afterReject = await plan();
  check("rejected: the event leaves the plan", !afterReject.events.some((e) => e.id === eventId));
  check("rejected: the row is not active", !afterReject.applications.some((r) => r.id === appId));
  check("rejected: the event is hidden, not deleted", (await (await a.route("/api/events")).json()).events.some((e) => e.id === eventId));
  const row = (await (await a.route(`/api/applications?id=${appId}`)).json()).application;
  check("the API answers in its own spelling", row.status === "Rejected");
  const listed = (await (await a.route("/api/applications")).json()).applications.find((r) => r.id === appId);
  check("the trigger recorded the stages", JSON.stringify(listed.stages_reached) === '["screening","rejected"]' || JSON.stringify(listed.stages_reached) === '["applied","screening","rejected"]', json(listed.stages_reached));
  check("the reason reads back", listed.outcome_reason === "Wanted more years");
  await a.route("/api/applications", { method: "PUT", body: json({ id: appId, status: "screening" }) });
  check("moved back: the event returns", (await plan()).events.some((e) => e.id === eventId));

  const ghost = await a.route("/api/applications", { method: "PUT", body: json({ id: appId, status: "ghosted", confirmed_by_user: true }) });
  check("a new status saves", ghost.status === 200, String(ghost.status));
  check("ghosted is off the plan", !(await plan()).events.some((e) => e.id === eventId));
  await a.route("/api/applications", { method: "PUT", body: json({ id: appId, status: "assessment" }) });
  check("assessment is on the plan", (await plan()).events.some((e) => e.id === eventId));

  const bad = await a.route("/api/events", { method: "POST", body: json({ kind: "party", title: "x", starts_at: when, application_id: appId }) });
  check("a bad kind answers 400", bad.status === 400);
  const networking = await a.route("/api/events", { method: "POST", body: json({ kind: "networking", title: "Coffee", starts_at: when }) });
  check("a networking call needs no application", networking.status === 200);
  const orphan = await a.route("/api/events", { method: "POST", body: json({ kind: "interview", title: "x", starts_at: when }) });
  check("an interview does", orphan.status === 400);

  const exported = await (await a.route("/api/account/export")).json();
  check("Download everything includes the plan", exported.planEvents?.rows?.length === 2 && exported.availability?.rows?.length === 1);

  await a.route(`/api/applications?id=${appId}`, { method: "DELETE" });
  check("deleting the row takes its events", !(await (await a.route("/api/events")).json()).events.some((e) => e.id === eventId));
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  for (const user of [a, b]) await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
