// Tailoring evaluation harness — the FREE half (Brief 3). Reads the stored
// results of `node eval/run.mjs <label>` and asserts the four properties the
// brief names, using the same deterministic modules the app runs:
//   1. no numeric claim absent from the source CV        (lib/claims)
//   2. no tool/language in the skills line absent from it (lib/atsMatch)
//   3. output within the page limit                       (lib/quality)
//   4. bullet ordering differs between the two JDs of a CV (lib/quality)
// plus metrics that don't fail the run: learning skills present, weak
// bullets, inflation words, cover-letter words, run time.
//
//   node eval/assert.mjs <label> [<label2>]   (a second label prints a comparison)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = join(HERE, "..");
const { checkClaims } = await import(pathToFileURL(join(PROJ, "src/lib/claims.ts")));
const { matchAtsKeywords, tailoredSectionsText } = await import(pathToFileURL(join(PROJ, "src/lib/atsMatch.ts")));
const { estimatePages, weakBullets, inflationHits, orderingDiffers, findDuplicateContent, relevanceBoltOns } = await import(pathToFileURL(join(PROJ, "src/lib/quality.ts")));
const { coreTitle, titleInText } = await import(pathToFileURL(join(PROJ, "src/lib/roleTitle.ts")));

const pairs = JSON.parse(readFileSync(join(HERE, "pairs.json"), "utf8"));
const labels = process.argv.slice(2).filter((l) => /^[\w-]+$/.test(l));
if (labels.length === 0) { console.log("usage: node eval/assert.mjs <label> [<label2>]"); process.exit(2); }

function loadRun(label, cvId, jdId) {
  const file = join(HERE, "out", label, `${cvId}--${jdId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

// Tools/languages in the skills line: the "Technical Tools:" items on a
// technical CV, or the flat list otherwise. Functional-competency phrases
// are capabilities, not claims of a named tool, and are skipped.
function toolItems(skills) {
  const lines = String(skills || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tools = lines.find((l) => /^technical tools\s*:/i.test(l));
  const source = tools ? tools.replace(/^technical tools\s*:/i, "") : lines.some((l) => /^functional competencies\s*:/i.test(l)) ? "" : lines.join(" | ");
  return source
    .split(/\s*\|\s*|,\s*/)
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
}

function evaluate(label) {
  const rows = [];
  for (const cv of pairs.cvs) {
    const runs = cv.jds.map((jd) => ({ jd, run: loadRun(label, cv.id, jd.id) }));
    for (const { jd, run } of runs) {
      if (!run || run.status !== 200 || !run.result || typeof run.result !== "object") {
        rows.push({ cv: cv.id, jd: jd.id, missing: true });
        continue;
      }
      const d = run.result;
      const sections = { summary: d.summary, skills: d.skills, experience: d.experience, projects: d.projects };
      const text = tailoredSectionsText(sections);
      const check = checkClaims([{ where: "cv", text }, { where: "coverLetter", text: d.coverLetter ?? "", extraSources: [jd.text] }], null, [cv.text]);
      const absentFigures = check.numberViolations.filter((n) => n.kind === "absent");
      const tools = toolItems(d.skills);
      const absentTools = tools.filter((t) => matchAtsKeywords(cv.text, [t]).matched === 0);
      const pages = estimatePages(sections, { projects: [], education: [], certifications: [], rightToWork: [] });
      const learningPresent = (cv.learning ?? []).filter((s) => matchAtsKeywords([text, d.coverLetter ?? ""].join("\n"), [s]).matched > 0);
      const weak = weakBullets(d.experience, d.projects);
      const bullets = String(d.experience || "").split("\n").filter((l) => /^\s*[•\-*]\s+/.test(l)).length;
      const inflation = inflationHits([d.summary, d.experience, d.coverLetter].join("\n"));
      const company = typeof d.analysis?.company_name === "string" ? d.analysis.company_name : undefined;
      const boltOns = relevanceBoltOns(d.experience, d.projects, company);
      const retried = d.bulletLint ? (d.bulletLint.retried?.experience ? 1 : 0) + (d.bulletLint.retried?.projects ? 1 : 0) : 0;
      // The exact role title must be in the summary (hard assertion).
      const title = coreTitle(d.analysis?.role_title);
      const titleMissing = !!title && !titleInText(d.summary, title);
      const dup = findDuplicateContent(sections, { projects: [], education: [] });
      const letterWords = String(d.coverLetter || "").trim().split(/\s+/).filter(Boolean).length;
      rows.push({
        cv: cv.id, jd: jd.id, ms: run.ms,
        absentFigures: absentFigures.map((n) => n.figure),
        absentTools,
        pages: pages.pages, overBudget: pages.overBudget,
        learningPresent, weak: weak.length, bullets, inflation: inflation.reduce((n, h) => n + h.count, 0),
        duplicates: dup.length, letterWords, boltOns: boltOns.length, retried, title, titleMissing,
        refused: !d.experience || !d.summary,
      });
    }
    const [a, b] = runs.map((r) => r.run?.result);
    if (a && b && typeof a === "object" && typeof b === "object") {
      const differs = orderingDiffers(a.experience, b.experience);
      for (const row of rows.filter((r) => r.cv === cv.id)) row.orderingDiffers = differs;
    }
  }
  return rows;
}

function summarize(label, rows) {
  const present = rows.filter((r) => !r.missing);
  const hardFails = [];
  for (const r of present) {
    if (r.absentFigures.length) hardFails.push(`${r.cv}×${r.jd}: figures not in the CV: ${r.absentFigures.join(", ")}`);
    if (r.absentTools.length) hardFails.push(`${r.cv}×${r.jd}: tools not in the CV: ${r.absentTools.join(", ")}`);
    if (r.overBudget) hardFails.push(`${r.cv}×${r.jd}: over two pages (${r.pages})`);
    if (r.titleMissing) hardFails.push(`${r.cv}×${r.jd}: role title "${r.title}" absent from the summary`);
    // reported per CV below; the run-level rule is two or more identical CVs
  }
  const sameCvs = [...new Set(present.filter((r) => r.orderingDiffers === false).map((r) => r.cv))];
  if (sameCvs.length >= 2) hardFails.push(`bullet ordering identical across both JDs for ${sameCvs.length} CVs: ${sameCvs.join(", ")}`);
  for (const r of present) {
    if (r.refused) hardFails.push(`${r.cv}×${r.jd}: a section is empty (refusal or failure)`);
  }
  const sum = (k) => present.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const metrics = {
    runs: present.length,
    missing: rows.length - present.length,
    absentFigures: sum("absentFigures.length") || present.reduce((n, r) => n + r.absentFigures.length, 0),
    absentTools: present.reduce((n, r) => n + r.absentTools.length, 0),
    overBudget: present.filter((r) => r.overBudget).length,
    orderingSame: present.filter((r) => r.orderingDiffers === false).length / 2,
    learningLeaks: present.reduce((n, r) => n + r.learningPresent.length, 0),
    weakBullets: sum("weak"),
    bullets: sum("bullets"),
    inflation: sum("inflation"),
    boltOns: sum("boltOns"),
    retried: sum("retried"),
    duplicates: sum("duplicates"),
    avgPages: present.length ? Math.round((sum("pages") / present.length) * 100) / 100 : 0,
    avgLetterWords: present.length ? Math.round(sum("letterWords") / present.length) : 0,
    avgMs: present.length ? Math.round(sum("ms") / present.length) : 0,
  };
  return { hardFails, metrics };
}

const results = labels.map((label) => ({ label, rows: evaluate(label), ...summarize(label, evaluate(label)) }));
for (const r of results) {
  console.log(`\n=== ${r.label}`);
  for (const row of r.rows) {
    if (row.missing) { console.log(`  --  ${row.cv} × ${row.jd}: no stored run`); continue; }
    console.log(
      `  ${row.cv} × ${row.jd}: figures✗${row.absentFigures.length} tools✗${row.absentTools.length} pages ${row.pages}${row.overBudget ? " OVER" : ""} ` +
        `order ${row.orderingDiffers === undefined ? "?" : row.orderingDiffers ? "differs" : "SAME"} learning ${row.learningPresent.length ? row.learningPresent.join("/") : "-"} ` +
        `weak ${row.weak}/${row.bullets} filler ${row.inflation} boltons ${row.boltOns} retried ${row.retried} dup ${row.duplicates} letter ${row.letterWords}w ${row.ms}ms`
    );
  }
  console.log("  metrics:", JSON.stringify(r.metrics));
  if (r.hardFails.length) { console.log("  HARD FAILS:"); for (const f of r.hardFails) console.log("   - " + f); }
  else console.log("  hard assertions: all pass");
}
if (results.length === 2) {
  const [a, b] = results;
  console.log(`\n=== ${a.label} → ${b.label}`);
  for (const k of Object.keys(a.metrics)) {
    if (a.metrics[k] !== b.metrics[k]) console.log(`  ${k}: ${a.metrics[k]} → ${b.metrics[k]}`);
  }
}
process.exit(results.some((r) => r.hardFails.length) ? 1 : 0);
