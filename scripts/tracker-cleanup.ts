// The tracker clean-up's dry run for one account, read-only (6 Nov 2026, Chunk 19):
//   node scripts/tracker-cleanup.ts --email you@example.com [--json]
// Prints what POST /api/applications/cleanup { dryRun: true } would list: Rule A
// (cadences to close), Rule B (duplicates, with why any must be merged by hand)
// and Rule C (report only). It never writes: every write method throws. Applying
// is done in the app, by ticking rows on /applications → Clean-up, signed in as
// the account's owner. Reads SUPABASE_SECRET_KEY from .env.local (never src/).
import fs from "node:fs";
import { planCleanup, type Attachments, type CleanupRow } from "../src/lib/trackerCleanup.ts";

const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1];
if (!email || args.indexOf("--email") < 0) throw new Error("Usage: node scripts/tracker-cleanup.ts --email you@example.com [--json]");
if (args.includes("--apply")) throw new Error("This script is a dry run only. Apply from /applications → Clean-up, signed in.");

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` };
const get = async (path: string) => {
  const res = await fetch(`${SB}${path}`, { headers: admin });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const users = (await get(`/auth/v1/admin/users?per_page=1000`)).users as { id: string; email: string }[];
const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) throw new Error(`No account for ${email}.`);

const cols = "id,company_name,role,status,date_applied,followup_date,notes,created_at,stages_reached,tailor_session_id,sent_cv_name:sent_cv->>fileName,prep_generated_at:prep_pack->>generatedAt";
const rows: CleanupRow[] = [];
for (let from = 0; from < 5000; from += 1000) {
  const res = await fetch(`${SB}/rest/v1/applications?user_id=eq.${user.id}&select=${cols}&order=date_applied.desc,created_at.desc,id.asc`, { headers: { ...admin, Range: `${from}-${from + 999}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const page = (await res.json()) as CleanupRow[];
  rows.push(...page);
  if (page.length < 1000) break;
}
const attachments = new Map<string, Attachments>();
const ids = rows.map((r) => r.id);
for (let i = 0; i < ids.length; i += 150) {
  const list = ids.slice(i, i + 150).join(",");
  for (const [table, key] of [["application_events", "events"], ["mock_interviews", "interviews"]] as const) {
    const found = (await get(`/rest/v1/${table}?application_id=in.(${list})&select=application_id`)) as { application_id: string }[];
    for (const f of found) {
      const a = attachments.get(f.application_id) ?? { events: 0, interviews: 0 };
      a[key] += 1;
      attachments.set(f.application_id, a);
    }
  }
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const plan = planCleanup(rows, attachments, today);
if (args.includes("--json")) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  const mergeable = plan.ruleB.flatMap((g) => g.duplicates).filter((d) => !d.blocked).length;
  console.log(`Dry run for ${email} on ${today}: ${rows.length} rows read, nothing written.\n`);
  console.log(`Rule A, cadences to close: ${plan.ruleA.length}`);
  for (const a of plan.ruleA) console.log(`  ${a.company_name} | ${a.role} | applied ${a.date_applied} (${a.days_since_applied} days) | follow-up ${a.followup_date}`);
  console.log(`\nRule B, duplicate groups: ${plan.ruleB.length} (${plan.ruleB.reduce((s, g) => s + g.duplicates.length, 0)} duplicates, ${mergeable} mergeable)`);
  for (const g of plan.ruleB) {
    console.log(`  keep ${g.keep.company_name} | ${g.keep.role} | ${g.keep.status} | ${g.keep.date_applied}`);
    for (const d of g.duplicates) console.log(`    ${d.blocked ? `by hand (${d.blocked})` : `merge${d.newKeepStatus ? `, kept row becomes ${d.newKeepStatus}` : ""}`}: ${d.role} | ${d.status} | ${d.date_applied}`);
  }
  console.log(`\nRule C, report only: ${plan.ruleC.readyToSubmit.length} Ready to submit over 3 days, ${plan.ruleC.genericRoles.length} generic roles, ${plan.ruleC.roleNotShown.length} roles not shown`);
}
