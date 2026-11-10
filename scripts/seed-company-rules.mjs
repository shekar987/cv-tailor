// Seeds one account's company reapply rules (Chunk 21, table company_rules) from a JSON file
// kept OUTSIDE the repo, because the rules name the companies someone applied to:
//
//   { "email": "<the account's email>",
//     "rules": [ { "company_name": "…", "rule_type": "reapply_after_days", "value": 365,
//                  "anchor_date": "2026-07-05", "source_text": "wait at least one year" }, … ] }
//
// Each rule is checked by lib/companyRules readRuleInput, exactly as POST /api/company-rules
// checks it, and one the account already holds is skipped. Dry run by default; --apply writes
// (source "seed"). Needs migration 20261110120000 applied and SUPABASE_SECRET_KEY in .env.local.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-company-rules.mjs <file.json>            show what it would add
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-company-rules.mjs <file.json> --apply    add it
import fs from "node:fs";
import { readRuleInput, ruleExists, normalizeRule } from "../src/lib/companyRules.ts";

const file = process.argv[2];
const apply = process.argv.includes("--apply");
if (!file) throw new Error("Usage: node scripts/seed-company-rules.mjs <file.json> [--apply]");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SECRET = env.SUPABASE_SECRET_KEY;
if (!SB || !SECRET) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env.local.");
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

const seed = JSON.parse(fs.readFileSync(file, "utf8"));
const email = String(seed.email ?? "").trim().toLowerCase();
if (!email || !Array.isArray(seed.rules)) throw new Error('The file needs "email" and a "rules" list.');

// The account, by its email, from the auth admin API (pages of 1000).
let userId = null;
for (let page = 1; !userId; page++) {
  const res = await fetch(`${SB}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: admin });
  if (!res.ok) throw new Error(`Could not list accounts (HTTP ${res.status}).`);
  const users = (await res.json()).users ?? [];
  userId = users.find((u) => String(u.email ?? "").toLowerCase() === email)?.id ?? null;
  if (users.length < 1000) break;
}
if (!userId) throw new Error("No account has that email.");

const existingRes = await fetch(`${SB}/rest/v1/company_rules?user_id=eq.${userId}&select=*`, { headers: admin });
if (existingRes.status === 404 || existingRes.status === 400) {
  const body = await existingRes.text();
  if (/company_rules/.test(body)) throw new Error("The company_rules table is missing: apply migration 20261110120000 first.");
}
if (!existingRes.ok) throw new Error(`Could not read the existing rules (HTTP ${existingRes.status}).`);
const existing = (await existingRes.json()).map(normalizeRule).filter(Boolean);

const toAdd = [];
for (const raw of seed.rules) {
  const read = readRuleInput(raw);
  if ("error" in read) {
    console.log(`REFUSED ${raw.company_name ?? "?"}: ${read.error}`);
    continue;
  }
  if (ruleExists([...existing, ...toAdd], read.rule)) {
    console.log(`HELD    ${read.rule.company_name}: ${read.rule.rule_type} ${read.rule.value} (already saved)`);
    continue;
  }
  toAdd.push(read.rule);
  console.log(`${apply ? "ADD    " : "WOULD ADD"} ${read.rule.company_name}: ${read.rule.rule_type} ${read.rule.value}${read.rule.anchor_date ? ` from ${read.rule.anchor_date}` : ""} — "${read.rule.source_text}"`);
}

if (apply && toAdd.length > 0) {
  const res = await fetch(`${SB}/rest/v1/company_rules`, {
    method: "POST",
    headers: { ...admin, Prefer: "return=minimal" },
    body: JSON.stringify(toAdd.map((r) => ({ ...r, source: "seed", user_id: userId }))),
  });
  if (!res.ok) throw new Error(`Insert failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
}
console.log(`\n${toAdd.length} rule(s) ${apply ? "added" : "to add — run again with --apply to write them"}.`);
