// Unit tests for project links (repository + live site under each project). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanUrl,
  displayUrl,
  projectCoreName,
  projectKey,
  linksInLine,
  linksFromText,
  linkParts,
  linksText,
  autoProjectLinks,
  linksForProject,
  attachProjectLinks,
  normalizeProjectLinks,
  repoLabel,
  MAX_SAVED_PROJECTS,
} from "../src/lib/projectLinks.ts";

// The owner's master CV and pool, as they write their projects.
const CV = `PROJECTS

Jobhuntz — Full-Stack AI Application · 2026
Next.js 16, TypeScript, Supabase (Postgres, Auth, RLS), Anthropic Claude API, Vercel
Live: https://www.jobhuntz.app/ · GitHub: https://github.com/shekar987/cv-tailor

- Architected an 8-step LLM pipeline (JD analysis → tailored CV and cover letter → ATS scoring)

RideX — Full-Stack Ride-Hailing Platform (personal portfolio project modelled on a real-world brief) · 2025
React 19, Firebase, Stripe, Mapbox, Vercel
Live: https://uber-demo-omega.vercel.app/ · GitHub: https://github.com/shekar987/RideX-app

- Delivered in under 12 weeks with automated GitHub → Vercel CI/CD

CampaignPulse — Event-Driven Data Pipeline
AWS Lambda, SQS, Python

- Built an event-driven processing pipeline on AWS Lambda and SQS

FinSight — Financial Data ETL
Python, SEC EDGAR filings

- Built a Python ETL pipeline`;

const POOL = `Jobhuntz — Full-Stack AI Application (GitHub)
Next.js 16, TypeScript, Supabase (Postgres, Auth, RLS), Anthropic Claude API, Vercel
Live: jobhuntz.app
 2026
• End-to-end LLM product combining full-stack engineering with applied AI

CampaignPulse — Event-Driven Campaign Delivery Reliability Platform (GitHub)          2026
React 19, TypeScript, Node.js, GraphQL, PostgreSQL, AWS Lambda, SQS, SNS, CloudWatch, Terraform
Live: CampaignPulse
•\tDesigned and built a full-stack TypeScript application`;

test("cleanUrl: web addresses only, made absolute", () => {
  assert.equal(cleanUrl("https://github.com/shekar987/cv-tailor"), "https://github.com/shekar987/cv-tailor");
  assert.equal(cleanUrl("jobhuntz.app"), "https://jobhuntz.app/");
  assert.equal(cleanUrl(" uber-demo-omega.vercel.app/ "), "https://uber-demo-omega.vercel.app/");
  assert.equal(cleanUrl("(https://x.dev/app)."), "https://x.dev/app");
  assert.equal(cleanUrl("http://old-project.co.uk"), "http://old-project.co.uk/");
  // What the extraction wrote for links hidden behind words, and other non-addresses.
  for (const bad of ["GitHub", "Ridex", "CampaignPulse", "", "  ", "Next.js", "config.yml", "javascript:alert(1)",
    "mailto:me@x.com", "https://user:pw@x.com", "https://localhost:3000", "two words.com", 42, null]) {
    assert.equal(cleanUrl(bad), "", String(bad));
  }
  assert.equal(cleanUrl("x.com/" + "a".repeat(400)), "", "over-long");
});

test("displayUrl: no protocol, no www, no trailing slash", () => {
  assert.equal(displayUrl("https://www.jobhuntz.app/"), "jobhuntz.app");
  assert.equal(displayUrl("https://github.com/shekar987/RideX-app"), "github.com/shekar987/RideX-app");
});

test("projectKey: the core name, whatever descriptor or date follows", () => {
  assert.equal(projectCoreName("RideX — Full-Stack Ride-Hailing Platform (personal portfolio project) · 2025"), "RideX");
  assert.equal(projectKey("Jobhuntz — Full-Stack AI Application · 2026"), "jobhuntz");
  assert.equal(projectKey("Jobhuntz – Full-Stack AI Application | 2026"), "jobhuntz", "a pool selection's name");
  assert.equal(projectKey("CampaignPulse — Event-Driven Campaign Delivery Reliability Platform (GitHub)          2026"), "campaignpulse");
  assert.equal(projectKey("FinSight"), "finsight");
  assert.equal(projectKey("FinSight 2025"), "finsight");
  assert.equal(projectKey("Portfolio Website (React)"), "portfoliowebsite");
  assert.equal(projectKey("E-commerce Platform: MERN"), "ecommerceplatform");
  assert.equal(projectKey(""), "");
  assert.equal(projectKey(undefined), "");
});

test("linksInLine: labelled or explicit addresses; tech names and prose are not links", () => {
  assert.deepEqual(linksInLine("Live: https://www.jobhuntz.app/ · GitHub: https://github.com/shekar987/cv-tailor"), {
    live: "https://www.jobhuntz.app/",
    github: "https://github.com/shekar987/cv-tailor",
  });
  assert.deepEqual(linksInLine("Live: jobhuntz.app"), { live: "https://jobhuntz.app/", github: "" });
  assert.deepEqual(linksInLine("Next.js 16, Node.js, Vue.js, Vercel"), { live: "", github: "" });
  assert.deepEqual(linksInLine("Deployed for acme.com customers"), { live: "", github: "" }, "a domain in a sentence");
  assert.deepEqual(linksInLine("Code: github.com/me/app"), { live: "", github: "https://github.com/me/app" });
  assert.deepEqual(linksInLine("github.com/me/app"), { live: "", github: "https://github.com/me/app" }, "a repository host needs no label");
  assert.deepEqual(linksInLine("Demo: https://me.github.io/app"), { live: "https://me.github.io/app", github: "" }, "Pages is a live site");
  assert.deepEqual(linksInLine("Email: me@gmail.com"), { live: "", github: "" });
  assert.deepEqual(linksInLine("LinkedIn: https://www.linkedin.com/in/me"), { live: "", github: "" });
});

test("linksFromText: the project's own lines, never the next project's", () => {
  assert.deepEqual(linksFromText(CV, "Jobhuntz"), { live: "https://www.jobhuntz.app/", github: "https://github.com/shekar987/cv-tailor" });
  assert.deepEqual(linksFromText(CV, "RideX – Full-Stack Ride-Hailing Platform"), {
    live: "https://uber-demo-omega.vercel.app/",
    github: "https://github.com/shekar987/RideX-app",
  });
  assert.deepEqual(linksFromText(CV, "CampaignPulse"), { live: "", github: "" });
  assert.deepEqual(linksFromText(POOL, "Jobhuntz"), { live: "https://jobhuntz.app/", github: "" });
  assert.deepEqual(linksFromText(POOL, "CampaignPulse"), { live: "", github: "" }, "\"Live: CampaignPulse\" is not an address");
  assert.deepEqual(linksFromText(CV, "Unknown"), { live: "", github: "" });
  assert.deepEqual(linksFromText("", "Jobhuntz"), { live: "", github: "" });
  // A project with no bullets and no blank line before the next one.
  const tight = "Alpha\nPython\nBeta\nLive: https://beta.app";
  assert.deepEqual(linksFromText(tight, "Alpha", ["Alpha", "Beta"]), { live: "", github: "" });
  assert.deepEqual(linksFromText(tight, "Beta", ["Alpha", "Beta"]), { live: "https://beta.app/", github: "" });
});

test("linkParts / linksText: one rule for every renderer; a link to nowhere is dropped", () => {
  assert.deepEqual(linkParts({ label: "Live", url: "https://www.jobhuntz.app/", text: "jobhuntz.app" }), {
    label: "Live",
    display: "jobhuntz.app",
    href: "https://www.jobhuntz.app/",
  });
  assert.equal(linkParts({ label: "GitHub", url: "GitHub", text: "GitHub" }), null, "the extraction's broken link");
  assert.equal(linkParts({ label: "Live", url: "Ridex" }), null);
  assert.deepEqual(linkParts({ label: "", url: "", text: "https://x.dev" }), { label: "", display: "x.dev", href: "https://x.dev/" });
  assert.equal(linkParts({ label: "x.dev", url: "https://x.dev" })!.label, "", "a label that is itself the address is not repeated");
  assert.equal(linkParts(null), null);
  assert.equal(
    linksText([{ label: "Live", url: "https://www.jobhuntz.app/" }, { label: "GitHub", url: "GitHub" }, { label: "GitHub", url: "https://github.com/a/b" }]),
    "Live: jobhuntz.app | GitHub: github.com/a/b"
  );
  assert.equal(linksText(undefined), "");
});

test("repoLabel names the host", () => {
  assert.equal(repoLabel("https://github.com/a/b"), "GitHub");
  assert.equal(repoLabel("https://gitlab.com/a/b"), "GitLab");
  assert.equal(repoLabel("https://bitbucket.org/a/b"), "Bitbucket");
  assert.equal(repoLabel("https://codeberg.org/a/b"), "Code");
});

test("autoProjectLinks: the CV text first, then the extraction's real addresses; other links kept", () => {
  const broken = [{ label: "GitHub", url: "GitHub", text: "GitHub" }, { label: "Live", url: "jobhuntz.app", text: "jobhuntz.app" }];
  const auto = autoProjectLinks("Jobhuntz", broken, [CV, POOL]);
  assert.deepEqual(auto.pair, { live: "https://www.jobhuntz.app/", github: "https://github.com/shekar987/cv-tailor" });
  // No text: the extraction's real address fills in, the broken one is dropped.
  assert.deepEqual(autoProjectLinks("Jobhuntz", broken, []).pair, { live: "https://jobhuntz.app/", github: "" });
  const withPaper = autoProjectLinks("X", [{ label: "Paper", url: "https://arxiv.org/abs/1" }, { label: "Repo", url: "https://codeberg.org/me/x" }], []);
  assert.deepEqual(withPaper.pair, { live: "", github: "https://codeberg.org/me/x" });
  assert.deepEqual(withPaper.others, [{ label: "Paper", url: "https://arxiv.org/abs/1", text: "arxiv.org/abs/1" }]);
});

test("linksForProject: a saved entry wins, even an empty one; Live first, then the repository", () => {
  assert.deepEqual(linksForProject("Jobhuntz — Full-Stack AI Application · 2026", [], {}, [CV]), [
    { label: "Live", url: "https://www.jobhuntz.app/", text: "jobhuntz.app" },
    { label: "GitHub", url: "https://github.com/shekar987/cv-tailor", text: "github.com/shekar987/cv-tailor" },
  ]);
  const saved = { campaignpulse: { github: "https://github.com/shekar987/campaign-pulse", live: "" }, jobhuntz: { github: "", live: "" } };
  assert.deepEqual(linksForProject("CampaignPulse — Event-Driven Data Pipeline", [], saved, [CV, POOL]), [
    { label: "GitHub", url: "https://github.com/shekar987/campaign-pulse", text: "github.com/shekar987/campaign-pulse" },
  ]);
  assert.deepEqual(linksForProject("Jobhuntz", [], saved, [CV]), [], "a link the user removed stays removed");
  // A project named like an Object.prototype key is not "saved".
  assert.deepEqual(linksForProject("Constructor", [], {}, []), []);
});

test("attachProjectLinks: every project, a copy, pool selections included", () => {
  const projects = [
    { name: "Jobhuntz – Full-Stack AI Application | 2026", tech: "Next.js", links: [], originalBullets: [] },
    { name: "RideX — Full-Stack Ride-Hailing Platform · 2025", tech: "React", links: [{ label: "Live", url: "Ridex", text: "Ridex" }], originalBullets: [] },
    { name: "FinSight", tech: "Python", links: [], originalBullets: [] },
  ];
  const out = attachProjectLinks(projects, {}, [CV, POOL]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].links.map((l) => l.text), ["jobhuntz.app", "github.com/shekar987/cv-tailor"]);
  assert.deepEqual(out[1].links.map((l) => l.text), ["uber-demo-omega.vercel.app", "github.com/shekar987/RideX-app"]);
  assert.deepEqual(out[2].links, []);
  assert.equal(out[0].tech, "Next.js");
  assert.deepEqual(projects[1].links, [{ label: "Live", url: "Ridex", text: "Ridex" }], "input untouched");
});

test("normalizeProjectLinks: bounded, keys letters and digits, addresses cleaned", () => {
  assert.deepEqual(normalizeProjectLinks(null), {});
  assert.deepEqual(normalizeProjectLinks([1]), {});
  assert.deepEqual(normalizeProjectLinks({ "Camp-Pulse": { github: "github.com/a/b", live: "not a url" }, x: "no" }), {
    camppulse: { github: "https://github.com/a/b", live: "" },
  });
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`p${i}`, { github: "", live: "" }]));
  assert.equal(Object.keys(normalizeProjectLinks(many)).length, MAX_SAVED_PROJECTS);
  const polluted = normalizeProjectLinks(JSON.parse('{"__proto__": {"github": "github.com/a/b", "live": ""}}'));
  assert.deepEqual(Object.keys(polluted), ["proto"]);
  assert.equal(({} as Record<string, unknown>).github, undefined);
});
