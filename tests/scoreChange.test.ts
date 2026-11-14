import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreChange, scoreChangeLine, scoreCardCopy, splitMisses } from "../src/lib/scoreChange.ts";
import { BAND_LABELS, bandFor, combineWithFit, reconcileAtsScore, plainNames } from "../src/lib/visibilityVerdict.ts";
import { matchAtsKeywords } from "../src/lib/atsMatch.ts";
import { toListRow, toPageRow } from "../src/lib/applicationRows.ts";

const TERMS = ["Python", "FastAPI", "PostgreSQL", "Kubernetes", "Computer Science"];
const MASTER = `Alex Tester

WORK EXPERIENCE
Software Engineer | Northwind Labs | Jul 2024 – Present
• Built REST services in Python and FastAPI on PostgreSQL

EDUCATION
BSc Computer Science, University of Leeds`;

// /api/analyze scores the master CV text /app sends as cvText; the "before" reads the same
// whole text, Education included, which the score after tailoring does not read.
test("the 'before' reads the whole master CV, Education included; the 'after' only what it is given", () => {
  const c = scoreChange(MASTER, "Built services in Python", TERMS);
  assert.ok(c);
  assert.ok(c.before.matchedKeywords.includes("Computer Science"));
  assert.equal(matchAtsKeywords(MASTER.replace(/EDUCATION[\s\S]*$/, ""), TERMS).matchedKeywords.includes("Computer Science"), false);
  assert.deepEqual(c.after.matchedKeywords, ["Python"]);
  assert.equal(c.before.total, c.after.total);
});

test("terms gained and terms no longer counted are named", () => {
  // The tailored sections carry FastAPI and Python but not the degree, which only Education names.
  const tailored = "Software Engineer building Python and FastAPI services on PostgreSQL";
  const c = scoreChange(MASTER, tailored, TERMS);
  assert.ok(c);
  assert.equal(c.before.matched, 4);
  assert.equal(c.after.matched, 3);
  assert.deepEqual(c.gained, []);
  assert.deepEqual(c.lost, ["Computer Science"]);
  assert.equal(scoreChangeLine(c), "Before tailoring: 4/5 in your main CV. No longer counted: Computer Science (in your main CV, but not in this tailored CV: listed below).");
});

test("an unchanged count says so", () => {
  const c = scoreChange("Python and FastAPI", "Python, FastAPI", ["Python", "FastAPI", "Go"]);
  assert.ok(c);
  assert.equal(scoreChangeLine(c), "Before tailoring: 2/3 in your main CV. Tailoring did not change which terms are matched.");
});

test("a gained term is named", () => {
  const c = scoreChange("Python", "Python on Kubernetes", ["Python", "Kubernetes"]);
  assert.equal(c && scoreChangeLine(c), "Before tailoring: 1/2 in your main CV. Now matched: Kubernetes.");
});

test("no line rather than one that contradicts the figure on the card", () => {
  assert.equal(scoreChange(MASTER, "Python", TERMS, 4), null);
  assert.ok(scoreChange(MASTER, "Python", TERMS, 1));
  assert.equal(scoreChange(MASTER, "Python", []), null);
  assert.equal(scoreChange(MASTER, "Python", undefined), null);
});

// Chunk 24: the list says a tailored row holds a letter without sending the letter.
test("the list flags a stored letter and never carries its text", () => {
  const row = { id: "a", company_name: "Acme", role: "Engineer", status: "applied", source: "tailored", cover_letter_text: "Dear Acme team,\nI am applying…" };
  const listed = toListRow(row);
  assert.equal(listed.has_cover_letter, true);
  assert.equal("cover_letter_text" in listed, false);
  assert.equal(toPageRow(row).has_cover_letter, true);
  assert.equal("has_cover_letter" in toListRow({ ...row, cover_letter_text: "  " }), false);
  assert.equal("has_cover_letter" in toListRow({ ...row, cover_letter_text: null }), false);
});

// ── Chunk 28: the card's sentence, and a Missing list the free check agrees with ──

const FIFTEEN = ["Python", "FastAPI", "PostgreSQL", "SQL", "REST APIs", "Docker", "Observability", "Tracing", "Backend", "Kubernetes", "CI/CD", "AWS", "Kafka", "Terraform", "Logistics"];
// A before / after read with exact counts: the first `before` terms in the main CV, the first `after` in the tailored text.
const read = (before: number, after: number, terms = FIFTEEN) => {
  const c = scoreChange(terms.slice(0, before).join(", "), terms.slice(0, after).join(", "), terms);
  assert.ok(c);
  assert.equal(c.before.matched, before);
  assert.equal(c.after.matched, after);
  return c;
};
const card = (before: number, after: number, hasEdits = true) => {
  const band = bandFor(after, FIFTEEN.length);
  return { band, copy: scoreCardCopy(band, BAND_LABELS[band], read(before, after), hasEdits) };
};

test("after > before: the card says the score improved, and Borderline is gone", () => {
  const { band, copy } = card(7, 9);
  assert.equal(band, "borderline");
  assert.equal(copy.headline, "Improved from 7/15 to 9/15. Optional fixes before you send are listed below.");
  assert.equal(copy.editsHeading, "Optional fixes before you send");
  assert.equal(copy.improved, true);
  assert.ok(!/borderline|fix these/i.test(copy.headline));
  // With no edits to list, the sentence does not point at a list.
  assert.equal(card(7, 9, false).copy.headline, "Improved from 7/15 to 9/15.");
});

test("after == before: the band's own sentence stays", () => {
  const { band, copy } = card(9, 9);
  assert.equal(band, "borderline");
  assert.equal(copy.headline, "Borderline. Fix these before sending.");
  assert.equal(copy.editsHeading, "Fix before sending");
  assert.equal(copy.improved, false);
});

test("after < before: the band's own sentence stays", () => {
  const { band, copy } = card(10, 9);
  assert.equal(band, "borderline");
  assert.equal(copy.headline, "Borderline. Fix these before sending.");
  assert.equal(copy.editsHeading, "Fix before sending");
  assert.equal(copy.improved, false);
});

test("an improved weak match is still told not to send; an improved ready one is ready", () => {
  const weak = card(2, 4);
  assert.equal(weak.band, "weak");
  assert.equal(weak.copy.headline, "Improved from 2/15 to 4/15, but still a weak match. Do not send it yet.");
  assert.equal(weak.copy.editsHeading, "Fix first");
  assert.ok(!/optional|ready|strong|competitive|submittable/i.test(weak.copy.headline));
  const ready = card(9, 12);
  assert.equal(ready.band, "ready");
  assert.equal(ready.copy.headline, "Improved from 9/15 to 12/15. Ready to send.");
  assert.equal(ready.copy.editsHeading, "Optional edits");
});

test("a verdict that company research lowered is never replaced by the improvement line", () => {
  const change = read(7, 12);
  const low = combineWithFit("ready", { total: 41, tier: "low" });
  assert.equal(scoreCardCopy(low.band, low.label, change, true).headline, low.label);
  const medium = combineWithFit("ready", { total: 66, tier: "medium" });
  assert.equal(scoreCardCopy(medium.band, medium.label, change, true).headline, medium.label);
  assert.equal(scoreCardCopy(medium.band, medium.label, change, true).editsHeading, "Fix before sending");
  // Research that agrees with the band leaves the plain label, so the line may say it improved.
  const high = combineWithFit("ready", { total: 88, tier: "high" });
  assert.equal(scoreCardCopy(high.band, high.label, change, true).headline, "Improved from 7/15 to 12/15. Ready to send.");
});

test("with no before / after read, the card keeps the band's sentence", () => {
  assert.deepEqual(scoreCardCopy("borderline", BAND_LABELS.borderline, null, true), { headline: BAND_LABELS.borderline, editsHeading: "Fix before sending", improved: false });
});

test("7/15 to 9/15: the result's Missing list holds no term the free check did not list", () => {
  // The audit's case: "Backend" is in the main CV (the free check counted it), the tailored text
  // dropped it, and three terms were gained.
  const master = "Python, FastAPI, PostgreSQL, SQL, REST APIs, Docker. Backend developer.";
  const tailored = "Python, FastAPI, PostgreSQL, SQL, REST APIs, Docker, Observability, Tracing, Kubernetes";
  const c = scoreChange(master, tailored, FIFTEEN);
  assert.ok(c);
  assert.equal(`${c.before.matched}/${c.before.total}`, "7/15");
  assert.equal(`${c.after.matched}/${c.after.total}`, "9/15");
  assert.deepEqual(c.lost, ["Backend"]);
  const score = reconcileAtsScore({ misses: ["Backend — the summary says back-end services, not Backend"] }, c.after, null);
  const { missing, leftOut } = splitMisses(score.misses, c);
  assert.deepEqual(leftOut, ["Backend"]);
  assert.equal(missing.length + leftOut.length, score.misses.length);
  const listedByFreeCheck = new Set(c.before.missedKeywords);
  for (const line of missing) {
    const term = c.after.missedKeywords.find((t) => line.startsWith(t));
    assert.ok(term && listedByFreeCheck.has(term), `"${line}" was not in the free check's list`);
  }
  assert.equal(scoreCardCopy(score.band, score.verdict, c, false).headline, "Improved from 7/15 to 9/15.");
});

test("splitMisses: a term that opens another is not confused with it, and no read means no split", () => {
  const terms = ["Java", "JavaScript", "Go"];
  const c = scoreChange("Java and JavaScript", "Go", terms);
  assert.ok(c);
  assert.deepEqual(c.lost, ["Java", "JavaScript"]);
  const c2 = scoreChange("Java developer", "Kotlin", terms);
  assert.ok(c2);
  assert.deepEqual(c2.lost, ["Java"]);
  const lines = ["Java — not present in the tailored text", "JavaScript — not present in the tailored text", "Go — not present in the tailored text"];
  assert.deepEqual(splitMisses(lines, c2), { missing: [lines[1], lines[2]], leftOut: ["Java"] });
  assert.deepEqual(splitMisses(lines, null), { missing: lines, leftOut: [] });
});

test("the model's 'master CV' is shown as 'main CV' in the score's lines", () => {
  assert.equal(plainNames("Your master CV doesn't show CI/CD."), "Your main CV doesn't show CI/CD.");
  assert.equal(plainNames("Master CV lists Docker; a master's degree is not a master CV."), "Main CV lists Docker; a master's degree is not a main CV.");
  const c = read(7, 9);
  const score = reconcileAtsScore(
    { hits: ["Python — skills line, as on the master CV"], misses: ["Kubernetes — the master CV never names it"], edits: ["Move Docker from the master CV's projects into the skills line."] },
    c.after,
    null
  );
  assert.ok(![...score.hits, ...score.misses, ...score.recommendations].some((s) => /master CV/i.test(s)));
  assert.ok(score.recommendations[0].includes("main CV"));
});
