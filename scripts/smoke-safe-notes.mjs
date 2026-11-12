// Chunk 21 (10 Nov 2026) on the real routes and database: append-only notes, the
// if_updated_at rule, notes history and restore, company rules (by hand and read from a
// rejection), and the deadline radar (GET ?due=48h). Two throwaway users, removed at the
// end; made-up companies and addresses; no model call. Whatever needs migration
// 20261110120000 says SKIP until it is applied, and checks the 503 / fallback instead.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-safe-notes.mjs      (reads .env.local; SMOKE_BASE to override)
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const json = (body) => JSON.stringify(body);

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const skipped = (name) => { skip++; console.log(`SKIP ${name} (migration 20261110120000 not applied)`); };
const STAMP = String.raw`\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}`;
const londonDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

const users = [];
async function newUser(tag) {
  const email = `safe-notes-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: json({ email, password, email_confirm: true }) })).json();
  users.push(created.id);
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: json({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const call = async (path, method = "GET", body) => {
    const res = await fetch(BASE + path, { method, headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: json(body) } : {}) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { call };
}

try {
  const a = await newUser("a");
  const b = await newUser("b");
  const detail = async (id) => (await a.call(`/api/applications?id=${id}`)).body.application;
  const add = async (fields) => (await a.call("/api/applications", "POST", { role: "Engineer", date_applied: "2026-07-05", ...fields })).body.id;

  // ── Step 1: notes that can't be wiped ────────────────────────────────────────
  const id = await add({ company_name: "Smoke Notes Ltd", status: "Applied", notes: "Applied on 5 Jul." });
  const appended = await a.call("/api/applications", "PUT", { id, append_note: "  Screening call   booked " });
  check("an append needs no read and lands on top", appended.status === 200 && new RegExp(`^${STAMP} Screening call booked\\nApplied on 5 Jul\\.$`).test(appended.body.notes), JSON.stringify(appended.body).slice(0, 160));
  check("it answers the version that goes with those notes", typeof appended.body.updated_at === "string" && appended.body.updated_at === (await detail(id)).updated_at);
  const both = await a.call("/api/applications", "PUT", { id, status: "Screening", append_note: "Moved by the sweep" });
  const afterBoth = await detail(id);
  check("an append beside a status change lands with it", both.status === 200 && afterBoth.status === "Screening" && afterBoth.notes.split("\n")[0].endsWith("Moved by the sweep"), afterBoth.status);
  const notesNow = afterBoth.notes;
  const blind = await a.call("/api/applications", "PUT", { id, status: "Interview", notes: "Rebuilt from a preview" });
  check("a replace without if_updated_at is a 409 stale_notes", blind.status === 409 && blind.body.error === "stale_notes", JSON.stringify(blind.body).slice(0, 120));
  const unchanged = await detail(id);
  check("and nothing in that write landed", unchanged.notes === notesNow && unchanged.status === "Screening");
  const fresh = await a.call("/api/applications", "PUT", { id, notes: `${notesNow}\nEdited on the page`, if_updated_at: unchanged.updated_at });
  check("a replace on the version just read lands, and says its new version", fresh.status === 200 && typeof fresh.body.updated_at === "string" && (await detail(id)).notes.endsWith("Edited on the page"));
  const stale = await a.call("/api/applications", "PUT", { id, notes: "Old copy", if_updated_at: unchanged.updated_at });
  check("the old version again is a 409", stale.status === 409 && stale.body.error === "stale_notes" && (await detail(id)).notes.endsWith("Edited on the page"));
  check("notes and append_note together are refused", (await a.call("/api/applications", "PUT", { id, notes: "x", append_note: "y", if_updated_at: fresh.body.updated_at })).status === 400);
  const patched = await a.call("/api/applications", "PATCH", { id, append_note: "From the Action Centre" });
  check("PATCH append_note uses the same stamp", patched.status === 200 && new RegExp(`^${STAMP} From the Action Centre\\n`).test(patched.body.notes));
  check("another user's row can't be appended to", (await b.call("/api/applications", "PUT", { id, append_note: "Not yours" })).status === 404);

  // Notes history and restore.
  const history = await a.call(`/api/applications/${id}/notes-history`);
  if (history.status === 503) {
    check("notes history says which migration it needs", history.body.errorType === "needs_migration" && /20261110120000/.test(history.body.error));
    skipped("notes history and restore");
  } else {
    // Appends, and a replace that only added a line, took nothing away: none is listed first.
    check("the history opens on changes that took text away: none so far", history.status === 200 && (history.body.history ?? []).length === 0 && history.body.total === 4, JSON.stringify(history.body).slice(0, 160));
    const every = await a.call(`/api/applications/${id}/notes-history?all=1`);
    const versions = every.body.history ?? [];
    check("every change kept the text before it, newest first", every.status === 200 && versions.length === 4 && versions.at(-1).old_notes === "Applied on 5 Jul." && versions.every((v) => v.lost_text === false), versions.map((v) => v.old_notes.split("\n")[0]).join(" | "));
    const current = await detail(id);
    const restored = await a.call("/api/applications", "PUT", { id, notes: versions.at(-1).old_notes, if_updated_at: current.updated_at });
    check("restoring the first version brings it back", restored.status === 200 && (await detail(id)).notes === "Applied on 5 Jul.");
    const after = (await a.call(`/api/applications/${id}/notes-history`)).body.history ?? [];
    check("and the notes it replaced are kept in turn, listed first as text taken away", after.length === 1 && after[0].old_notes === current.notes && after[0].lost_text === true);
    check("another user reads none of it", ((await b.call(`/api/applications/${id}/notes-history`)).body.history ?? []).length === 0);
  }

  // ── Step 2: company cooldown rules ───────────────────────────────────────────
  const rules = await a.call("/api/company-rules");
  if (rules.body.needsMigration) {
    check("with no table the rules read as none", rules.status === 200 && Array.isArray(rules.body.rules) && rules.body.rules.length === 0);
    check("and a write names the migration", (await a.call("/api/company-rules", "POST", { company_name: "Smoke Northwind", rule_type: "reapply_after_days", value: 365 })).status === 503);
    const rowNote = await add({ company_name: "Smoke Cooldown Ltd", status: "Applied" });
    const noted = await a.call("/api/applications", "PUT", { id: rowNote, status: "Rejected", append_note: "Rejected. Please wait at least one year before applying again." });
    check("a rejection note still saves without the table", noted.status === 200 && !noted.body.companyRules);
    skipped("company rules");
  } else {
    const saved = await a.call("/api/company-rules", "POST", { company_name: "Smoke Northwind", rule_type: "reapply_after_days", value: 365, anchor_date: "2026-07-05", source_text: "wait at least one year" });
    check("a rule saves", saved.status === 200 && saved.body.rule?.rule_type === "reapply_after_days" && saved.body.rule?.value === "365", JSON.stringify(saved.body).slice(0, 160));
    const twice = await a.call("/api/company-rules", "POST", { company_name: "Smoke Northwind Ltd", rule_type: "reapply_after_days", value: "365" });
    check("the same rule twice is answered, not doubled", twice.body.alreadySaved === true);
    check("bad input is refused", (await a.call("/api/company-rules", "POST", { company_name: "X", rule_type: "no_reapply_until", value: "next September" })).status === 400);
    check("another user sees none of it", ((await b.call("/api/company-rules")).body.rules ?? []).length === 0);
    const off = await a.call("/api/company-rules", "PUT", { id: saved.body.rule.id, dismissed: true });
    check("a rule is switched off, not deleted", off.status === 200 && !!off.body.rule?.dismissed_at && (await a.call("/api/company-rules")).body.rules.length === 1);
    check("another user can't switch it", (await b.call("/api/company-rules", "PUT", { id: saved.body.rule.id, dismissed: false })).status === 404);
    const rowNote = await add({ company_name: "Smoke Cooldown Ltd", status: "Applied" });
    const noted = await a.call("/api/applications", "PUT", { id: rowNote, status: "Rejected", append_note: "Rejected. Please wait at least one year before applying again." });
    check("a rejection that dates a wait becomes a rule", noted.status === 200 && noted.body.companyRules?.[0]?.value === "365", JSON.stringify(noted.body.companyRules));
    const read = (await a.call("/api/company-rules")).body.rules.find((r) => r.company_name === "Smoke Cooldown Ltd");
    check("anchored on the day it was written, from what they said", read?.anchor_date === londonDay(Date.now()) && /wait at least one year/.test(read?.source_text ?? "") && read?.source === "notes");
    const replaced = await add({ company_name: "Smoke Replace Ltd", status: "Applied", notes: "First note." });
    const version = (await detail(replaced)).updated_at;
    const byHand = await a.call("/api/applications", "PUT", { id: replaced, notes: "First note.\nPlease wait at least one year before applying again.", if_updated_at: version });
    check("a whole-notes replace never makes a rule on its own (the row offers it)", byHand.status === 200 && !byHand.body.companyRules);
    const intake = await add({ company_name: "Smoke Intake Ltd", status: "Applied" });
    const noDate = await a.call("/api/applications", "PUT", { id: intake, append_note: "We won't be able to accept any new applications from you this intake year." });
    check("an intake year with no date waits for the user's click", noDate.status === 200 && !noDate.body.companyRules);
  }

  // ── Step 3: the deadline radar ───────────────────────────────────────────────
  check("?due takes hours", (await a.call("/api/applications?due=2d")).status === 400);
  check("a bad address is refused", (await a.call("/api/applications", "PUT", { id, applied_from_email: "Gmail" })).status === 400);
  check("a bad deadline is refused", (await a.call("/api/applications", "PUT", { id, next_deadline: "tomorrow" })).status === 400);
  const tomorrow = londonDay(Date.now() + 86_400_000);
  const followup = await add({ company_name: "Smoke Follow Ltd", status: "Interview", followup_date: tomorrow });
  const due = Date.now() + 30 * 3_600_000;
  const assessment = await add({ company_name: "Smoke Greenbeam", status: "Applied" });
  const set = await a.call("/api/applications", "PUT", { id: assessment, next_deadline: new Date(due).toISOString(), applied_from_email: "second.inbox@example.com", deadline_note: "Complete the Smoke Greenbeam assessment" });
  // An assessment added in the plan (the Action Centre's way) is on the list too.
  const planned = await add({ company_name: "Smoke Planned Ltd", status: "Applied" });
  const planEvent = await a.call("/api/events", "POST", { application_id: planned, kind: "assessment", title: "Complete the online assessment", due_at: new Date(Date.now() + 20 * 3_600_000).toISOString() });
  const radar = await a.call("/api/applications?due=48h");
  if (planEvent.status === 200 || planEvent.status === 201) check("an assessment in the plan is on the 48-hour list", radar.body.due.some((d) => d.id === planned && d.kind === "event" && d.action === "Complete the online assessment"), JSON.stringify(radar.body.due.map((d) => d.kind)));
  else skipped(`the plan's events (POST /api/events answered ${planEvent.status})`);
  check("?due=48h answers the list", radar.status === 200 && Array.isArray(radar.body.due) && radar.body.hours === 48);
  check("a follow-up due tomorrow on an Interview row is on it", radar.body.due.some((d) => d.id === followup && d.kind === "followup" && d.status === "Interview" && d.action === "Follow up with Smoke Follow Ltd (Interview)"), JSON.stringify(radar.body.due).slice(0, 240));
  if (set.status === 503) {
    check("a deadline names the migration it needs", set.body.errorType === "needs_migration" && /20261110120000/.test(set.body.error));
    check("and the list says deadlines are missing", typeof radar.body.warning === "string" && /20261110120000/.test(radar.body.warning));
    const posted = await a.call("/api/applications", "POST", { company_name: "Smoke Posted", role: "Engineer", date_applied: "2026-11-10", next_deadline: "2026-11-12" });
    check("a POST with a deadline still saves, and says without what", posted.status === 200 && /20261110120000/.test(posted.body.warning ?? ""));
    skipped("deadlines and the applied-from address");
  } else {
    check("a deadline 30 hours away saves with the address", set.status === 200, JSON.stringify(set.body).slice(0, 160));
    const item = radar.body.due.find((d) => d.id === assessment);
    check("it is on the 48-hour list with the action in words", item?.kind === "deadline" && item.action === "Complete the Smoke Greenbeam assessment, invite went to second.inbox@example.com" && item.applied_from_email === "second.inbox@example.com", JSON.stringify(item));
    const listed = (await a.call("/api/applications")).body.applications.find((r) => r.id === assessment);
    check("the list row carries it for the strip", Date.parse(listed?.next_deadline ?? "") === Math.floor(due / 1000) * 1000 || Date.parse(listed?.next_deadline ?? "") === due, listed?.next_deadline);
    check("another user's list has none of it", ((await b.call("/api/applications?due=48h")).body.due ?? []).length === 0);
    const local = await a.call("/api/applications", "PUT", { id: followup, next_deadline: "2027-07-12T09:00" });
    const localRow = (await a.call("/api/applications")).body.applications.find((r) => r.id === followup);
    check("a time with no zone is London's: 09:00 BST is 08:00Z", local.status === 200 && Date.parse(localRow?.next_deadline ?? "") === Date.parse("2027-07-12T08:00:00Z"), localRow?.next_deadline);
    const done = await a.call("/api/applications", "PUT", { id: assessment, next_deadline: null, append_note: "Done: the assessment" });
    check("Done clears it and notes it", done.status === 200 && !(await a.call("/api/applications?due=48h")).body.due.some((d) => d.id === assessment) && /Done: the assessment/.test(done.body.notes));
    const posted = await a.call("/api/applications", "POST", { company_name: "Smoke Posted", role: "Engineer", date_applied: "2026-11-10", next_deadline: "2026-11-12", applied_from_email: "second.inbox@example.com" });
    const postedRow = (await a.call("/api/applications")).body.applications.find((r) => r.id === posted.body.id);
    check("a POST with a date-only deadline is due at 23:59 London", posted.status === 200 && Date.parse(postedRow?.next_deadline ?? "") === Date.parse("2026-11-12T23:59:00Z"), postedRow?.next_deadline);
  }

  // The plain list is still the sweeps' list.
  const list = await a.call("/api/applications");
  check("the plain GET is unchanged in shape", list.status === 200 && Array.isArray(list.body.applications) && !("due" in list.body));
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  let removed = 0;
  for (const user of users) if ((await fetch(`${SB}/auth/v1/admin/users/${user}`, { method: "DELETE", headers: admin })).ok) removed++;
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped; throwaway users removed: ${removed}/${users.length}`);
  process.exit(fail ? 1 : 0);
}
