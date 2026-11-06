// Chunk 18 on the real route and database: POST /api/applications/bulk-upsert with one
// throwaway user. The same payload twice inserts nothing the second time; a duplicate in
// one payload is one row; an existing Screening row for the pair is left exactly as it was
// (status and updated_at); the tracker's PUT still answers 409 for ending that row; the list
// carries contact_email. Until migration 20261106120000 is applied, the route answers 503
// needs_migration and the script says SKIP for the rest. No model call anywhere.
//
//   npx next start -p 3100   (any build of this branch)
//   node scripts/smoke-cold-email.mjs
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const email = `cold-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const asUser = { apikey: PUB, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const payload = [
  { company_name: "Acme Robotics", role: "Cold email: Backend", contact_email: "jane@acme.example", date_sent: "2026-10-30", followup_date: "2026-11-06", notes: "Sent from Gmail" },
  { company_name: "Bravo Data", role: "", contact_email: "sam@bravo.example", date_sent: "2026-10-30", followup_date: null, notes: null },
  { company_name: "acme robotics ", role: "Cold email: Backend", contact_email: "JANE@acme.example", date_sent: "2026-10-30", followup_date: "2026-11-06", notes: "duplicate in the same payload" },
];

try {
  const first = await call("POST", "/api/applications/bulk-upsert", payload);
  if (first.status === 503 && first.body.errorType === "needs_migration") {
    check("before the migration: 503 needs_migration naming the file", /20261106120000_applications_cold_email\.sql/.test(first.body.error ?? ""), first.body.error);
    const list = await call("GET", "/api/applications");
    check("and the tracker list still reads (one rung down)", list.status === 200 && Array.isArray(list.body.applications), String(list.status));
    skip = 1;
  } else {
    check("the first post answers", first.status === 200, `${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
    check("two rows inserted; the duplicate in the payload is one", first.body.inserted?.length === 2 && JSON.stringify(first.body.duplicateInPayload) === "[2]", JSON.stringify(first.body));

    const second = await call("POST", "/api/applications/bulk-upsert", payload);
    check("the same payload again inserts nothing", second.status === 200 && second.body.inserted?.length === 0 && second.body.existing?.length === 2, JSON.stringify(second.body));

    const list = await call("GET", "/api/applications");
    const cold = (list.body.applications ?? []).filter((r) => r.source === "cold-email");
    check("the tracker holds exactly two cold-email rows", cold.length === 2, String(cold.length));
    check("each Applied, with its contact email, dated the day sent", cold.every((r) => r.status === "Applied" && r.contact_email && r.date_applied === "2026-10-30"), JSON.stringify(cold.map((r) => [r.status, r.contact_email, r.date_applied])));
    check("Bravo has no follow-up date: the tracker's filter has one row", cold.filter((r) => !r.followup_date).length === 1);

    // A row that already reached screening for the same pair, written by the user.
    const seed = await fetch(`${SB}/rest/v1/applications`, {
      method: "POST",
      headers: { ...asUser, Prefer: "return=representation" },
      body: JSON.stringify({ user_id: created.id, company_name: "Screened Co", role: "Cold email", contact_email: "lee@screened.example", status: "Screening", source: "cold-email", date_applied: "2026-10-20", notes: "They replied" }),
    });
    const [screened] = await seed.json();
    check("a Screening row seeded", seed.status < 300 && !!screened?.id, String(seed.status));
    const third = await call("POST", "/api/applications/bulk-upsert", [{ company_name: "SCREENED CO", role: "Cold email", contact_email: "Lee@Screened.example", date_sent: "2026-10-20", followup_date: "2026-11-10", notes: "a sweep's note" }]);
    check("the sweep's row matches it and inserts nothing", third.body.inserted?.length === 0 && third.body.existing?.[0]?.id === screened.id, JSON.stringify(third.body));
    const after = await (await fetch(`${SB}/rest/v1/applications?id=eq.${screened.id}&select=status,notes,followup_date,updated_at`, { headers: asUser })).json();
    check("the Screening row is untouched: status, notes, follow-up and updated_at", after[0]?.status === "Screening" && after[0]?.notes === "They replied" && after[0]?.followup_date === null && after[0]?.updated_at === screened.updated_at, JSON.stringify(after[0]));
    const end = await call("PUT", "/api/applications", { id: screened.id, status: "Rejected" });
    check("ending that row from the API still answers 409", end.status === 409, `${end.status} ${end.body.error ?? ""}`);

    const bad = await call("POST", "/api/applications/bulk-upsert", [{ company_name: "Nope", contact_email: "Gmail", date_sent: "2026-10-30" }]);
    check("a bad row is reported by its index, nothing inserted", bad.status === 200 && bad.body.inserted?.length === 0 && bad.body.problems?.[0]?.index === 0, JSON.stringify(bad.body));
    const notArray = await call("POST", "/api/applications/bulk-upsert", { nope: true });
    check("a body that is no list answers 400", notArray.status === 400);
  }
  const anon = await fetch(`${BASE}/api/applications/bulk-upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" });
  check("signed out: 401", anon.status === 401);
} finally {
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed${skip ? " (the rest SKIP until migration 20261106120000 is applied)" : ""}; throwaway user removed: ${del.ok}`);
}
