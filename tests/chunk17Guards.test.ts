// Chunk 17 (5 Nov 2026): the summary's "applying for the … role" clause, how a
// placement is described, the seniority band with its duties and the tracker's
// own level label, early-career only, the whole-programme visa clause, and the
// Greenhouse short links and EU boards. Every CV here is made up; the postings'
// sentences are their own public wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAppliedFor } from "../src/lib/roleTitle.ts";
import { guardRoleStatus } from "../src/lib/factGuard.ts";
import { classifySeniority, seniorityFit } from "../src/lib/seniority.ts";
import { programmeEnd, triageJd } from "../src/lib/triage/jdTriage.ts";
import { fetchJobFromUrl, type FetchedJobPage, type JobFetcher } from "../src/lib/importJob/fetchJob.ts";
import { isImportFetchHost, parseJobUrl, sourceApiUrl } from "../src/lib/importJob/parse.ts";

// ── "…, applying for the X role." ──────────────────────────────────────────
// Six made-up summaries in the shape the 5 Nov sweep's six tailors ended in.
test("the summary never names the job applied for: the clause goes, the rest stays", () => {
  const six: [string, string][] = [
    ["Software developer with two years' production Python experience, applying for the Support Engineer role.", "Software developer with two years' production Python experience."],
    ["Backend engineer who built REST APIs serving 2,000 daily users, applying for the Technical Support Engineer role at Acme.", "Backend engineer who built REST APIs serving 2,000 daily users."],
    ["Full-stack engineer with FastAPI and React experience; applying for the Software Engineering Full-Time Campus Hire role.", "Full-stack engineer with FastAPI and React experience."],
    ["Python developer with event-driven AWS work — applying for the Platform Engineer position.", "Python developer with event-driven AWS work."],
    ["Data engineer with Spark and SQL pipelines, and applying for the Data Engineer (Web apps) role.", "Data engineer with Spark and SQL pipelines."],
    ["Engineer applying for the Graduate Cloud Platform Engineer role at Example Ltd.", ""],
  ];
  for (const [input, want] of six) {
    const r = stripAppliedFor(input);
    assert.equal(r.text, want, input);
    assert.equal(r.removed.length, 1, input);
  }
  // Only where the clause ends the sentence (6 Nov): an opening clause is left as it is.
  const opening = "Applying for the Support Engineer role, I bring two years of Python.";
  assert.deepEqual(stripAppliedFor(opening), { text: opening, removed: [] });
  const lines = "Software developer with two years of Python.\nBuilt REST APIs for 2,000 users, applying for the API Engineer role.";
  assert.equal(stripAppliedFor(lines).text, "Software developer with two years of Python.\nBuilt REST APIs for 2,000 users.");
  const clean = "Software developer applying machine learning to support tickets.";
  assert.deepEqual(stripAppliedFor(clean), { text: clean, removed: [] }, "applying a skill is not applying for a job");
  assert.equal(stripAppliedFor("Built a grant tracker for teams applying for funding.").removed.length, 0);
  assert.equal(stripAppliedFor("Python developer with two years of APIs, applying for the role of Platform Engineer.").text, "Python developer with two years of APIs.");
  assert.equal(stripAppliedFor("Backend developer with Express APIs, applying for the Node.js Developer role at Acme Ltd.").text, "Backend developer with Express APIs.");
  assert.equal(stripAppliedFor("Engineer with Swift apps, applying for Senior iOS Engineer roles.").text, "Engineer with Swift apps.", "no article");
  const ios = "Applying for the Mobile Engineer role, iOS developer with Swift apps shipped to 5,000 users.";
  assert.equal(stripAppliedFor(ios).text, ios);
});

// ── How a role is described ────────────────────────────────────────────────
// "completed industrial placement" for a placement the master shows as current,
// and "currently on an industrial placement" where the master no longer calls
// the role a placement (the shapes of the 5 Nov Profound and Two Sigma outputs).
const CURRENT = "EXPERIENCE\nSoftware Engineer (Industrial Placement) | Example Lab | Oct 2025 – Present\n• Built retrieval tools in Python";
const RENAMED = "EXPERIENCE\nResearch Assistant, AI and Full-Stack | Example Lab | Oct 2025 – Present\n• Built retrieval tools in Python";
const ENDED = "EXPERIENCE\nSoftware Engineer (Placement) | Example Lab | Jul 2023 – Jun 2024\n• Built retrieval tools in Python";

test("a placement is never called completed while the master CV shows it as current", () => {
  const r = guardRoleStatus("Full-stack engineer with retrieval work. Completed an industrial placement at Example Lab.", CURRENT);
  assert.equal(r.text, "Full-stack engineer with retrieval work.");
  assert.deepEqual(r.removed, ["Completed an industrial placement at Example Lab."]);
  assert.equal(guardRoleStatus("Currently on an industrial placement at Example Lab.", CURRENT).removed.length, 0, "true of a current placement");
});

test("placement wording the master CV no longer uses: a pure claim goes, anything else is kept and flagged", () => {
  const mixed = "Full-stack engineer currently on an industrial placement at Example Lab, building retrieval tools.";
  const r = guardRoleStatus(`${mixed}\nPython, FastAPI and React.`, RENAMED);
  assert.equal(r.text, `${mixed}\nPython, FastAPI and React.`, "never cut: the sentence carries true facts too");
  assert.deepEqual(r.flagged, [mixed]);
  assert.deepEqual(r.removed, []);
  const during = guardRoleStatus("During my placement I built retrieval tools.", RENAMED);
  assert.equal(during.text, "During my placement I built retrieval tools.");
  assert.equal(during.flagged.length, 1);
  assert.equal(guardRoleStatus("Currently on a research placement at Example Lab.", RENAMED).removed.length, 1, "nothing but the claim: removed");
  assert.equal(guardRoleStatus("Research assistant building retrieval tools in Python.", RENAMED).removed.length, 0);
});

test("a sentence about the future or the job applied for is never a claim", () => {
  const none = "EXPERIENCE\nSoftware Engineer | Acme | 2022 – Present";
  for (const s of ["I am keen to spend my placement year with your team.", "I am applying for the Industrial Placement at Arm as my sandwich year.", "During my internship I hope to learn your deployment tooling."]) {
    assert.equal(guardRoleStatus(s, none).text, s, s);
  }
});

test("each role decides for itself: one ended, one current", () => {
  const two = "EXPERIENCE\nSWE Intern | Example Search | Jun 2024 – Aug 2024\nData Intern | Example Bank | Jun 2025 – Present";
  assert.equal(guardRoleStatus("I completed a summer internship at Example Search.", two).removed.length, 0);
  assert.equal(guardRoleStatus("I am currently on an internship at Example Bank.", two).removed.length, 0);
  assert.equal(guardRoleStatus("I completed a software engineering placement at Acme.", "EXPERIENCE\nEngineer (Placement) | Acme | Oct 2025 – Present").removed.length, 1);
  assert.equal(guardRoleStatus("Interned at Acme on the billing team; completed an internship at Acme.", "EXPERIENCE\nInterned at Acme | Jun 2024 – Aug 2024").removed.length, 0, "interned counts as an internship");
});

test("a numbered reason stays whole, and an abbreviation is no sentence end", () => {
  const letter = "1. I built the billing API.\n2. During my placement I built retrieval tools for three teams.";
  const r = guardRoleStatus(letter, RENAMED);
  assert.equal(r.text, letter);
  assert.deepEqual(r.flagged, ["2. During my placement I built retrieval tools for three teams."]);
  const ltd = guardRoleStatus("I worked at Example Ltd. on search, and I am currently on an industrial placement.", RENAMED);
  assert.deepEqual(ltd.flagged, ["I worked at Example Ltd. on search, and I am currently on an industrial placement."], "one sentence, flagged whole");
  assert.equal(ltd.removed.length, 0);
});

test("an ended placement is never current, and another user's real internship is theirs to describe", () => {
  assert.equal(guardRoleStatus("I am currently on a placement at Example Lab.", ENDED).removed.length, 1);
  assert.equal(guardRoleStatus("I completed a placement at Example Lab.", ENDED).removed.length, 0);
  const intern = "EXPERIENCE\nSoftware Engineering Intern | Acme | Jun 2024 – Aug 2024\n• Built a billing dashboard";
  assert.equal(guardRoleStatus("Completed a summer internship at Acme building a billing dashboard.", intern).removed.length, 0);
});

test("the letter's furniture and the job applied for are never a claim; a kept sentence is only reported", () => {
  const letter = "Dear Acme team,\n\nI am applying for the Industrial Placement at Acme. I am currently on an industrial placement at Example Lab.\n\nKind regards,\nAlex Tester";
  const r = guardRoleStatus(letter, RENAMED);
  assert.equal(r.text, "Dear Acme team,\n\nI am applying for the Industrial Placement at Acme.\n\nKind regards,\nAlex Tester");
  assert.equal(r.removed.length, 1);
  const kept = guardRoleStatus("Software engineer currently on an industrial placement.", RENAMED, { keep: () => true });
  assert.equal(kept.text, "Software engineer currently on an industrial placement.", "nothing sound left of it once cut: kept and reported");
  assert.deepEqual(kept.flagged, ["Software engineer currently on an industrial placement."]);
  const t = "Software Engineer currently completing an industrial placement at Example Lab, building retrieval tools.";
  const titled = guardRoleStatus(t, RENAMED, { keep: () => true });
  assert.equal(titled.text, t, "kept as written");
  assert.deepEqual(titled.flagged, [t]);
  assert.deepEqual(guardRoleStatus("", RENAMED), { text: "", removed: [], flagged: [] });
});

// ── Seniority ──────────────────────────────────────────────────────────────
test("a £55k+ floor with mentoring or architecture duties reads as mid-level", () => {
  // The shape of Seccl's Platform engineer posting.
  const band = "Platform engineer | £55K – £75K | Hybrid\n- Architecting, implementing, and maintaining scalable infrastructure in AWS using Terraform.\n- Mentoring engineers and champion DevOps culture and best practices across teams.";
  const read = classifySeniority(band, "Platform engineer");
  assert.equal(read.level, "mid", JSON.stringify(read.score));
  assert.ok(read.signals.some((s) => s.kind === "salary" && /with mentoring duties/.test(s.text)));
  const fit = seniorityFit(read, 2);
  assert.equal(fit.fits, false);
  assert.match(fit.reason, /^This looks like a mid-level job\. Tailoring anyway uses 1 tailored CV/);
  assert.equal(classifySeniority("£58,000 - £70,000\nYou will be architecting our data platform.", "Data Engineer").level, "mid", "architecture duties");
  assert.equal(classifySeniority("£45,000\nMentoring junior engineers as you grow.", "Software Engineer").signals.some((s) => /duties/.test(s.text)), false, "a floor under £55k is not the rule");
  assert.equal(classifySeniority("£80,000 - £100,000\nMentoring engineers across the team.", "Platform Engineer").level, "senior", "a senior band stays senior");
  const grad = classifySeniority("Graduate Software Engineer\n£60,000 – £70,000\nYou will mentor our interns and contribute to architectural decisions.", "Graduate Software Engineer");
  assert.equal(grad.level, "junior", "graduate schemes at £55k+ are common");
  assert.equal(classifySeniority("Software Engineer\n£60,000 – £70,000\nYou'll work alongside our architects.", "Software Engineer").signals.some((s) => /duties/.test(s.text)), false, "architects are people, not a duty");
});

test("an applicant tracker's level label is decisive, like the title", () => {
  // BambooHR's field, as the importer now puts it in the text (Unifeye).
  assert.equal(classifySeniority("Data Engineer (Web apps)\nMinimum experience: Mid-level\n\nAbout us", "Data Engineer (Web apps)").level, "mid");
  assert.equal(classifySeniority("Seniority level: Entry level\nBuild things.", "Software Engineer").level, "junior");
  assert.equal(classifySeniority("Experience level: Mid-Senior level\n", "Engineer").level, "mid");
  assert.equal(classifySeniority("Minimum experience: Senior Manager/Supervisor", "Engineer").level, "senior");
  assert.ok(classifySeniority("Minimum experience: Mid-level").signals.some((s) => s.kind === "label" && s.level === "mid"));
  assert.equal(classifySeniority("There is no minimum experience: senior engineers will train you.", "Software Engineer").signals.some((s) => s.kind === "label"), false, "prose is no label");
});

test("early-career only: a mid-level or senior read never fits, whatever the years", () => {
  const mid = classifySeniority("Minimum experience: Mid-level", "Engineer");
  assert.equal(seniorityFit(mid, 6).fits, true);
  const held = seniorityFit(mid, 6, { earlyCareerOnly: true });
  assert.equal(held.fits, false);
  assert.match(held.reason, /junior and early-career roles only/);
  assert.equal(seniorityFit(classifySeniority("Graduate Software Engineer", "Graduate Software Engineer"), 0, { earlyCareerOnly: true }).fits, true);
});

// ── The whole programme ────────────────────────────────────────────────────
// Graphcore's Graduate Cloud Platform Engineer 2027 posting's own wording.
const PROGRAMME = `Graduate Cloud Platform Engineer 2027
Start date: September 2027
The Graduate Programme at Graphcore
During the two-year programme, you'll build practical experience in Linux, cloud technologies and networking.
Sponsorship
Applicants must already have the right to work in the UK for the full duration of the programme, without requiring visa sponsorship. We are unable to sponsor work visas for our Early Careers opportunities.`;

test("a programme that runs past the user's permission is a Skip, quoting the sponsorship sentence", () => {
  assert.deepEqual(programmeEnd(PROGRAMME), { month: "2029-08", latest: "2029-08", start: "2027-09", months: 24 });
  const t = triageJd(PROGRAMME, { rightToWork: "time_limited", permissionEnds: "2028-01" });
  assert.equal(t.verdict, "skip");
  const hit = t.hits.find((h) => h.rule === "rtw_programme");
  assert.equal(hit?.phrase, "The programme runs until August 2029; your permission ends January 2028");
  assert.match(hit!.sentence, /^Applicants must already have the right to work in the UK for the full duration of the programme/);
});

test("the programme rule never guesses: unanswered, a missing date, or a permission that covers it", () => {
  const unanswered = triageJd(PROGRAMME);
  assert.equal(unanswered.hits.some((h) => h.rule === "rtw_programme"), false);
  assert.ok(unanswered.hits.some((h) => h.rule === "rtw_duration" && h.level === "review"), "still a Review, as before");
  assert.ok(triageJd(PROGRAMME, { rightToWork: "time_limited" }).hits.some((h) => h.rule === "rtw_duration"), "no permission end typed: a Review");
  assert.equal(triageJd(PROGRAMME, { rightToWork: "time_limited", permissionEnds: "2030-01" }).hits.some((h) => h.rule.startsWith("rtw_")), false, "a permission that covers the programme meets it");
  assert.equal(triageJd(PROGRAMME, { rightToWork: "time_limited", permissionEnds: "2029-08" }).hits.some((h) => h.rule.startsWith("rtw_")), false, "to its last month");
  assert.equal(triageJd(PROGRAMME, { rightToWork: "needs_sponsorship" }).hits.find((h) => h.rule === "rtw_programme")?.level, "skip", "needing sponsorship where none is offered");
  assert.equal(triageJd(PROGRAMME, { rightToWork: "full" }).hits.some((h) => h.rule.startsWith("rtw_")), false);
  const noStart = PROGRAMME.replace("Start date: September 2027\n", "");
  assert.ok(triageJd(noStart, { rightToWork: "time_limited", permissionEnds: "2028-01" }).hits.some((h) => h.rule === "rtw_duration" && h.level === "review"), "no stated start: a Review, never a Skip");
});

test("a duration that isn't the programme's stays a Review, and a misread never drops one", () => {
  const job = "Start date: September 2026. You'll join our two-year development programme. You must have the right to work in the UK for the duration of your employment.";
  assert.ok(triageJd(job, { rightToWork: "time_limited", permissionEnds: "2029-01" }).hits.some((h) => h.rule === "rtw_duration" && h.level === "review"), "your employment is not the programme");
  const twoStarts = "Interviews start in January 2027.\n" + PROGRAMME;
  const t = triageJd(twoStarts, { rightToWork: "time_limited", permissionEnds: "2029-01" });
  assert.equal(t.hits.some((h) => h.rule === "rtw_programme"), false, "the earliest reading ends inside the permission: no Skip");
  assert.ok(t.hits.some((h) => h.rule === "rtw_duration"), "and the latest doesn't: the Review stays");
});

test("when a programme ends is read only from what the posting states", () => {
  assert.deepEqual(programmeEnd("Our 18-month graduate scheme starts in March 2027."), { month: "2028-08", latest: "2028-08", start: "2027-03", months: 18 });
  assert.equal(programmeEnd("A September 2027 intake. The programme lasts two years.")?.month, "2029-08");
  assert.equal(programmeEnd("Graduate Programme 2027. Two-year programme."), null, "a year with no month is not a start");
  assert.equal(programmeEnd("Start date: September 2027."), null, "no length");
});

// ── Greenhouse short links and EU boards ───────────────────────────────────
function mock(pages: Record<string, Partial<FetchedJobPage> & { json?: unknown }>) {
  const asked: string[] = [];
  const fetcher: JobFetcher = async (url) => {
    asked.push(url);
    const p = pages[url];
    if (!p) return { status: 404, body: "", url };
    return { status: p.status ?? 200, body: p.json !== undefined ? JSON.stringify(p.json) : (p.body ?? ""), url: p.url ?? url };
  };
  return { fetcher, asked };
}

test("a grnh.se short link is followed to the posting, and an EU board reads from the same API", async () => {
  assert.deepEqual(parseJobUrl("grnh.se/eag5dvw2teu"), { source: "greenhouse", board: "", id: "eag5dvw2teu" });
  assert.deepEqual(parseJobUrl("https://job-boards.eu.greenhouse.io/acme/jobs/5008805101?gh_src=eag5dvw2teu"), { source: "greenhouse", board: "acme", id: "5008805101", eu: true });
  assert.equal(sourceApiUrl({ source: "greenhouse", board: "acme", id: "5008805101", eu: true }), "https://boards-api.greenhouse.io/v1/boards/acme/jobs/5008805101");
  assert.deepEqual(parseJobUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=5008805101"), { source: "greenhouse", board: "acme", id: "5008805101" });
  assert.deepEqual(parseJobUrl("https://job-boards.greenhouse.io/tailscale/jobs/4724314005"), { source: "greenhouse", board: "tailscale", id: "4724314005" });
  assert.equal(parseJobUrl("https://grnh.se/a/b"), null);
  assert.equal(parseJobUrl("https://grnh.se/x"), null);
  for (const host of ["grnh.se", "job-boards.eu.greenhouse.io", "boards.eu.greenhouse.io"]) assert.equal(isImportFetchHost(host), true, host);
  assert.equal(isImportFetchHost("grnh.se.evil.example"), false);

  const { fetcher, asked } = mock({
    "https://grnh.se/eag5dvw2teu": { body: "<html></html>", url: "https://job-boards.eu.greenhouse.io/acme/jobs/5008805101?gh_src=eag5dvw2teu" },
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs/5008805101": {
      json: { title: "Technical Support Engineer", company_name: "Acme", location: { name: "London" }, content: "&lt;p&gt;Support our clients across trading systems.&lt;/p&gt;", absolute_url: "https://job-boards.eu.greenhouse.io/acme/jobs/5008805101" },
    },
  });
  const r = await fetchJobFromUrl("https://grnh.se/eag5dvw2teu", fetcher);
  assert.equal(r.ok && r.job.title, "Technical Support Engineer");
  assert.deepEqual(asked, ["https://grnh.se/eag5dvw2teu", "https://boards-api.greenhouse.io/v1/boards/acme/jobs/5008805101"]);
  const offsite = await fetchJobFromUrl("https://grnh.se/eag5dvw2teu", async () => null);
  assert.equal(!offsite.ok && offsite.errorType, "fetch_failed");
  assert.match(!offsite.ok ? offsite.error : "", /leads off Greenhouse/);
});

test("BambooHR's own level field stays in the text the pre-check reads", async () => {
  const { fetcher } = mock({ "https://acme.bamboohr.com/careers/34/detail": { json: { result: { jobOpening: { jobOpeningName: "Data Engineer", minimumExperience: "Mid-level", description: "<p>Build pipelines in Spark and SQL for clients.</p>" } } } } });
  const r = await fetchJobFromUrl("https://acme.bamboohr.com/careers/34", fetcher);
  assert.ok(r.ok);
  assert.match(r.ok ? r.job.description : "", /Minimum experience: Mid-level/);
});
