// lib/importJob: which job links the "Import job from link" box reads, the
// fixed address each is fetched from, and the HTML → plain text cleaning.
// Pure functions only — nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJobUrl,
  sourceApiUrl,
  postingPageUrl,
  boardDisplayName,
  IMPORT_FETCH_HOSTS,
} from "../src/lib/importJob/parse.ts";
import { decodeEntities, unescapeHtml, htmlToPlainText, tidyPlainText, capText } from "../src/lib/importJob/text.ts";
import { fromLever, fromAshby, fromGreenhouse, fromLinkedIn, innerHtmlByClass, extractJob, composeJobText } from "../src/lib/importJob/sources.ts";

const LEVER_ID = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
const ASHBY_ID = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

// ── URL parsing ─────────────────────────────────────────────────────────────

test("Lever links: the board and posting id, /apply allowed, EU board kept", () => {
  assert.deepEqual(parseJobUrl(`https://jobs.lever.co/acme/${LEVER_ID}`), { source: "lever", board: "acme", id: LEVER_ID });
  assert.deepEqual(parseJobUrl(`https://jobs.lever.co/acme-labs/${LEVER_ID.toUpperCase()}/apply?lever-source=LinkedIn`), {
    source: "lever",
    board: "acme-labs",
    id: LEVER_ID,
  });
  assert.deepEqual(parseJobUrl(`jobs.lever.co/acme/${LEVER_ID}`), { source: "lever", board: "acme", id: LEVER_ID });
  assert.deepEqual(parseJobUrl(`https://jobs.eu.lever.co/acme/${LEVER_ID}`), { source: "lever", board: "acme", id: LEVER_ID, eu: true });
  assert.equal(parseJobUrl("https://jobs.lever.co/acme"), null);
  assert.equal(parseJobUrl("https://jobs.lever.co/acme/not-a-uuid"), null);
  assert.equal(parseJobUrl(`https://jobs.lever.co/acme/${LEVER_ID}/something-else`), null);
});

test("Ashby links: slug and job id, /application allowed", () => {
  assert.deepEqual(parseJobUrl(`https://jobs.ashbyhq.com/synthflow/${ASHBY_ID}`), { source: "ashby", board: "synthflow", id: ASHBY_ID });
  assert.deepEqual(parseJobUrl(`https://jobs.ashbyhq.com/Acme%20Labs/${ASHBY_ID}/application?utm_source=x`), {
    source: "ashby",
    board: "Acme Labs",
    id: ASHBY_ID,
  });
  assert.equal(parseJobUrl("https://jobs.ashbyhq.com/synthflow"), null);
  assert.equal(parseJobUrl("https://jobs.ashbyhq.com/synthflow/12345"), null);
});

test("Greenhouse links: job-boards and boards hosts, numeric id only", () => {
  assert.deepEqual(parseJobUrl("https://job-boards.greenhouse.io/monzo/jobs/6543210"), { source: "greenhouse", board: "monzo", id: "6543210" });
  assert.deepEqual(parseJobUrl("https://boards.greenhouse.io/monzo/jobs/6543210?gh_src=abc"), { source: "greenhouse", board: "monzo", id: "6543210" });
  assert.equal(parseJobUrl("https://boards.greenhouse.io/monzo"), null);
  assert.equal(parseJobUrl("https://boards.greenhouse.io/monzo/jobs/abc"), null);
  assert.equal(parseJobUrl("https://boards.greenhouse.io/monzo/positions/6543210"), null);
});

test("LinkedIn links: /jobs/view/<id>, a slug ending in the id, uk. host, currentJobId", () => {
  assert.deepEqual(parseJobUrl("https://www.linkedin.com/jobs/view/4012345678/"), { source: "linkedin", board: "", id: "4012345678" });
  assert.deepEqual(parseJobUrl("https://uk.linkedin.com/jobs/view/backend-engineer-at-acme-4012345678?trk=public_jobs"), {
    source: "linkedin",
    board: "",
    id: "4012345678",
  });
  assert.deepEqual(parseJobUrl("https://linkedin.com/jobs/view/4012345678"), { source: "linkedin", board: "", id: "4012345678" });
  assert.deepEqual(parseJobUrl("https://www.linkedin.com/comm/jobs/view/4012345678"), { source: "linkedin", board: "", id: "4012345678" });
  assert.deepEqual(parseJobUrl("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=python"), {
    source: "linkedin",
    board: "",
    id: "4012345678",
  });
  assert.deepEqual(parseJobUrl("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678"), {
    source: "linkedin",
    board: "",
    id: "4012345678",
  });
  assert.equal(parseJobUrl("https://www.linkedin.com/jobs/search/?currentJobId=abc"), null);
  assert.equal(parseJobUrl("https://www.linkedin.com/in/someone"), null);
  assert.equal(parseJobUrl("https://www.linkedin.com/jobs/view/"), null);
  assert.equal(parseJobUrl("https://evil.com/jobs/view/4012345678"), null);
  assert.equal(parseJobUrl("https://linkedin.com.evil.com/jobs/view/4012345678"), null);
});

test("anything else is unsupported: other hosts, schemes, credentials, ports, junk", () => {
  for (const bad of [
    "",
    "   ",
    "not a url",
    "https://www.indeed.co.uk/viewjob?jk=123",
    `https://jobs.lever.co.evil.com/acme/${LEVER_ID}`,
    `https://user:pw@jobs.lever.co/acme/${LEVER_ID}`,
    `https://jobs.lever.co:8443/acme/${LEVER_ID}`,
    `ftp://jobs.lever.co/acme/${LEVER_ID}`,
    `javascript:alert(1)`,
    "http://169.254.169.254/latest/meta-data",
    "http://localhost:3000/jobs/view/4012345678",
  ]) {
    assert.equal(parseJobUrl(bad), null, bad);
  }
});

test("the fetched address is always on a fixed API host", () => {
  const refs = [
    parseJobUrl(`https://jobs.lever.co/acme/${LEVER_ID}`),
    parseJobUrl(`https://jobs.eu.lever.co/acme/${LEVER_ID}`),
    parseJobUrl(`https://jobs.ashbyhq.com/Acme%20Labs/${ASHBY_ID}`),
    parseJobUrl("https://boards.greenhouse.io/monzo/jobs/6543210"),
    parseJobUrl("https://uk.linkedin.com/jobs/view/4012345678"),
  ];
  const urls = refs.map((r) => {
    assert.ok(r);
    return sourceApiUrl(r);
  });
  assert.deepEqual(urls, [
    `https://api.lever.co/v0/postings/acme/${LEVER_ID}?mode=json`,
    `https://api.eu.lever.co/v0/postings/acme/${LEVER_ID}?mode=json`,
    "https://api.ashbyhq.com/posting-api/job-board/Acme%20Labs",
    "https://boards-api.greenhouse.io/v1/boards/monzo/jobs/6543210",
    "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4012345678",
  ]);
  for (const u of urls) assert.ok(IMPORT_FETCH_HOSTS.has(new URL(u).hostname), u);
  assert.equal(postingPageUrl(refs[4]!), "https://www.linkedin.com/jobs/view/4012345678/");
  assert.equal(boardDisplayName("acme-labs"), "Acme Labs");
});

// ── HTML → text ─────────────────────────────────────────────────────────────

test("decodeEntities decodes one level: named, decimal, hex", () => {
  assert.equal(decodeEntities("Fish &amp; Chips &pound;40k &#8211; &#x2014; caf&eacute; &rsquo;"), "Fish & Chips £40k – — café ’");
  assert.equal(decodeEntities("&amp;lt;li&amp;gt;"), "&lt;li&gt;");
  assert.equal(decodeEntities("&unknown; &#0; AT&T"), "&unknown;  AT&T");
});

test("unescapeHtml: Greenhouse's escaped HTML, single and double, never past real tags", () => {
  assert.equal(unescapeHtml("&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;"), "<p>Hi &amp; bye</p>");
  assert.equal(unescapeHtml("&amp;lt;li&amp;gt;Python&amp;lt;/li&amp;gt;"), "<li>Python</li>");
  assert.equal(unescapeHtml("<p>5 &lt; 6</p>"), "<p>5 &lt; 6</p>");
  assert.equal(unescapeHtml("Plain text with 5 &lt; 6"), "Plain text with 5 &lt; 6");
});

test("htmlToPlainText: paragraphs, headings, <br>, list items as '- ', no tags left", () => {
  const html =
    "<h2>About the role</h2><p>We build <strong>payments</strong>&nbsp;APIs.<br>London, hybrid.</p>" +
    "<p>What you&rsquo;ll do:</p><ul><li>Ship <em>FastAPI</em> services</li><li>  Write   tests </li></ul><p>Apply now.</p>";
  assert.equal(
    htmlToPlainText(html),
    ["About the role", "", "We build payments APIs.", "London, hybrid.", "", "What you’ll do:", "", "- Ship FastAPI services", "- Write tests", "", "Apply now."].join("\n")
  );
});

test("htmlToPlainText: nested lists indent, <p> inside <li> stays on the bullet, bare <li>s work", () => {
  const nested = "<ul><li>Backend<ul><li>Python</li><li>SQL</li></ul></li><li><p>Frontend</p></li></ul>";
  assert.equal(htmlToPlainText(nested), ["- Backend", "  - Python", "  - SQL", "- Frontend"].join("\n"));
  assert.equal(htmlToPlainText("<li>One</li><li>Two &amp; three</li>"), "- One\n- Two & three");
  const ordered = "<ol><li>First</li><li>Second</li></ol>";
  assert.equal(htmlToPlainText(ordered), "- First\n- Second");
});

test("Greenhouse content end to end: escaped HTML with escaped entities inside", () => {
  const content =
    "&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;Monzo &amp;amp; you&lt;/p&gt;&lt;/div&gt;" +
    "&lt;ul&gt;&lt;li&gt;Go &amp;amp; Kafka&lt;/li&gt;&lt;li&gt;5 &amp;lt; 6&lt;br&gt;really&lt;/li&gt;&lt;/ul&gt;";
  const text = htmlToPlainText(unescapeHtml(content));
  assert.equal(text, "Monzo & you\n\n- Go & Kafka\n- 5 < 6\nreally");
  assert.doesNotMatch(text, /<\/?[a-z]|&[a-z]+;/);
});

test("htmlToPlainText drops scripts, styles and comments", () => {
  assert.equal(htmlToPlainText("<style>.x{}</style><script>alert(1)</script><!-- note --><p>Kept</p>"), "Kept");
});

test("tidyPlainText: unicode bullets become '- ', blank-line runs collapse", () => {
  assert.equal(tidyPlainText("Intro\n\n\n\n• One\n· Two\n*   Three\n-\nEnd  here "), "Intro\n\n- One\n- Two\n- Three\nEnd here");
});

test("capText cuts at a line break near the cap", () => {
  const text = "a".repeat(90) + "\n" + "b".repeat(50);
  assert.equal(capText(text, 100), "a".repeat(90));
  assert.equal(capText("short", 100), "short");
  assert.equal(capText("x".repeat(200), 100).length, 100);
});

// ── Extractors ──────────────────────────────────────────────────────────────

test("fromLever: description, each list with its heading, the closing text", () => {
  const ref = parseJobUrl(`https://jobs.lever.co/acme-labs/${LEVER_ID}`)!;
  const job = fromLever(ref, {
    text: "Backend Engineer",
    categories: { location: "London" },
    description: "<div><p>We are hiring a backend engineer to build our core platform.</p></div>",
    lists: [{ text: "What you&#39;ll do", content: "<li>Build APIs</li><li>Own CI/CD</li>" }],
    additional: "<p>We sponsor no one &amp; that&rsquo;s fine.</p>",
    hostedUrl: `https://jobs.lever.co/acme-labs/${LEVER_ID}`,
  });
  assert.ok(job);
  assert.equal(job.company, "Acme Labs");
  assert.equal(job.title, "Backend Engineer");
  assert.equal(job.location, "London");
  assert.equal(job.source, "lever");
  assert.equal(job.applyUrl, `https://jobs.lever.co/acme-labs/${LEVER_ID}`);
  assert.equal(
    job.description,
    [
      "Backend Engineer",
      "Acme Labs · London",
      "",
      "We are hiring a backend engineer to build our core platform.",
      "",
      "What you'll do",
      "- Build APIs",
      "- Own CI/CD",
      "",
      "We sponsor no one & that’s fine.",
    ].join("\n")
  );
});

test("fromAshby: finds the posting by id; a missing id is null", () => {
  const ref = parseJobUrl(`https://jobs.ashbyhq.com/synthflow/${ASHBY_ID}`)!;
  const board = {
    jobs: [
      { id: "00000000-0000-4000-8000-000000000000", title: "Other", descriptionPlain: "x".repeat(100) },
      { id: ASHBY_ID.toUpperCase(), title: "AI Engineer", location: "Remote (UK)", descriptionHtml: "<p>Build LLM agents that answer phone calls for customers.</p>", jobUrl: `https://jobs.ashbyhq.com/synthflow/${ASHBY_ID}` },
    ],
  };
  const job = fromAshby(ref, board);
  assert.ok(job);
  assert.equal(job.title, "AI Engineer");
  assert.equal(job.company, "Synthflow");
  assert.match(job.description, /^AI Engineer\nSynthflow · Remote \(UK\)\n\nBuild LLM agents/);
  assert.equal(fromAshby(parseJobUrl(`https://jobs.ashbyhq.com/synthflow/${LEVER_ID}`)!, board), null);
});

test("fromGreenhouse: company_name when present, entities decoded, the board otherwise", () => {
  const ref = parseJobUrl("https://boards.greenhouse.io/monzo/jobs/6543210")!;
  const job = fromGreenhouse(ref, {
    title: "Backend Engineer &amp; SRE",
    location: { name: "London" },
    content: "&lt;p&gt;Join our platform team and build the systems behind the bank.&lt;/p&gt;",
    absolute_url: "https://job-boards.greenhouse.io/monzo/jobs/6543210",
  });
  assert.ok(job);
  assert.equal(job.title, "Backend Engineer & SRE");
  assert.equal(job.company, "Monzo");
  assert.equal(job.description, "Backend Engineer & SRE\nMonzo · London\n\nJoin our platform team and build the systems behind the bank.");
  assert.equal(fromGreenhouse(ref, { title: "Empty", content: "" }), null);
});

test("fromLinkedIn: title, company, location and the description markup", () => {
  const ref = parseJobUrl("https://www.linkedin.com/jobs/view/4012345678")!;
  const html = `
    <section class="top-card-layout">
      <h2 class="top-card-layout__title font-sans">Graduate Software Engineer</h2>
      <a class="topcard__org-name-link topcard__flavor--black-link" href="#">  Acme &amp; Co </a>
      <span class="topcard__flavor topcard__flavor--bullet"> London, England, United Kingdom </span>
    </section>
    <div class="description__text">
      <div class="show-more-less-html__markup relative overflow-hidden">
        <strong>About us</strong><br><br>We build tools for <div>engineers</div> in London.<br>
        <ul><li>Python</li><li>React</li></ul>
      </div>
      <button>Show more</button>
    </div>`;
  const job = fromLinkedIn(ref, html);
  assert.ok(job);
  assert.equal(job.title, "Graduate Software Engineer");
  assert.equal(job.company, "Acme & Co");
  assert.equal(job.location, "London, England, United Kingdom");
  assert.equal(job.applyUrl, "https://www.linkedin.com/jobs/view/4012345678/");
  assert.doesNotMatch(job.description, /Show more|<|>/);
  assert.match(job.description, /About us\nWe build tools for\n\nengineers\n\nin London\.\n\n- Python\n- React$/);
  assert.equal(fromLinkedIn(ref, "<html><body>Sign in</body></html>"), null);
});

test("innerHtmlByClass balances nested tags and matches whole class names only", () => {
  assert.equal(innerHtmlByClass('<div class="a b"><div>x</div>y</div><div>z</div>', "b"), "<div>x</div>y");
  assert.equal(innerHtmlByClass('<div class="bb">x</div>', "b"), "");
});

test("extractJob: bad JSON is null; the description is capped at the JD box limit", () => {
  const ref = parseJobUrl("https://boards.greenhouse.io/monzo/jobs/6543210")!;
  assert.equal(extractJob(ref, "<html>not json</html>"), null);
  const long = extractJob(ref, JSON.stringify({ title: "T", content: `&lt;p&gt;${"word ".repeat(5000)}&lt;/p&gt;` }));
  assert.ok(long);
  assert.ok(long.description.length <= 15_000);
  assert.equal(composeJobText({ title: "T", company: "", location: "", body: "Body" }), "T\n\nBody");
});
