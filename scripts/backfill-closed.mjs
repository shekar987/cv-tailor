// One-off backfill (Chunk 15): rows that reached screening or further and already ended get
// closed_at from updated_at and close_reason from their status (lib/closing backfillPatch).
// Rows still in Screening or Interview are left alone: the user moves those themselves.
//
// Reads SUPABASE_SECRET_KEY from .env.local (never referenced by src/). Needs migration
// 20261104130000. A dry run lists every row it would change and writes nothing.
//   node scripts/backfill-closed.mjs          # the preview
//   node scripts/backfill-closed.mjs --apply  # write those rows
import { readFileSync } from "node:fs";
import { backfillPatch } from "../src/lib/closing.ts";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY;
if (!BASE || !KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing from .env.local");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const COLUMNS = "id,company_name,role,status,stages_reached,closed_at,updated_at";
const PAGE = 1000;
const changes = [];
for (let from = 0; ; from += PAGE) {
  const res = await fetch(`${BASE}/rest/v1/applications?select=${COLUMNS}&order=id.asc&limit=${PAGE}&offset=${from}`, { headers });
  if (!res.ok) throw new Error(`Read failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  for (const row of rows) {
    const patch = backfillPatch(row);
    if (patch) changes.push({ row, patch });
  }
  if (rows.length < PAGE) break;
}

console.log(`${changes.length} ${changes.length === 1 ? "row" : "rows"} would be closed:`);
for (const { row, patch } of changes) console.log(`  ${row.company_name} — ${row.role}: ${patch.close_reason}, ${patch.closed_at.slice(0, 10)}`);
if (!APPLY) {
  console.log("Dry run: nothing was written. Run with --apply to write these.");
  process.exit(0);
}
let written = 0;
for (const { row, patch } of changes) {
  const res = await fetch(`${BASE}/rest/v1/applications?id=eq.${row.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (res.ok) written++;
  else console.error(`Could not write ${row.id}: ${res.status}`);
}
console.log(`Wrote ${written} of ${changes.length}.`);
process.exit(written === changes.length ? 0 : 1);
