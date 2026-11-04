// What the independent review of Chunk 14 found, held down: bullets on the right project,
// labels verbatim, nothing cut on reload, dates that cannot beat Ongoing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignWritten, cardEnd, byDate, dropToFit, hasDates, normalizePoolCards, poolCardsProblem, poolDropMessage, poolPinnedOverflowMessage, selectCards, type ChosenCard, type PoolCard } from "../src/lib/projectPool.ts";
import { projectsFromSelected } from "../src/lib/poolProjects.ts";
import { projectLabels, splitProjectLabel, withProjectLabels } from "../src/lib/projectLabels.ts";
import { isLearningTech } from "../src/lib/claims.ts";

const card = (over: Partial<PoolCard>): PoolCard => ({ id: over.name ?? "c", name: "Project", start: "", end: "", ongoing: false, tech: [], body: "", label: "", links: [], pinned: false, ...over });
const chosen = (...cards: PoolCard[]): ChosenCard[] => cards.map((c) => ({ card: c, matches: [], score: 0 }));
const today = new Date("2026-11-04T12:00:00Z");

test("two projects whose names share a core never share bullets (rule 7)", () => {
  const out = alignWritten(chosen(card({ id: "py", name: "Chat App – Python" }), card({ id: "go", name: "Chat App – Go" })), [
    { name: "Chat App – Python", date: "", tech: "", bullets: ["Built the Python thing"] },
    { name: "Chat App – Go", date: "", tech: "", bullets: ["Built the Go thing"] },
  ]);
  assert.deepEqual(out.map((p) => p.bullets), [["Built the Python thing"], ["Built the Go thing"]]);
  assert.deepEqual(out.map((p) => p.cardId), ["py", "go"]);
});

test("brackets that tell two projects apart are kept apart", () => {
  const out = alignWritten(chosen(card({ name: "Portfolio (React)" }), card({ name: "Portfolio (Vue)" })), [
    { name: "Portfolio (Vue)", date: "", tech: "", bullets: ["Vue work"] },
    { name: "Portfolio (React)", date: "", tech: "", bullets: ["React work"] },
  ]);
  assert.deepEqual(out.map((p) => p.bullets), [["React work"], ["Vue work"]]);
});

test("a shortened name from the model still finds its one card", () => {
  const out = alignWritten(chosen(card({ name: "Hailo — Ride-Hailing Platform" }), card({ name: "Budget Bot" })), [
    { name: "Hailo", date: "", tech: "", bullets: ["Hailo work"] },
    { name: "Budget Bot", date: "", tech: "", bullets: ["Budget work"] },
  ]);
  assert.deepEqual(out.map((p) => p.bullets), [["Hailo work"], ["Budget work"]]);
});

test("a card with no words keeps its place, so later bullets stay on their own project", () => {
  const out = alignWritten(chosen(card({ name: "Alpha" }), card({ name: "Bravo" }), card({ name: "Charlie" })), [
    { name: "Bravo", date: "", tech: "", bullets: ["Bravo work"] },
    { name: "Charlie", date: "", tech: "", bullets: ["Charlie work"] },
  ]);
  assert.deepEqual(out.map((p) => p.name), ["Alpha", "Bravo", "Charlie"]);
  const keyed = projectsFromSelected(out);
  assert.deepEqual(keyed["0"], []);
  assert.deepEqual(keyed["1"], ["Bravo work"]);
  assert.deepEqual(keyed["2"], ["Charlie work"]);
});

test("the model's empty answer for a card falls back to the card's own words", () => {
  const [p] = alignWritten(chosen(card({ name: "Alpha", body: "- Did the thing\n- Did another" })), [{ name: "Alpha", date: "", tech: "", bullets: [] }]);
  assert.deepEqual(p.bullets, ["Did the thing", "Did another"]);
});

test("a learning skill never prints on a card's tech line", () => {
  const registry = { skills: [{ name: "Kubernetes", level: "learning" as const, confirmed: true }, { name: "React", level: "production" as const, confirmed: true }], confirmedAt: null };
  assert.equal(isLearningTech("Kubernetes", registry as never), true);
  assert.equal(isLearningTech("React", registry as never), false);
  const [p] = alignWritten(chosen(card({ name: "Alpha", tech: ["React", "Kubernetes"] })), [], (t) => !isLearningTech(t, registry as never));
  assert.equal(p.tech, "React");
});

test("a card's label is never replaced by what the CV writes", () => {
  const labels = projectLabels("Projects\nRideX\nPersonal project for a module\n- Built it");
  const fromCard = { name: "RideX (Personal portfolio project modelled on a real-world brief) | 2025", labelFixed: true };
  assert.equal(withProjectLabels([fromCard], labels)[0].name, fromCard.name);
  const cleared = { name: "RideX | 2025", labelFixed: true };
  assert.equal(withProjectLabels([cleared], labels)[0].name, "RideX | 2025", "a label the user cleared stays cleared");
  assert.match(withProjectLabels([{ name: "RideX | 2025" }], labels)[0].name as string, /personal project for a module/, "the CV's label still applies off a card");
});

test("only a real label moves to its own line", () => {
  assert.deepEqual(splitProjectLabel("Pipeline (Python and Go)"), { head: "Pipeline (Python and Go)", label: "" });
  assert.equal(splitProjectLabel("Hailo (personal portfolio project)").label, "(personal portfolio project)");
  const long = "A Rather Long Platform Name For Tracking Ride-Hailing Requests (Capstone with Acme Ltd)";
  assert.equal(splitProjectLabel(long).label, "(Capstone with Acme Ltd)");
});

test("a save refuses what a reload would cut", () => {
  assert.equal(poolCardsProblem([card({ name: "Fine", body: "x".repeat(6000) })]), null);
  assert.match(poolCardsProblem([card({ name: "Long", body: "x".repeat(6001) })]) ?? "", /Long.*over the 6,000 limit/);
  assert.match(poolCardsProblem([card({ name: "Tags", tech: ["x".repeat(61)] })]) ?? "", /too long for a tech item/);
  assert.match(poolCardsProblem(Array.from({ length: 31 }, (_, i) => card({ id: String(i), name: `P${i}` }))) ?? "", /Remove 1/);
  assert.equal(normalizePoolCards([card({ name: "Fine", body: "x".repeat(6000) })])[0].body.length, 6000, "what passes stays whole");
});

test("a bare year this year does not beat Ongoing, and Present in End means ongoing", () => {
  const ongoing = card({ id: "o", name: "Ongoing", ongoing: true });
  const year = card({ id: "y", name: "Year", end: "2026" });
  assert.equal(cardEnd(year, today), cardEnd(ongoing, today), "nothing reads as later than today");
  const order = selectCards([year, ongoing], { count: 2, order: "date" }, { pageTarget: 2, roles: 2, today }).chosen.map((c) => c.card.id);
  assert.deepEqual(order, ["o", "y"]);
  assert.ok(byDate({ card: ongoing, matches: [], score: 0 }, { card: year, matches: [], score: 9 }, today) < 0);
  const typed = card({ name: "Typed", start: "Jan 2020", end: "Present" });
  assert.equal(cardEnd(typed, today), cardEnd(ongoing, today));
  assert.equal(hasDates(typed), true);
  const [stored] = normalizePoolCards([typed]);
  assert.equal(stored.ongoing, true);
  assert.equal(stored.end, "");
});

test("the fit's messages", () => {
  const list = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const fit = dropToFit(list, (kept) => kept.length <= 2, () => false);
  assert.equal(fit.message, "3 projects don't fit on 1 page; showing 2. Switch to 2 pages or pick 2.");
  assert.equal(fit.message, poolDropMessage(3, 2));
  assert.equal(dropToFit(list, () => false, () => true).dropped.length, 0, "a pin never goes");
  assert.match(poolPinnedOverflowMessage(3), /Your 3 pinned projects don't fit on 1 page/);
});
