// Unit tests for the tracker insights aggregation. node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights, rowFromApplication, scoreOutcome, seniorityOf, MIN_DECIDED, TOP_N, MIN_FOR_VERDICT, type InsightRow } from "../src/lib/insights.ts";

const row = (status: string, over: Partial<InsightRow> = {}): InsightRow => ({ status, role: "Backend Engineer", company: "Acme", ...over });

test("rowFromApplication reads list and detail shapes defensively", () => {
  const detail = rowFromApplication({
    status: "Interview",
    role: " Platform Engineer ",
    company_name: "Acme Ltd",
    tailored_cv: {
      ats: { keywords: { hits: ["a", "b", "c"], misses: ["d"] }, required: { hits: ["a"], misses: ["b", "c"] } },
      gates: { read: "long_shot", hard: 0, soft: 1, unknown: 0, items: [] },
    },
  });
  assert.deepEqual(detail, { status: "Interview", role: "Platform Engineer", company: "Acme Ltd", kwHits: 3, kwTotal: 4, reqHits: 1, reqTotal: 3, gateRead: "long_shot", seniority: "mid" });
  const list = rowFromApplication({ status: "Applied", role: "X", company_name: "Y", ats: { keywords: { hits: [], misses: ["d"] } }, gates: { read: "bogus" } });
  assert.deepEqual(list, { status: "Applied", role: "X", company: "Y", kwHits: 0, kwTotal: 1, seniority: "mid" });
  assert.deepEqual(rowFromApplication(null), { status: "", role: "", company: "" });
  assert.deepEqual(rowFromApplication({ status: "Rejected", tailored_cv: { ats: "junk", gates: 7 } }), { status: "Rejected", role: "", company: "" });
  // Count-only scores (the backfill kept the figures the notes recorded, never
  // the lists) and a stored seniority read the same way as lists.
  const backfilled = rowFromApplication({ status: "Rejected", role: "Senior Engineer", company_name: "Z", tailored_cv: { ats: { keywords: { matched: 13, total: 15 }, required: { matched: 10, total: 10 }, source: "notes" }, seniority: "junior" } });
  assert.deepEqual(backfilled, { status: "Rejected", role: "Senior Engineer", company: "Z", kwHits: 13, kwTotal: 15, reqHits: 10, reqTotal: 10, seniority: "junior" });
  assert.deepEqual(rowFromApplication({ status: "Rejected", role: "R", company_name: "Z", tailored_cv: { ats: { keywords: { matched: 16, total: 15 } } } }).kwTotal, undefined, "impossible counts are ignored");
});

test("seniorityOf reads the title", () => {
  assert.equal(seniorityOf("Senior Full Stack Developer (Java)"), "senior");
  assert.equal(seniorityOf("Software Engineer Graduate Scheme"), "junior");
  assert.equal(seniorityOf("Associate Software Engineer"), "junior");
  assert.equal(seniorityOf("Engineering Software Industrial Placement"), "junior");
  assert.equal(seniorityOf("Software Engineer (AI/Backend)"), "mid");
  assert.equal(seniorityOf(""), "mid");
});

test("scoreOutcome: decided applications against their score, AUC, the top-N read honestly", () => {
  const p = (status: string, hits: number, company = "C") => row(status, { kwHits: hits, kwTotal: 15, company });
  // The production shape: the five highest scores are all rejections.
  const rows: InsightRow[] = [
    p("Rejected", 14, "A"), p("Rejected", 13, "B"), p("Rejected", 13, "C"), p("Rejected", 12, "D"), p("Rejected", 12, "E"),
    p("Screening", 10, "F"), p("Interview", 9, "G"), p("Rejected", 8, "H"), p("Offer", 7, "I"),
    p("Applied", 15, "J"), row("Rejected", { company: "K" }), row("Withdrawn", { kwHits: 15, kwTotal: 15 }),
  ];
  const s = scoreOutcome(rows);
  assert.equal(s.points.length, 9);
  assert.equal(s.points[0].company, "A", "highest score first");
  assert.deepEqual(s.topOutcomes, ["rejected", "rejected", "rejected", "rejected", "rejected"]);
  assert.equal(s.topAllRejected, true);
  assert.equal(s.progressed, 3);
  assert.equal(s.rejected, 6);
  assert.equal(s.pendingScored, 1);
  assert.equal(s.unscoredDecided, 1);
  // Progressed scores 10, 9, 7 vs rejected 14, 13, 13, 12, 12, 8: only 10 and
  // 9 beat the rejected 8 (2 wins of 18 pairs).
  assert.equal(s.auc, 2 / 18);
  assert.equal(s.verdict, "no_signal");
  assert.ok(s.meanRejected! > s.meanProgressed!);
  assert.equal(s.topN, TOP_N);
  // Too few to judge: under the minimum, or one outcome missing.
  const few = scoreOutcome([p("Rejected", 14), p("Screening", 3), p("Rejected", 9)]);
  assert.equal(few.verdict, "too_few");
  assert.equal(few.topAllRejected, false, "fewer than TOP_N points never claims a top-N read");
  assert.equal(scoreOutcome([p("Rejected", 14), p("Rejected", 9)]).auc, null);
  // A score that separates outcomes reads as a signal; ties count half.
  const good = scoreOutcome([...Array.from({ length: 4 }, (_, i) => p("Interview", 13 - i)), ...Array.from({ length: 4 }, (_, i) => p("Rejected", 6 - i))]);
  assert.equal(good.points.length, MIN_FOR_VERDICT);
  assert.equal(good.auc, 1);
  assert.equal(good.verdict, "signal");
  assert.equal(scoreOutcome([p("Interview", 10), p("Rejected", 10)]).auc, 0.5);
  assert.equal(scoreOutcome([]).verdict, "too_few");
});

test("computeInsights: outcomes, bands, withdrawn excluded, rate null under the minimum", () => {
  const rows: InsightRow[] = [
    row("Interview", { kwHits: 12, kwTotal: 15, reqHits: 9, reqTotal: 10, gateRead: "apply" }),
    row("Offer", { kwHits: 13, kwTotal: 15, reqHits: 8, reqTotal: 10, gateRead: "apply" }),
    row("Rejected", { kwHits: 12, kwTotal: 15, reqHits: 8, reqTotal: 10, gateRead: "apply" }),
    row("Rejected", { kwHits: 5, kwTotal: 15, reqHits: 3, reqTotal: 10, gateRead: "skip", role: "Data Engineer" }),
    row("Rejected", { kwHits: 6, kwTotal: 15, reqHits: 4, reqTotal: 10, gateRead: "skip", role: "Data Engineer" }),
    row("Applied", { kwHits: 9, kwTotal: 15, reqHits: 6, reqTotal: 10, gateRead: "long_shot", company: "Globex" }),
    row("Withdrawn", { kwHits: 14, kwTotal: 15, gateRead: "apply" }),
    row("Screening", { company: "acme" }), // no stored lists (older row), company keyed case-insensitively
  ];
  const i = computeInsights(rows);
  assert.equal(i.total, 8);
  assert.equal(i.counted, 7);
  assert.equal(i.scored, 6);
  assert.equal(i.gated, 6);
  assert.deepEqual([i.progressed, i.rejected, i.decided], [3, 3, 6]);
  assert.equal(i.overallRate, 0.5);

  const high = i.byVisibility.find((b) => b.key === "high");
  assert.ok(high);
  assert.deepEqual([high.n, high.progressed, high.rejected, high.rate], [3, 2, 1, 2 / 3]);
  const low = i.byVisibility.find((b) => b.key === "low");
  assert.ok(low);
  assert.deepEqual([low.n, low.rejected, low.rate], [2, 2, null]); // only 2 decided
  assert.equal(i.byVisibility.map((b) => b.key).join(","), "low,mid,high");

  const skip = i.byGate.find((b) => b.key === "skip");
  assert.ok(skip && skip.n === 2 && skip.rejected === 2 && skip.rate === null);
  const apply = i.byGate.find((b) => b.key === "apply");
  assert.ok(apply && apply.n === 3 && apply.rate === 2 / 3); // the withdrawn row is not counted

  const acme = i.byCompany.find((b) => b.key === "acme");
  assert.ok(acme && acme.n === 6 && acme.label === "Acme");
  assert.equal(i.byCompany.find((b) => b.key === "globex"), undefined); // n < 2 is cut
  assert.deepEqual(i.byRole.map((b) => [b.label, b.n]), [["Backend Engineer", 5], ["Data Engineer", 2]]);
  assert.equal(MIN_DECIDED, 3);
});

test("computeInsights on nothing", () => {
  const i = computeInsights([]);
  assert.equal(i.total, 0);
  assert.equal(i.overallRate, null);
  assert.deepEqual(i.byVisibility, []);
});
