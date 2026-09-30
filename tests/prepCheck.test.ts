// Unit tests for the prep pack's sentence-level check (lib/prepCheck) and the
// pack contract it extends (lib/prepPack). Modelled on the PwC pack of
// 19 Sep 2026 with a synthetic CV. node:test, zero dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePrepPack, packFromRow, verifyEvidence, type PrepPack, type PrepMeta } from "../src/lib/prepPack.ts";
import { candidateSentenceFlag, companyFactProblems, prepCopyTerms, checkPrepPack, flaggedForTarget, normalizePrepRewrites, applyPrepRewrites, claimLike, refersToCompany, type PrepCheckContext } from "../src/lib/prepCheck.ts";

const CV = `ALEX EXAMPLE
Software Engineer

EXPERIENCE
Software Engineer | Northwind Labs | Jul 2023 – Present
- Built REST services in Python and FastAPI for an internal billing product used by 3,000 staff
- Improved frequently accessed query response times by 30% by adding PostgreSQL indexes and Redis caching
- Wrote 90+ pytest tests covering the invoicing flow

PROJECTS
AssetGuard+ (personal portfolio project modelled on a real-world brief) — Next.js, Supabase
- Built a gap-analysis dashboard comparing 11 asset-management platforms

EDUCATION
MSc Computer Science | University of East London | Sep 2025 – Jan 2027

Skills
Technical Tools: Python | FastAPI | PostgreSQL | Redis | Next.js | Supabase`;

const JD = "Technology Consultant at PwC. Python, PostgreSQL, MongoDB, Kubernetes. You will work with FTSE 100 clients on data platforms.";
const RESEARCH = { company_name: "PwC", what_they_build: "Professional services for FTSE 100 and public-sector clients.", engineering_stack: ["Python", "Kubernetes"] };

const meta: PrepMeta = { company: "PwC", role: "Technology Consultant", generatedAt: "2026-09-19T10:00:00.000Z", sources: { jd: true, tailoredCv: false, research: true, talkingPoints: false } };

function ctxFor(over: Partial<PrepCheckContext> = {}): PrepCheckContext {
  const copyTerms = prepCopyTerms({ required: ["Python", "PostgreSQL", "MongoDB", "Kubernetes"], keywords: ["data platforms"] }, [], ["Python", "Kubernetes"], [CV]);
  return { cv: CV, pool: null, jd: JD, research: RESEARCH, copyTerms, ...over };
}

const RAW = {
  angle: {
    headline: "You were selected for AssetGuard+ because of a track record of shipping cutting-edge dashboards.",
    whyYou: [
      "Built REST services in Python and FastAPI for an internal billing product used by 3,000 staff.",
      "PwC's client work spans FTSE 500 companies.",
      "2+ years shipping production systems: engineered a high-volume Spring Boot transaction API reducing latency by 40%.",
    ],
    honestGaps: [{ gap: "MongoDB", howToAddress: "Say you have used PostgreSQL and Redis in production and would learn MongoDB on the job." }],
  },
  questions: [
    {
      category: "behavioral",
      question: "Tell me about a time you improved performance.",
      whyTheyAsk: "They want evidence you measure.",
      star: {
        situation: "The internal billing product at Northwind Labs, used by 3,000 staff, had slow pages.",
        task: "I was asked to make the frequently accessed queries faster.",
        action: "Diagnosed slow queries using database query logs, optimised join strategies and measured response times before and after.",
        result: "Optimised PostgreSQL and MongoDB queries by 30%.",
      },
      points: [],
      evidence: ["Improved frequently accessed query response times by 30% by adding PostgreSQL indexes and Redis caching"],
    },
    {
      category: "technical",
      question: "How would you design a data platform?",
      whyTheyAsk: "Core of the role.",
      star: null,
      points: ["I have built Kubernetes clusters for three clients.", "I would start by asking what the platform must answer and for whom.", "Built REST services in Python and FastAPI for an internal billing product used by 3,000 staff."],
      evidence: [],
    },
    { category: "company", question: "Why PwC?", whyTheyAsk: "PwC's FTSE 500 practice is the largest in Europe.", star: null, points: ["PwC serves FTSE 100 and public-sector clients, which matches my billing-product work."], evidence: [] },
    { category: "gap", question: "Have you used MongoDB?", whyTheyAsk: "It is in the posting.", star: null, points: ["I have used MongoDB in production for two years."], evidence: [] },
    { category: "role", question: "Why consulting?", whyTheyAsk: "Fit.", star: null, points: ["I would enjoy the variety of client problems."], evidence: [] },
  ],
  questionsToAsk: ["How is the FTSE 500 practice structured?", "Which data platforms do your teams build most?"],
  opener: "I'm a software engineer at Northwind Labs. I'm AWS Certified in AI Practitioner. I built REST services in Python and FastAPI for a billing product used by 3,000 staff.",
};

test("candidateSentenceFlag: the PwC sentences, each for its own reason; true CV facts, advice and intent pass", () => {
  const ctx = ctxFor();
  const star = { kind: "star" as const };
  const prose = { kind: "prose" as const };
  assert.equal(candidateSentenceFlag("Diagnosed slow queries using database query logs, optimised join strategies and measured response times before and after.", ctx, star)?.reason, "not_in_cv");
  const moved = candidateSentenceFlag("Optimised PostgreSQL and MongoDB queries by 30%.", ctx, star);
  assert.ok(moved && ["figure", "not_in_cv", "jd_copy"].includes(moved.reason), JSON.stringify(moved));
  assert.equal(candidateSentenceFlag("You were selected for AssetGuard+ because of a track record of shipping cutting-edge dashboards.", ctx, prose)?.reason, "narration");
  assert.equal(candidateSentenceFlag("You were selected for AssetGuard+ because of a track record of shipping cutting-edge dashboards.", ctx, { ...prose, narration: false })?.reason, "not_in_cv", "the angle may narrate; it may not invent");
  assert.equal(candidateSentenceFlag("I have built Kubernetes clusters for three clients.", ctx, prose)?.reason, "jd_copy");
  assert.equal(candidateSentenceFlag("I'm AWS Certified in AI Practitioner.", ctx, prose)?.reason, "not_in_cv");
  assert.equal(candidateSentenceFlag("Cut invoicing time by 45% across the team last quarter.", ctx, star)?.reason, "figure");
  assert.equal(candidateSentenceFlag("Cut invoicing time by 45% across the team last quarter.", ctx, prose)?.reason, "figure", "a figure the CV lacks is never advice");
  for (const [ok, o] of [
    ["Built REST services in Python and FastAPI for an internal billing product used by 3,000 staff.", star],
    ["The internal billing product at Northwind Labs, used by 3,000 staff, had slow pages.", star],
    ["I would start by asking what the platform must answer and for whom.", prose],
    ["Ask about the team's on-call rota.", prose],
    ["I wrote 90+ pytest tests.", prose],
    // Technical advice, an approach and intent are not claims about the past (the owner's stored packs, 30 Sep).
    ["For PostgreSQL: add indexes on WHERE and JOIN clauses, refactor N+1 queries, consider query rewrites.", prose],
    ["On your systems, I'd start by instrumenting the slowest endpoints in production.", prose],
    ["For MongoDB: index on query fields and use aggregation pipelines instead of client-side filtering.", prose],
    ["I'm excited about applying those skills to PwC's client-facing transformation work.", prose],
  ] as const) assert.equal(candidateSentenceFlag(ok, ctx, o), null, ok);
  assert.equal(candidateSentenceFlag("I'm AWS Certified in AI Practitioner.", ctxFor({ cv: `${CV}\nCertifications\nAWS Certified AI Practitioner (2025)` }), prose), null, "the certificate on the CV makes it a fact");
  assert.equal(claimLike("Measured response times before and after each change.", "star"), true);
  assert.equal(claimLike("Measured response times before and after each change.", "prose"), false);
  assert.equal(claimLike("I measured response times before and after each change.", "prose"), true);
});

test("companyFactProblems: names and figures the job description and research never state", () => {
  const sources = [JD, JSON.stringify(RESEARCH)];
  assert.deepEqual(companyFactProblems("PwC's client work spans FTSE 500 companies.", sources), ["500"]);
  assert.deepEqual(companyFactProblems("PwC serves FTSE 100 and public-sector clients.", sources), []);
  assert.ok(companyFactProblems("Their Deloitte partnership handles 40% of the market.", sources).length >= 2);
});

test("prepCopyTerms: the row's stored terms and the research stack, minus what the CV shows", () => {
  const terms = ctxFor().copyTerms.map((t) => t.term);
  assert.deepEqual(terms, ["MongoDB", "Kubernetes", "data platforms"]);
  assert.deepEqual(prepCopyTerms(null, ["Kafka"], [], [CV]).map((t) => t.term), ["Kafka"], "a hand-added row has only the research to go on");
});

test("checkPrepPack: candidate claims flagged and kept, company claims removed, gaps and strategy untouched, summary honest", () => {
  const pack = verifyEvidence(normalizePrepPack(RAW, meta)!, CV);
  const checked = checkPrepPack(pack, ctxFor());
  const kept = checked.flags.filter((f) => f.action === "kept");
  const removed = checked.flags.filter((f) => f.action === "removed");
  assert.ok(kept.some((f) => f.questionId === "q1" && f.field === "action" && f.reason === "not_in_cv"), JSON.stringify(kept));
  assert.ok(kept.some((f) => f.questionId === "q1" && f.field === "result"));
  assert.ok(kept.some((f) => f.questionId === "q2" && f.field === "point" && f.index === 0 && f.reason === "jd_copy"));
  assert.ok(kept.some((f) => f.questionId === null && f.field === "headline" && f.reason === "not_in_cv"), "the angle may narrate the match; an invented selection story is still not from the CV");
  assert.ok(kept.some((f) => f.questionId === null && f.field === "opener" && /AWS Certified/.test(f.sentence)));
  assert.ok(!kept.some((f) => f.questionId === "q4"), "a gap question's strategy is never flagged");
  assert.ok(!kept.some((f) => f.questionId === "q5"), "a forward-looking line is advice");
  assert.ok(!kept.some((f) => f.questionId === "q2" && f.index === 2), "a verbatim CV bullet passes");
  // The company claims the sources never state are gone from the text.
  assert.deepEqual(removed.map((f) => f.sentence), ["How is the FTSE 500 practice structured?", "PwC's FTSE 500 practice is the largest in Europe."]);
  // The angle is about the candidate: a company fact there is marked, not removed.
  assert.deepEqual(checked.angle.whyYou, [
    "Built REST services in Python and FastAPI for an internal billing product used by 3,000 staff.",
    "PwC's client work spans FTSE 500 companies.",
    "2+ years shipping production systems: engineered a high-volume Spring Boot transaction API reducing latency by 40%.",
  ]);
  assert.ok(kept.some((f) => f.field === "whyYou" && f.index === 1), "the FTSE 500 reason is marked");
  // A third-person reason about the CANDIDATE that the CV does not support is kept and marked, never removed as a company fact.
  assert.ok(kept.some((f) => f.field === "whyYou" && f.index === 2 && (f.reason === "figure" || f.reason === "not_in_cv")), JSON.stringify(kept.filter((f) => f.field === "whyYou")));
  assert.equal(refersToCompany("PwC's client work spans FTSE 500 companies.", "PwC UK"), true);
  assert.equal(refersToCompany("Their platform handles 40% of the market.", "Acme"), true);
  assert.equal(refersToCompany("2+ years shipping production systems: engineered a high-volume Spring Boot transaction API.", "PwC UK"), false);
  assert.equal(refersToCompany("The company reported record revenue.", "Epos Now Group"), true, "a company reference by noun");
  assert.equal(refersToCompany("Right now the pipeline processes 2,000 events a minute.", "Epos Now Group"), false, "a common word in the name is no reference");
  assert.deepEqual(checked.questionsToAsk, ["Which data platforms do your teams build most?"]);
  assert.equal(checked.questions.find((q) => q.category === "company")!.whyTheyAsk, "");
  assert.equal(checked.questions.find((q) => q.category === "company")!.points.length, 1, "a company point the research supports stays");
  // The text the check keeps is still there, marked, not deleted.
  assert.match(checked.questions[0].star!.action, /^Diagnosed slow queries/);
  assert.match(checked.opener, /AWS Certified/);
  assert.equal(checked.check?.flagged, kept.length);
  assert.equal(checked.check?.removed, 2);
  assert.deepEqual(checked.check?.companySources, ["jd", "research"]);
  assert.equal(checked.check?.terms, 3);
  assert.ok(checked.check!.sentences > 15);
  // Round trip: the flags and the summary survive the row reader; a legacy pack has none.
  const back = packFromRow(JSON.parse(JSON.stringify(checked)))!;
  assert.deepEqual(back.flags, checked.flags);
  assert.deepEqual(back.check, checked.check);
  const legacy = packFromRow(JSON.parse(JSON.stringify({ ...pack, flags: undefined, check: undefined })))!;
  assert.deepEqual(legacy.flags, []);
  assert.equal(legacy.check, null);
  assert.deepEqual(packFromRow({ ...checked, flags: [{ questionId: "q99", field: "action", sentence: "x", reason: "not_in_cv" }, { questionId: null, field: "nope", sentence: "x", reason: "figure" }] })!.flags, [], "flags for unknown questions or fields are dropped");
});

test("applyPrepRewrites: a replacement that passes is taken, one that still fails goes, silence removes, the pack is re-checked", () => {
  const ctx = ctxFor();
  const checked = checkPrepPack(verifyEvidence(normalizePrepPack(RAW, meta)!, CV), ctx);
  // The task ("I was asked to …") is narrative the CV never states, so it is
  // flagged too — three fields, and the model is only asked about them.
  const items = flaggedForTarget(checked, { target: "question", questionId: "q1" });
  assert.deepEqual(items.map((x) => x.flag.field), ["task", "action", "result"]);
  const [, action, result] = items;
  const reps = normalizePrepRewrites(
    { rewrites: [{ id: action.id, text: "I added PostgreSQL indexes and Redis caching to the frequently accessed queries." }, { id: result.id, text: "Response times for those queries improved by 30%, and I also cut costs by 60%." }, { id: "f99", text: "ignored" }] },
    items
  );
  assert.equal(reps.size, 2);
  const r = applyPrepRewrites(checked, { target: "question", questionId: "q1" }, reps, ctx);
  assert.equal(r.rewritten, 1);
  assert.equal(r.removed, 2, "a replacement with a figure the CV lacks is refused and the sentence goes; silence on the task removes it");
  const q1 = r.pack.questions[0];
  assert.equal(q1.star!.action, "I added PostgreSQL indexes and Redis caching to the frequently accessed queries.");
  assert.equal(q1.star!.result, "");
  assert.equal(q1.star!.task, "");
  assert.ok(!r.pack.flags.some((f) => f.questionId === "q1" && f.action === "kept"), "nothing flagged is left on the question");
  const silent = applyPrepRewrites(checked, { target: "opener" }, new Map(), ctx);
  assert.equal(silent.removed, 1);
  assert.ok(!/AWS Certified/.test(silent.pack.opener));
  assert.match(silent.pack.opener, /^I'm a software engineer at Northwind Labs\. I built REST services/);
  const angle = applyPrepRewrites(checked, { target: "angle" }, new Map(), ctx);
  assert.equal(angle.pack.angle.headline, "");
});

test("normalizePrepPack: the flags field is bounded and the contract otherwise unchanged", () => {
  const pack: PrepPack = normalizePrepPack({ ...RAW, flags: "no", check: { version: 2 } }, meta)!;
  assert.deepEqual(pack.flags, []);
  assert.equal(pack.check, null);
  assert.equal(pack.questions.length, 5);
});
