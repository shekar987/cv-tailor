// POST /api/jd/fetch's flow (lib/importJob/fetchJob, 31 Oct 2026): a job link
// → the posting's text, with the network mocked — one test per board. The
// fixtures follow each board's public answer as read live on 31 Oct; the
// companies and postings are made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJobFromUrl, type JobFetcher, type FetchedJobPage } from "../src/lib/importJob/fetchJob.ts";
import { parseJobUrl, sourceApiUrl, isImportFetchHost, IMPORT_FETCH_HOSTS } from "../src/lib/importJob/parse.ts";

const BODY = "<p>We build payment tools for small UK businesses. You will design and ship Python services and React interfaces with a small team.</p>";

// A fetcher that answers from a table of address → page, and records what was asked.
function mock(pages: Record<string, Partial<FetchedJobPage> & { json?: unknown }>) {
  const asked: string[] = [];
  const fetcher: JobFetcher = async (url) => {
    asked.push(url);
    const p = pages[url];
    if (!p) return { status: 404, body: "Not Found", url };
    return { status: p.status ?? 200, body: p.json !== undefined ? JSON.stringify(p.json) : (p.body ?? ""), url: p.url ?? url };
  };
  return { fetcher, asked };
}

const ok = (r: Awaited<ReturnType<typeof fetchJobFromUrl>>) => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.job;
};

test("Lever: the posting from api.lever.co", async () => {
  const id = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
  const { fetcher, asked } = mock({
    [`https://api.lever.co/v0/postings/acme/${id}?mode=json`]: {
      json: { text: "Software Engineer", description: BODY, lists: [{ text: "What you'll need", content: "<li>Python</li><li>React</li>" }], categories: { location: "London" }, hostedUrl: `https://jobs.lever.co/acme/${id}` },
    },
  });
  const job = ok(await fetchJobFromUrl(`https://jobs.lever.co/acme/${id}`, fetcher));
  assert.deepEqual(asked, [`https://api.lever.co/v0/postings/acme/${id}?mode=json`]);
  assert.equal(job.title, "Software Engineer");
  assert.equal(job.company, "Acme");
  assert.match(job.description, /^Software Engineer\nAcme · London\n\nWe build payment tools/);
  assert.match(job.description, /What you'll need\n- Python\n- React/);
});

test("Ashby: the board's list, the posting found by its id", async () => {
  const id = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";
  const { fetcher } = mock({
    "https://api.ashbyhq.com/posting-api/job-board/acme": {
      json: { jobs: [{ id: "00000000-0000-4000-8000-000000000000", title: "Other", descriptionHtml: BODY }, { id, title: "Backend Engineer", location: "Remote, UK", descriptionHtml: BODY, jobUrl: `https://jobs.ashbyhq.com/acme/${id}` }] },
    },
  });
  const job = ok(await fetchJobFromUrl(`https://jobs.ashbyhq.com/acme/${id}`, fetcher));
  assert.equal(job.title, "Backend Engineer");
  assert.equal(job.location, "Remote, UK");
  assert.equal(job.source, "ashby");
});

test("Greenhouse: escaped HTML content, the company's own name", async () => {
  const { fetcher } = mock({
    "https://boards-api.greenhouse.io/v1/boards/acmelabs/jobs/4012345": {
      json: { title: "Data Engineer", company_name: "Acme Labs Ltd", location: { name: "Manchester" }, content: BODY.replace(/</g, "&lt;").replace(/>/g, "&gt;"), absolute_url: "https://job-boards.greenhouse.io/acmelabs/jobs/4012345" },
    },
  });
  const job = ok(await fetchJobFromUrl("https://job-boards.greenhouse.io/acmelabs/jobs/4012345", fetcher));
  assert.equal(job.company, "Acme Labs Ltd");
  assert.match(job.description, /We build payment tools/);
  assert.doesNotMatch(job.description, /&lt;|<p>/);
});

const WORKABLE_JOB = {
  shortcode: "81B46579FE",
  title: "Machine Learning Engineer",
  remote: true,
  location: { city: "Paris", country: "France", countryCode: "FR", region: "Île-de-France" },
  description: BODY,
  requirements: "<ul><li>Python</li><li>PyTorch</li></ul>",
  benefits: "<p>Flexible hours.</p>",
};

test("Workable: description, requirements and benefits from the v2 API", async () => {
  const { fetcher, asked } = mock({ "https://apply.workable.com/api/v2/accounts/acme/jobs/81B46579FE": { json: WORKABLE_JOB } });
  const job = ok(await fetchJobFromUrl("https://apply.workable.com/acme/j/81b46579fe/", fetcher));
  assert.deepEqual(asked, ["https://apply.workable.com/api/v2/accounts/acme/jobs/81B46579FE"]);
  assert.equal(job.location, "Paris, Île-de-France, France");
  assert.match(job.description, /Requirements\n- Python\n- PyTorch/);
  assert.match(job.description, /Benefits\nFlexible hours\./);
  assert.equal(job.applyUrl, "https://apply.workable.com/acme/j/81B46579FE/");
});

test("Workable short link: followed on apply.workable.com to learn the account", async () => {
  const { fetcher, asked } = mock({
    "https://apply.workable.com/j/81B46579FE": { body: "<html>…</html>", url: "https://apply.workable.com/acme/j/81B46579FE" },
    "https://apply.workable.com/api/v2/accounts/acme/jobs/81B46579FE": { json: WORKABLE_JOB },
  });
  const job = ok(await fetchJobFromUrl("https://apply.workable.com/j/81B46579FE", fetcher));
  assert.equal(job.company, "Acme");
  assert.deepEqual(asked, ["https://apply.workable.com/j/81B46579FE", "https://apply.workable.com/api/v2/accounts/acme/jobs/81B46579FE"]);
  // Landing somewhere that names no account: said so, nothing else fetched.
  const lost = mock({ "https://apply.workable.com/j/81B46579FE": { body: "", url: "https://apply.workable.com/" } });
  const r = await fetchJobFromUrl("https://apply.workable.com/j/81B46579FE", lost.fetcher);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.errorType, "no_description");
  assert.equal(lost.asked.length, 1);
});

test("SmartRecruiters: the job ad's sections in order, the company's name", async () => {
  const { fetcher, asked } = mock({
    "https://api.smartrecruiters.com/v1/companies/AcmeLtd/postings/744000158320111": {
      json: {
        name: "Full Stack Developer",
        company: { identifier: "AcmeLtd", name: "Acme Ltd" },
        location: { city: "Leeds", country: "gb", fullLocation: "Leeds, England, United Kingdom" },
        postingUrl: "https://jobs.smartrecruiters.com/AcmeLtd/744000158320111-full-stack-developer",
        jobAd: {
          sections: {
            companyDescription: { title: "Company Description", text: "<p>Acme makes accounting software.</p>" },
            jobDescription: { title: "Job Description", text: BODY },
            qualifications: { title: "Qualifications", text: "<ul><li>TypeScript</li></ul>" },
            additionalInformation: { title: "Additional Information", text: "" },
          },
        },
      },
    },
  });
  const job = ok(await fetchJobFromUrl("https://jobs.smartrecruiters.com/AcmeLtd/744000158320111-full-stack-developer", fetcher));
  assert.deepEqual(asked, ["https://api.smartrecruiters.com/v1/companies/AcmeLtd/postings/744000158320111"]);
  assert.equal(job.company, "Acme Ltd");
  assert.equal(job.location, "Leeds, England, United Kingdom");
  assert.match(job.description, /Company Description\nAcme makes accounting software\.\n\nJob Description\nWe build payment tools/);
  assert.match(job.description, /Qualifications\n- TypeScript/);
  assert.doesNotMatch(job.description, /Additional Information/, "an empty section is left out");
});

test("BambooHR: result.jobOpening from the company's own subdomain, old links too", async () => {
  const page = {
    json: {
      result: {
        jobOpening: {
          jobOpeningName: "Junior Software Engineer",
          description: BODY,
          location: { city: "Bristol", state: "England", addressCountry: "United Kingdom" },
          jobOpeningShareUrl: "https://acme.bamboohr.com/careers/21",
        },
        formFields: {},
      },
    },
  };
  const { fetcher, asked } = mock({ "https://acme.bamboohr.com/careers/21/detail": page });
  const job = ok(await fetchJobFromUrl("https://acme.bamboohr.com/careers/21", fetcher));
  assert.deepEqual(asked, ["https://acme.bamboohr.com/careers/21/detail"]);
  assert.equal(job.title, "Junior Software Engineer");
  assert.equal(job.location, "Bristol, England, United Kingdom");
  assert.equal(job.applyUrl, "https://acme.bamboohr.com/careers/21");
  const old = ok(await fetchJobFromUrl("https://acme.bamboohr.com/jobs/view.php?id=21", fetcher));
  assert.equal(old.title, "Junior Software Engineer");
});

test("failures say what happened: unsupported, unreachable, closed, empty", async () => {
  const none = mock({});
  const unsupported = await fetchJobFromUrl("https://careers.example.com/jobs/1", none.fetcher);
  assert.equal(!unsupported.ok && unsupported.errorType, "unsupported");
  assert.match(!unsupported.ok ? unsupported.error : "", /Workable, SmartRecruiters, BambooHR and LinkedIn/);
  assert.equal(none.asked.length, 0, "an unsupported link is never fetched");
  const missing = await fetchJobFromUrl("", none.fetcher);
  assert.equal(!missing.ok && missing.errorType, "missing_url");

  const unreachable = await fetchJobFromUrl("https://acme.bamboohr.com/careers/21", async () => null);
  assert.equal(!unreachable.ok && unreachable.errorType, "fetch_failed");
  const closed = await fetchJobFromUrl("https://acme.bamboohr.com/careers/21", none.fetcher);
  assert.equal(!closed.ok && closed.errorType, "not_found");
  const empty = mock({ "https://acme.bamboohr.com/careers/21/detail": { json: { result: { jobOpening: { jobOpeningName: "X", description: "<p>Hi</p>" } } } } });
  const r = await fetchJobFromUrl("https://acme.bamboohr.com/careers/21", empty.fetcher);
  assert.equal(!r.ok && r.errorType, "no_description");
});

test("the hosts: the new boards' links parse; only fixed API hosts and one-label BambooHR subdomains may be fetched", () => {
  assert.deepEqual(parseJobUrl("https://acme.workable.com/j/81B46579FE"), { source: "workable", board: "acme", id: "81B46579FE" });
  assert.deepEqual(parseJobUrl("https://jobs.smartrecruiters.com/AcmeLtd/744000158320111"), { source: "smartrecruiters", board: "AcmeLtd", id: "744000158320111" });
  assert.equal(parseJobUrl("https://jobs.smartrecruiters.com/AcmeLtd/not-a-number"), null);
  assert.equal(parseJobUrl("https://acme.bamboohr.com/careers"), null);
  assert.equal(parseJobUrl("https://evil.example.com.bamboohr.com/careers/1"), null, "a deeper name is not one company label");
  assert.equal(sourceApiUrl({ source: "bamboohr", board: "acme", id: "21" }), "https://acme.bamboohr.com/careers/21/detail");
  assert.ok(IMPORT_FETCH_HOSTS.has("apply.workable.com") && IMPORT_FETCH_HOSTS.has("api.smartrecruiters.com"));
  assert.equal(isImportFetchHost("acme.bamboohr.com"), true);
  assert.equal(isImportFetchHost("a.b.bamboohr.com"), false);
  assert.equal(isImportFetchHost("bamboohr.com.evil.com"), false);
  assert.equal(isImportFetchHost("acme.workable.com"), false, "the legacy host is parsed, never fetched");
});
