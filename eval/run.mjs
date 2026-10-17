// Tailoring evaluation harness — the PAID half (Brief 3). Runs every CV/JD
// pair in eval/pairs.json through POST /api/tailor on a local server and
// stores the raw results under eval/out/<label>/. Ten tailor runs, roughly
// 80 model calls on the owner's key — run it on purpose, not in a loop.
//
//   node eval/run.mjs <label>          (server on http://localhost:3000)
//   node eval/run.mjs <label> --style careerset   (the CareerSet style, lib/formatStyles)
//   node eval/assert.mjs <label>       (free: the assertions)
//
// --style sends formatStyle in the tailor body. The route honours a style
// other than UKJI for the owner's account only (profiles.is_unlimited), so
// for a CareerSet label each throwaway user is flagged unlimited through the
// admin API right after it is created (the service role bypasses the
// column grant that keeps users from flagging themselves); a UKJI label
// leaves the users exactly as before.
//
// Needs .env.local with SUPABASE_SECRET_KEY (throwaway users, one per CV,
// deleted afterwards; each has 3 free tailors a day, each CV needs 2).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = join(HERE, "..");
const BASE = process.env.EVAL_BASE || "http://localhost:3000";
const argv = process.argv.slice(2);
const styleAt = argv.indexOf("--style");
const style = styleAt >= 0 ? argv[styleAt + 1] : "ukji";
const label = argv.filter((a, i) => styleAt < 0 || (i !== styleAt && i !== styleAt + 1))[0];
if (!label || !/^[\w-]+$/.test(label) || (style !== "ukji" && style !== "careerset")) {
  console.log("usage: node eval/run.mjs <label> [--style ukji|careerset]");
  process.exit(2);
}

const env = {};
for (const line of readFileSync(join(PROJ, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
if (!SB_URL || !PUB || !SECRET) throw new Error("missing supabase env in .env.local");
const REF = new URL(SB_URL).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

async function throwaway(tag) {
  const email = `eval-${tag}-${Date.now()}@example.com`, password = "Eval-test-9911!";
  const u = await (await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error("admin create user failed: " + JSON.stringify(u));
  if (style !== "ukji") {
    // The signup trigger has made the profiles row; flag it unlimited so the
    // tailor route honours the requested style (see the header).
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${u.id}`, {
      method: "PATCH",
      headers: { ...admin, Prefer: "return=representation" },
      body: JSON.stringify({ is_unlimited: true }),
    });
    const rows = await p.json().catch(() => null);
    if (!p.ok || !Array.isArray(rows) || rows.length !== 1 || rows[0].is_unlimited !== true) {
      throw new Error("could not flag the throwaway user unlimited: " + p.status + " " + JSON.stringify(rows));
    }
  }
  const s = await (await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const b64 = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64url");
  const name = `sb-${REF}-auth-token`;
  const parts = [];
  if (b64.length <= 3180) parts.push(`${name}=${b64}`);
  else for (let i = 0, n = 0; i < b64.length; i += 3180, n++) parts.push(`${name}.${n}=${b64.slice(i, i + 3180)}`);
  return {
    id: u.id,
    cookie: parts.join("; "),
    async remove() {
      await fetch(`${SB_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } });
    },
  };
}

const pairs = JSON.parse(readFileSync(join(HERE, "pairs.json"), "utf8"));
const outDir = join(HERE, "out", label);
mkdirSync(outDir, { recursive: true });

let ok = 0, failed = 0;
for (const cv of pairs.cvs) {
  const user = await throwaway(cv.id);
  try {
    for (const jd of cv.jds) {
      const t0 = Date.now();
      const r = await fetch(`${BASE}/api/tailor`, {
        method: "POST",
        headers: { Cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: jd.text, cvText: cv.text, projectNames: [], formatStyle: style }),
      });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      const file = join(outDir, `${cv.id}--${jd.id}.json`);
      writeFileSync(file, JSON.stringify({ cv: cv.id, jd: jd.id, style, status: r.status, ms: Date.now() - t0, result: json ?? text }, null, 2));
      if (r.status === 200 && json && json.formatStyle !== style) {
        console.log(`  WARN the server ran ${json.formatStyle} for a ${style} request (is the user unlimited?)`);
      }
      if (r.status === 200) ok++; else failed++;
      console.log(`${r.status === 200 ? " ok " : "FAIL"} ${cv.id} × ${jd.id}  ${r.status}  ${Date.now() - t0} ms`);
    }
  } finally {
    await user.remove();
  }
}
console.log(`\n${ok} runs stored under eval/out/${label} (${style} style), ${failed} failed`);
process.exit(failed ? 1 : 0);
