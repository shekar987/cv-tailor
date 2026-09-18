// One-off backfill: tracker rows saved before the snapshot carried a score.
//
// Every tailored save wrote "Search visibility: 13/15 keywords, 10/10
// required skills" (older rows: "ATS match: …") into the row's notes from the
// reconciled, deterministic counts — the same numbers the save path now
// stores as ats.keywords / ats.required. The keyword LISTS were never kept,
// so the backfill stores the counts alone (source: "notes"); lib/insights
// reads counts and lists the same way. The eligibility read is recomputed
// from the stored job description against the user's current eligibility
// profile (source: "backfill"), and the role seniority from the title.
// Rows that already carry ats/gates/seniority are left alone. Notes that
// say "ATS match:" (the metric's old name) are relabelled "Search visibility:".
//
// Reads SUPABASE_SECRET_KEY from .env.local (never referenced by src/).
//   node scripts/backfill-tracker-scores.mjs          # dry run: report only
//   node scripts/backfill-tracker-scores.mjs --apply  # write the rows
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJ = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const env = {};
for (const line of readFileSync(join(PROJ, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY;
if (!BASE || !KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing from .env.local");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const { seniorityOf } = await import(pathToFileURL(join(PROJ, "src/lib/insights.ts")));
const { detectGates, compareGates, readVerdict, summarizeGates, normalizeEligibility } = await import(pathToFileURL(join(PROJ, "src/lib/knockouts.ts")));

async function rest(path, init = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// The reconciled line the Applied button wrote. The first prose sentence is
// the model's own wording and is deliberately NOT read.
const SCORE_LINE_RE = /^(?:ATS match|Search visibility):\s*(\d{1,3})\/(\d{1,3})\s*keywords(?:,\s*(\d{1,3})\/(\d{1,3})\s*required skills)?/m;

const rows = [];
for (let from = 0; ; from += 1000) {
  const page = await rest(`applications?select=id,user_id,role,status,source,notes,job_description,tailored_cv&tailored_cv=not.is.null&order=created_at.asc`, {
    headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" },
  });
  rows.push(...page);
  if (page.length < 1000) break;
}
const userIds = [...new Set(rows.map((r) => r.user_id))];
const settings = new Map();
for (const uid of userIds) {
  const s = await rest(`user_settings?user_id=eq.${uid}&select=eligibility`);
  if (s[0]?.eligibility) settings.set(uid, normalizeEligibility(s[0].eligibility));
}

const stats = { rows: rows.length, alreadyScored: 0, scoredFromNotes: 0, noScoreLine: 0, gatesAdded: 0, gatesSkipped: 0, seniorityAdded: 0, notesRelabelled: 0, updated: 0 };
const updates = [];
for (const r of rows) {
  const cv = r.tailored_cv && typeof r.tailored_cv === "object" ? { ...r.tailored_cv } : null;
  if (!cv) continue;
  let changed = false;
  if (cv.ats && typeof cv.ats === "object") stats.alreadyScored++;
  else {
    const m = SCORE_LINE_RE.exec(r.notes || "");
    if (m) {
      const kw = { matched: +m[1], total: +m[2] };
      const ats = { keywords: kw, source: "notes", computedAt: new Date().toISOString() };
      if (m[3] !== undefined) ats.required = { matched: +m[3], total: +m[4] };
      if (kw.total > 0 && kw.matched <= kw.total) {
        cv.ats = ats;
        changed = true;
        stats.scoredFromNotes++;
      } else stats.noScoreLine++;
    } else stats.noScoreLine++;
  }
  if (!(cv.gates && typeof cv.gates === "object")) {
    const elig = settings.get(r.user_id);
    const jd = typeof r.job_description === "string" ? r.job_description : "";
    if (elig && jd.length > 200) {
      const verdicts = compareGates(detectGates(jd), elig);
      const kw = cv.ats?.keywords;
      const top15 = kw && typeof kw.matched === "number" && typeof kw.total === "number" ? { matched: kw.matched, total: kw.total } : null;
      const req = cv.ats?.required && typeof cv.ats.required.matched === "number" ? { matched: cv.ats.required.matched, total: cv.ats.required.total } : null;
      const read = readVerdict(verdicts, req, top15);
      const summary = summarizeGates(verdicts, read.read);
      cv.gates = { read: summary.read, hard: summary.hard, soft: summary.soft, unknown: summary.unknown, items: summary.items.map((g) => ({ category: g.category, verdict: g.verdict })), source: "backfill" };
      changed = true;
      stats.gatesAdded++;
    } else stats.gatesSkipped++;
  }
  if (!cv.seniority && typeof r.role === "string" && r.role.trim()) {
    cv.seniority = seniorityOf(r.role);
    changed = true;
    stats.seniorityAdded++;
  }
  // One name for the metric: older rows wrote "ATS match:", the app now
  // writes "Search visibility:".
  const notes = typeof r.notes === "string" && /^ATS match:/m.test(r.notes) ? r.notes.replace(/^ATS match:/gm, "Search visibility:") : null;
  if (notes) stats.notesRelabelled++;
  if (changed || notes) updates.push({ id: r.id, ...(changed ? { tailored_cv: cv } : {}), ...(notes ? { notes } : {}) });
}

console.log(JSON.stringify({ ...stats, toUpdate: updates.length, apply: APPLY }, null, 1));
if (!APPLY) {
  console.log("dry run — re-run with --apply to write");
  process.exit(0);
}
for (const u of updates) {
  const { id, ...patch } = u;
  await rest(`applications?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  stats.updated++;
}
console.log("updated rows:", stats.updated);
