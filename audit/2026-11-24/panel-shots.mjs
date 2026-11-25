// JH-5 before/after verification (24 Nov 2026). No browser dependency beyond a local
// Chromium (Edge/Chrome) driven through its --screenshot CLI; no server, no Supabase, no
// model call. It renders the REAL new InterviewsPanel (via the tsx loader) and reconstructs
// the OLD panel (markup + the globals.css from `main`) with the same 9 made-up items, so the
// two PNGs are a faithful like-for-like. A dashed red line marks a 375x667 phone fold and a
// green bar marks where the Applications table would start.
//
//   node --import ../../tests/support/tsxLoader.mjs audit/2026-11-24/panel-shots.mjs
//
// Run from the repo root. Writes before/after PNGs + HTML into audit/2026-11-24/screenshots.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InterviewsPanel from "../../src/app/applications/InterviewsPanel.tsx";
import { upcomingInterviews } from "../../src/lib/interviewsPanel.ts";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const outDir = path.join(root, "audit", "2026-11-24", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const browser = BROWSERS.find((p) => fs.existsSync(p));

const now = Date.parse("2026-11-24T09:00:00Z");
// 9 upcoming items: 2 interviews, 1 screening, 2 assessments, plus more — the 23 Nov case.
const kinds = ["assessment", "interview", "screening_call", "assessment", "interview", "take_home", "video", "work_trial", "interview"];
const companies = ["bp", "Monzo", "Greenfield Labs", "Accenture", "Ellipse", "Northwind", "Starlight", "Harbour Co", "Meridian"];
const statuses = ["rejected", "interview", "applied", "applied", "applied", "applied", "screening", "applied", "rejected"];
const rows = companies.map((c, i) => ({ id: `r${i}`, company_name: c, role: "Software Engineer", status: statuses[i] }));
const events = companies.map((c, i) => ({
  id: `e${i}`,
  application_id: `r${i}`,
  kind: kinds[i],
  title: "",
  status: "scheduled",
  // staggered a few hours apart, the first one slightly overdue
  starts_at: new Date(now + (i - 0.3) * 3 * 3600_000).toISOString(),
}));
const items = upcomingInterviews(rows, events, now, "Europe/London");

const css = fs.readFileSync(path.join(root, "src", "app", "globals.css"), "utf8");
const oldCss = execSync("git show main:src/app/globals.css", { cwd: root, maxBuffer: 20 * 1024 * 1024 }).toString();

const STATUS_LABELS = { rejected: "Rejected", interview: "Interview", applied: "Applied", screening: "Screening", assessment: "Assessment" };
const KIND_LABELS = { interview: "Interview", screening_call: "Screening call", assessment: "Assessment", take_home: "Take-home", video: "Video interview", work_trial: "Work trial" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The OLD panel's markup, as it was on main before JH-5 (9 items, 2-3 buttons each, sub-line).
function oldPanel(list) {
  const li = list
    .map((it) => {
      const stage = STATUS_LABELS[it.impliedStatus] || it.impliedStatus;
      const flag = it.needsMove ? `<span class="interviewsPanel__flag">Row says ${esc(it.currentStatus ? STATUS_LABELS[it.currentStatus] : "unknown")}</span>` : "";
      const move = it.needsMove ? `<button class="appsActionBtn interviewsPanel__move">Move to ${esc(stage)}</button>` : "";
      const cal = it.at ? `<button class="appsActionBtn">Add to calendar</button>` : "";
      return `<li class="interviewsPanel__item${it.overdue ? " interviewsPanel__item--overdue" : ""}">
        <span class="interviewsPanel__kind">${esc(it.kindLabel)}</span>
        <span class="interviewsPanel__when">${esc(it.when)}${it.left ? `<span class="interviewsPanel__left"> · ${esc(it.left)}</span>` : ""}</span>
        <span class="interviewsPanel__who">${esc(it.company_name)}<span class="interviewsPanel__role"> · ${esc(it.role)}</span></span>
        ${flag}
        <span class="interviewsPanel__buttons">${move}${cal}<a class="appsActionBtn">Prep pack</a></span>
      </li>`;
    })
    .join("\n");
  return `<section class="interviewsPanel" data-interviews-panel="${list.length}">
    <h2 class="interviewsPanel__title">⚑ Interviews &amp; deadlines <span class="interviewsPanel__count">${list.length}</span></h2>
    <p class="interviewsPanel__sub">Booked interviews, screenings and assessments — from your events, so one still shows if its status is wrong.</p>
    <ol class="interviewsPanel__list">${li}</ol>
  </section>`;
}

const newPanel = renderToStaticMarkup(createElement(InterviewsPanel, { items, busyId: null, onMove: () => {} }));

function page(bodyCss, panelHtml, width) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${bodyCss}
html,body{margin:0;background:var(--bg,#161618);}
.harnessWrap{width:${width}px;padding:12px;box-sizing:border-box;}
.harnessTitle{color:var(--text,#eee);font:600 21px/1.2 system-ui;margin:0 0 12px;}
.tableMark{margin-top:4px;padding:8px 10px;background:#1f6f43;color:#dfffe9;font:600 13px/1.3 system-ui;border-radius:6px;}
.fold{position:absolute;left:0;width:${width}px;top:667px;border-top:2px dashed #ff5a5a;}
.fold span{position:absolute;right:4px;top:-18px;color:#ff5a5a;font:600 11px system-ui;}
</style></head><body>
<div class="fold"><span>375×667 phone fold ↑ above visible without scrolling</span></div>
<div class="harnessWrap">
  <h1 class="harnessTitle">Applications</h1>
  ${panelHtml}
  <div class="tableMark">▼ Applications table starts here (first row)</div>
</div></body></html>`;
}

const files = {
  "jh5-panel-before-mobile.html": page(oldCss, oldPanel(items), 375),
  "jh5-panel-after-mobile.html": page(css, newPanel, 375),
  "jh5-panel-after-desktop.html": page(css, newPanel, 1280),
};
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), html);
console.log("HTML written to", outDir);

if (!browser) {
  console.log("No local Chromium found — open the HTML files in a browser at the given width to screenshot.");
  process.exit(0);
}
console.log("Using", browser);
for (const name of Object.keys(files)) {
  const htmlPath = path.join(outDir, name);
  const png = htmlPath.replace(/\.html$/, ".png");
  const width = name.includes("desktop") ? 1280 : 375;
  try {
    execFileSync(browser, [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--screenshot=${png}`,
      `--window-size=${width},1700`,
      "--default-background-color=161618ff",
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ], { stdio: "pipe", timeout: 60000 });
    console.log("shot", path.basename(png), fs.existsSync(png) ? `${fs.statSync(png).size} bytes` : "MISSING");
  } catch (e) {
    console.log("screenshot failed for", name, "-", e.message.split("\n")[0]);
  }
}
