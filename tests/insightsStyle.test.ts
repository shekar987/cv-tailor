// The format-style group of the tracker insights (lib/insights byStyle):
// the tag read off the list alias or the snapshot, the rate only from
// MIN_DECIDED decided applications, rows with no recorded style counted and
// never compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights, rowFromApplication, MIN_DECIDED, type InsightRow } from "../src/lib/insights.ts";

const row = (status: string, over: Partial<InsightRow> = {}): InsightRow => ({ status, role: "Backend Engineer", company: "Acme", ...over });

test("rowFromApplication reads the style off the list alias or the snapshot, never defaults it", () => {
  assert.equal(rowFromApplication({ status: "Applied", role: "X", company_name: "Y", format_style: "careerset" }).formatStyle, "careerset");
  assert.equal(rowFromApplication({ status: "Applied", role: "X", company_name: "Y", tailored_cv: { formatStyle: "ukji" } }).formatStyle, "ukji");
  // Junk and absence both read as "not recorded": no key at all.
  assert.equal("formatStyle" in rowFromApplication({ status: "Applied", role: "X", company_name: "Y", format_style: "fancy" }), false);
  assert.equal("formatStyle" in rowFromApplication({ status: "Applied", role: "X", company_name: "Y" }), false);
  // The alias wins over the snapshot when both are present.
  assert.equal(rowFromApplication({ status: "Applied", role: "X", company_name: "Y", format_style: "ukji", tailored_cv: { formatStyle: "careerset" } }).formatStyle, "ukji");
});

test("computeInsights: a bucket per recorded style, a rate from MIN_DECIDED decided, the rest counted apart", () => {
  const rows: InsightRow[] = [
    ...Array.from({ length: 6 }, () => row("Rejected", { formatStyle: "ukji" })),
    ...Array.from({ length: 2 }, () => row("Interview", { formatStyle: "ukji" })),
    ...Array.from({ length: 3 }, () => row("Rejected", { formatStyle: "careerset" })),
    row("Screening", { formatStyle: "careerset" }),
    row("Applied", { formatStyle: "careerset" }),
    row("Rejected"),
    row("Applied"),
    row("Withdrawn", { formatStyle: "ukji" }),
    row("Ready to submit", { formatStyle: "careerset" }),
  ];
  const i = computeInsights(rows);
  assert.deepEqual(
    i.byStyle.map((b) => [b.key, b.label, b.n, b.progressed, b.rejected, b.rate]),
    [
      ["ukji", "UKJI", 8, 2, 6, 0.25],
      ["careerset", "CareerSet", 5, 1, 3, null],
    ]
  );
  assert.equal(MIN_DECIDED, 8);
  // Withdrawn and Ready-to-submit rows are out of every figure, so the two
  // rows with no style are the only ones "not recorded".
  assert.equal(i.styleNotRecorded, 2);
  // UKJI comes first whatever the order of the rows.
  const j = computeInsights([row("Rejected", { formatStyle: "careerset" }), row("Rejected", { formatStyle: "ukji" })]);
  assert.deepEqual(j.byStyle.map((b) => b.key), ["ukji", "careerset"]);
  assert.deepEqual(computeInsights([]).byStyle, []);
  assert.equal(computeInsights([]).styleNotRecorded, 0);
});
