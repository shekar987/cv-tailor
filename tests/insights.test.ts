// Unit tests for the tracker insights aggregation. node:test, zero deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights, rowFromApplication, MIN_DECIDED, type InsightRow } from "../src/lib/insights.ts";

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
  assert.deepEqual(detail, { status: "Interview", role: "Platform Engineer", company: "Acme Ltd", kwHits: 3, kwTotal: 4, reqHits: 1, reqTotal: 3, gateRead: "long_shot" });
  const list = rowFromApplication({ status: "Applied", role: "X", company_name: "Y", ats: { keywords: { hits: [], misses: ["d"] } }, gates: { read: "bogus" } });
  assert.deepEqual(list, { status: "Applied", role: "X", company: "Y", kwHits: 0, kwTotal: 1 });
  assert.deepEqual(rowFromApplication(null), { status: "", role: "", company: "" });
  assert.deepEqual(rowFromApplication({ status: "Rejected", tailored_cv: { ats: "junk", gates: 7 } }), { status: "Rejected", role: "", company: "" });
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
