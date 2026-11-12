// POST /api/applications/jd-from-url's reading (Chunk 23): a job link of any kind → the
// posting's plain text, through lib/importJob/readJob with the network stood in for by
// fixtures (tests/fixtures/jd-from-url: one made-up posting in each board's own answer
// shape, copied from the live answers on 12 Nov 2026). Nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_JD_CHARS } from "../src/lib/limits.ts";
import { parseJobUrl, sourceApiUrl, postingPageUrl, isImportFetchHost, SUPPORTED_SOURCES_TEXT } from "../src/lib/importJob/parse.ts";
import { readJobFromAnyUrl, readLinkUrl, type PageFetcher } from "../src/lib/importJob/readJob.ts";
import type { JobFetcher } from "../src/lib/importJob/fetchJob.ts";
import { jobPostingFromJsonLd, readablePageText, innerHtmlByTag } from "../src/lib/importJob/readable.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/jd-from-url/${name}`, import.meta.url), "utf8");

// One fake internet: address → answer. Records what each fetcher was asked for.
function web(pages: Record<string, { status?: number; body: string; contentType?: string; url?: string }>) {
  const asked = { board: [] as string[], page: [] as string[] };
  const answer = (url: string) => {
    const hit = pages[url];
    return hit ? { status: hit.status ?? 200, body: hit.body, url: hit.url ?? url, contentType: hit.contentType ?? "text/html; charset=utf-8" } : null;
  };
  const board: JobFetcher = async (url) => {
    asked.board.push(url);
    return answer(url);
  };
  const page: PageFetcher = async (url) => {
    asked.page.push(url);
    return answer(url);
  };
  return { fetchers: { board, page }, asked };
}

// The posting's own words, as every reading must keep them.
const KEY_LINES = [
  "Elwood Robotics builds the software that plans and checks warehouse robot fleets",
  "- Design PostgreSQL schemas for telemetry that arrives at 20,000 events a second",
  "- Experience building REST APIs in Python, Go or a similar language",
  "- A salary of £38,000 to £45,000 depending on experience",
];

function assertPosting(description: string, label: string) {
  assert.ok(description.length > 1000, `${label}: ${description.length} characters`);
  assert.ok(description.length <= MAX_JD_CHARS, `${label}: within the JD cap`);
  assert.ok(description.startsWith("Graduate Software Engineer\n"), `${label}: the title on top`);
  for (const line of KEY_LINES) assert.ok(description.includes(line), `${label}: keeps "${line.slice(0, 40)}…"`);
  assert.doesNotMatch(description, /<\/?[a-z][^>]*>/i, `${label}: no tag left`);
  assert.doesNotMatch(description, /&(lt|gt|amp|quot);/, `${label}: no entity left`);
}

// ── Done-when (2): > 1,000 characters from Greenhouse, Ashby, Lever, SmartRecruiters and Gem ──

const BOARDS = [
  { label: "Greenhouse", link: "https://job-boards.greenhouse.io/elwoodrobotics/jobs/7012345", api: "https://boards-api.greenhouse.io/v1/boards/elwoodrobotics/jobs/7012345", file: "greenhouse.json" },
  { label: "Ashby", link: "https://jobs.ashbyhq.com/elwood-robotics/5d2a9e47-3c1b-4f6a-8e2d-7a9b0c1d2e3f", api: "https://api.ashbyhq.com/posting-api/job-board/elwood-robotics", file: "ashby.json" },
  { label: "Lever", link: "https://jobs.lever.co/elwood-robotics/8e1d2c3b-4a5f-4e6d-9c8b-7a6f5e4d3c2b", api: "https://api.lever.co/v0/postings/elwood-robotics/8e1d2c3b-4a5f-4e6d-9c8b-7a6f5e4d3c2b?mode=json", file: "lever.json" },
  { label: "Lever EU", link: "https://jobs.eu.lever.co/elwood-robotics/8e1d2c3b-4a5f-4e6d-9c8b-7a6f5e4d3c2b", api: "https://api.eu.lever.co/v0/postings/elwood-robotics/8e1d2c3b-4a5f-4e6d-9c8b-7a6f5e4d3c2b?mode=json", file: "lever.json" },
  { label: "SmartRecruiters", link: "https://jobs.smartrecruiters.com/ElwoodRobotics/744000012345678-graduate-software-engineer", api: "https://api.smartrecruiters.com/v1/companies/ElwoodRobotics/postings/744000012345678", file: "smartrecruiters.json" },
  { label: "Gem", link: "https://jobs.gem.com/elwood-robotics/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs", api: "https://api.gem.com/job_board/v0/elwood-robotics/job_posts/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs", file: "gem.json" },
  { label: "Workable", link: "https://apply.workable.com/elwood-robotics/j/A1B2C3D4E5/", api: "https://apply.workable.com/api/v2/accounts/elwood-robotics/jobs/A1B2C3D4E5", file: "workable.json" },
  { label: "Teamtailor", link: "https://elwood-robotics.teamtailor.com/jobs/8706432-graduate-software-engineer", api: "https://elwood-robotics.teamtailor.com/jobs/8706432", file: "teamtailor.html" },
];

for (const b of BOARDS) {
  test(`${b.label}: the posting in full from the board's fixed address, over 1,000 characters`, async () => {
    const { fetchers, asked } = web({ [b.api]: { body: fixture(b.file), contentType: b.file.endsWith(".json") ? "application/json" : "text/html" } });
    const read = await readJobFromAnyUrl(b.link, fetchers);
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(read.job.via, "board");
    assertPosting(read.job.description, b.label);
    assert.deepEqual(asked.board, [b.api], "only the board's own API address is fetched");
    assert.deepEqual(asked.page, [], "no page read when the board answered");
    for (const url of asked.board) assert.ok(isImportFetchHost(new URL(url).hostname), `${url} is a fixed board host`);
    assert.match(read.job.location, /Manchester/);
    assert.notEqual(read.job.company, "");
  });
}

test("Gem: the company comes from the board, the apply link is the posting's own page", async () => {
  const b = BOARDS.find((x) => x.label === "Gem")!;
  const { fetchers } = web({ [b.api]: { body: fixture(b.file) } });
  const read = await readJobFromAnyUrl(b.link, fetchers);
  assert.ok(read.ok);
  assert.equal(read.job.company, "Elwood Robotics");
  assert.equal(read.job.source, "gem");
  assert.equal(read.job.applyUrl, "https://jobs.gem.com/elwood-robotics/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs");
});

test("Gem's posting page is a JavaScript shell: a failed API read falls back to it and gives the board's reason", async () => {
  const link = "https://jobs.gem.com/elwood-robotics/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs";
  const { fetchers, asked } = web({ [link]: { body: fixture("gem-shell.html") } });
  const read = await readJobFromAnyUrl(link, fetchers);
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.errorType, "fetch_failed");
  assert.match(read.error, /Gem/);
  assert.equal(asked.page.length, 1, "the page was tried");
});

test("a board that says the posting is gone is not asked again through its page", async () => {
  const b = BOARDS.find((x) => x.label === "Greenhouse")!;
  const { fetchers, asked } = web({ [b.api]: { status: 404, body: "{}" } });
  const read = await readJobFromAnyUrl(b.link, fetchers);
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.errorType, "not_found");
  assert.deepEqual(asked.page, []);
});

// ── Any other page: the JobPosting block, else the readable text ──

test("a custom-domain careers page with a JobPosting block (Teamtailor on the company's own domain)", async () => {
  const link = "https://careers.elwood.example/jobs/8706432-graduate-software-engineer";
  const { fetchers, asked } = web({ [link]: { body: fixture("teamtailor.html") } });
  const read = await readJobFromAnyUrl(link, fetchers);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.job.via, "json_ld");
  assert.equal(read.job.source, "page");
  assert.equal(read.job.company, "Elwood Robotics");
  assert.equal(read.job.location, "Manchester, GB");
  assertPosting(read.job.description, "JSON-LD page");
  assert.deepEqual(asked.board, []);
});

test("a careers page with no JobPosting block: the readable text, without the furniture, the cookie banner or the form", async () => {
  const link = "https://www.elwood.example/careers/graduate-software-engineer";
  const { fetchers } = web({ [link]: { body: fixture("careers-page.html") } });
  const read = await readJobFromAnyUrl(link, fetchers);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.job.via, "page_text");
  assert.equal(read.job.title, "Graduate Software Engineer | Careers at Elwood");
  assert.equal(read.job.company, "Elwood Robotics");
  const text = read.job.description;
  assert.ok(text.length > 1000, `${text.length}`);
  for (const line of KEY_LINES) assert.ok(text.includes(line), line);
  for (const junk of ["cookies", "About us", "Upload your CV", "Submit application", "Other roles", "Registered in England", "analytics", "color:red"]) {
    assert.ok(!text.includes(junk), `"${junk}" is not the posting`);
  }
});

test("a page that builds itself with JavaScript gives no description, never a guess", async () => {
  const link = "https://www.elwood.example/jobs/42";
  const { fetchers } = web({ [link]: { body: fixture("gem-shell.html") } });
  const read = await readJobFromAnyUrl(link, fetchers);
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.errorType, "no_description");
    assert.match(read.error, /JavaScript/);
  }
});

test("a PDF, a missing page and an unreachable one each say what happened", async () => {
  const pdf = "https://www.elwood.example/jd.pdf";
  const gone = "https://www.elwood.example/jobs/old";
  const { fetchers } = web({ [pdf]: { body: "%PDF-1.7", contentType: "application/pdf" }, [gone]: { status: 410, body: "" } });
  const a = await readJobFromAnyUrl(pdf, fetchers);
  assert.ok(!a.ok && a.errorType === "no_description" && /application\/pdf/.test(a.error));
  const b = await readJobFromAnyUrl(gone, fetchers);
  assert.ok(!b.ok && b.errorType === "not_found");
  const c = await readJobFromAnyUrl("https://unreachable.elwood.example/x", fetchers);
  assert.ok(!c.ok && c.errorType === "fetch_failed");
});

test("a huge page is capped at the tracker's JD limit", async () => {
  const link = "https://www.elwood.example/careers/long";
  const para = "<p>" + "Elwood Robotics plans warehouse robot fleets for grocery companies. ".repeat(40) + "</p>";
  const { fetchers } = web({ [link]: { body: `<html><head><title>Long</title></head><body><main>${para.repeat(60)}</main></body></html>` } });
  const read = await readJobFromAnyUrl(link, fetchers);
  assert.ok(read.ok);
  assert.ok(read.job.description.length <= MAX_JD_CHARS && read.job.description.length > MAX_JD_CHARS - 2000, `${read.job.description.length}`);
});

test("only http(s) addresses are read; anything else is refused before any fetch", async () => {
  for (const bad of ["", "   ", "ftp://files.elwood.example/jd.txt", "javascript:alert(1)", "https://elwood.example/a b", "x".repeat(3000)]) {
    const link = readLinkUrl(bad);
    assert.ok("error" in link, bad.slice(0, 30));
  }
  assert.ok("url" in readLinkUrl("elwood.example/careers/1"), "a bare domain is read as https");
  const { fetchers, asked } = web({});
  const read = await readJobFromAnyUrl("file:///etc/passwd", fetchers);
  assert.ok(!read.ok && read.status === 400);
  assert.deepEqual(asked, { board: [], page: [] });
});

// ── Links ──

test("Gem links: board and id (a UUID or the newer base64 id), read from api.gem.com", () => {
  assert.deepEqual(parseJobUrl("https://jobs.gem.com/nominal/37c9854b-f1ea-4da6-a3f5-51e64923ae08"), { source: "gem", board: "nominal", id: "37c9854b-f1ea-4da6-a3f5-51e64923ae08" });
  const ref = parseJobUrl("https://jobs.gem.com/elwood-robotics/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs?src=LinkedIn")!;
  assert.deepEqual(ref, { source: "gem", board: "elwood-robotics", id: "am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs" });
  assert.equal(sourceApiUrl(ref), "https://api.gem.com/job_board/v0/elwood-robotics/job_posts/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs");
  assert.equal(postingPageUrl(ref), "https://jobs.gem.com/elwood-robotics/am9icG9zdDqbZkwcc-zcsGEBP8ypUFvs");
  assert.equal(parseJobUrl("https://jobs.gem.com/nominal"), null, "the board alone is not a posting");
  assert.equal(parseJobUrl("https://jobs.gem.com/nominal/short"), null);
  assert.equal(parseJobUrl("https://jobs.gem.com/nominal/37c9854b-f1ea-4da6-a3f5-51e64923ae08/extra"), null);
});

test("Teamtailor links: the company's own subdomain, a locale allowed, Teamtailor's own hosts never", () => {
  assert.deepEqual(parseJobUrl("https://elwood-robotics.teamtailor.com/jobs/8706432-graduate-software-engineer"), { source: "teamtailor", board: "elwood-robotics", id: "8706432" });
  assert.deepEqual(parseJobUrl("https://elwood.teamtailor.com/en/jobs/8706432"), { source: "teamtailor", board: "elwood", id: "8706432" });
  for (const bad of [
    "https://www.teamtailor.com/jobs/8706432",
    "https://app.teamtailor.com/jobs/8706432",
    "https://elwood.teamtailor.com/jobs",
    "https://elwood.teamtailor.com/jobs/abc",
    "https://elwood.teamtailor.com/jobs/8706432/applications/new",
    "https://a.b.teamtailor.com/jobs/8706432",
  ]) {
    assert.equal(parseJobUrl(bad), null, bad);
  }
});

test("the board fetcher's hosts: Gem's API and a Teamtailor company subdomain, nothing that only ends like one", () => {
  assert.equal(isImportFetchHost("api.gem.com"), true);
  assert.equal(isImportFetchHost("jobs.gem.com"), false, "the shell is read by the page fetcher, never as a board");
  assert.equal(isImportFetchHost("elwood.teamtailor.com"), true);
  assert.equal(isImportFetchHost("www.teamtailor.com"), false);
  assert.equal(isImportFetchHost("elwood.teamtailor.com.attacker.example"), false);
  assert.equal(isImportFetchHost("a.b.teamtailor.com"), false);
  assert.match(SUPPORTED_SOURCES_TEXT, /Gem/);
  assert.match(SUPPORTED_SOURCES_TEXT, /Teamtailor/);
});

// ── The readers on their own ──

test("JobPosting: found in an @graph or an array, a raw line break in its strings tolerated", () => {
  const block = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
  const description = "<p>Plan robot routes.</p><ul><li>Python</li><li>PostgreSQL</li></ul>";
  const graph = block({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Elwood" }, { "@type": "JobPosting", title: "Engineer", description, hiringOrganization: "Elwood Robotics", jobLocationType: "TELECOMMUTE" }] });
  const a = jobPostingFromJsonLd(graph);
  assert.ok(a);
  assert.equal(a.company, "Elwood Robotics");
  assert.equal(a.location, "Remote");
  assert.equal(a.body, "Plan robot routes.\n\n- Python\n- PostgreSQL");
  const broken = `<script type='application/ld+json'>{"@type": ["JobPosting"], "title": "Engineer", "description": "<p>Line one of the posting\nand line two of the posting.</p>"}</script>`;
  assert.equal(jobPostingFromJsonLd(broken)?.body, "Line one of the posting and line two of the posting.");
  assert.equal(jobPostingFromJsonLd(block({ "@type": "Organization", name: "Elwood" })), null);
  assert.equal(jobPostingFromJsonLd(block({ "@type": "JobPosting", title: "x", description: "" })), null, "no description, no posting");
  // An entity-escaped description, as some trackers write it.
  assert.equal(jobPostingFromJsonLd(block({ "@type": "JobPosting", title: "x", description: "&lt;p&gt;Plan robot routes for grocery warehouses across the UK.&lt;/p&gt;" }))?.body, "Plan robot routes for grocery warehouses across the UK.");
});

test("readable text prefers <main>, and a tag that only starts like one is not it", () => {
  const filler = "Elwood plans warehouse robot fleets for grocery companies across the UK. ".repeat(6);
  const html = `<body><main-menu>Menu</main-menu><div>${"Sidebar ".repeat(80)}</div><main id="m"><p>${filler}</p></main></body>`;
  assert.equal(innerHtmlByTag(html, "main"), `<p>${filler}</p>`);
  assert.equal(readablePageText(html)?.body, filler.trim());
  assert.equal(readablePageText("<body><p>Too short to be a posting.</p></body>"), null);
});
