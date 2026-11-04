import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignWritten, capPoolBullets, cardDateLine, cardEnd, cardsToPoolText, dropToFit, hasDates, labelledCardName, normalizePoolCards, normalizePoolSettings,
  pinWarning, poolSummaryLine, readPoolDate, resolveCount, selectCards, type PoolCard, type PoolContext,
} from "../src/lib/projectPool.ts";
import { parsePoolText } from "../src/lib/poolParse.ts";
import { normalizePreferences } from "../src/lib/preferences.ts";
import { buildCvPdf } from "../src/lib/buildCvPdf.ts";
import { extractPdfText } from "../src/lib/pdfTextCheck.ts";

const TODAY = new Date("2026-11-04T12:00:00Z");
const card = (id: string, over: Partial<PoolCard> = {}): PoolCard => ({ id, name: id, start: "", end: "", ongoing: false, tech: [], body: "", label: "", links: [], pinned: false, ...over });
const ctx = (over: Partial<PoolContext> = {}): PoolContext => ({ keywords: [], required: [], pageTarget: 2, roles: 3, today: TODAY, ...over });
const names = (s: { chosen: { card: PoolCard }[] }) => s.chosen.map((c) => c.card.name);

test("settings: anything unknown reads as the defaults", () => {
  assert.deepEqual(normalizePoolSettings(null), { count: "auto", order: "relevance" });
  assert.deepEqual(normalizePoolSettings({ count: 9, order: "x" }), { count: "auto", order: "relevance" });
  assert.deepEqual(normalizePoolSettings({ count: 3, order: "date" }), { count: 3, order: "date" });
});

test("Auto: two on one page, three with 0 or 1 jobs, three on two pages, never more than the pool", () => {
  const auto = normalizePoolSettings({});
  assert.equal(resolveCount(auto, { pageTarget: 1, roles: 3 }, 9), 2);
  assert.equal(resolveCount(auto, { pageTarget: 1, roles: 1 }, 9), 3);
  assert.equal(resolveCount(auto, { pageTarget: 1, roles: 0 }, 9), 3);
  assert.equal(resolveCount(auto, { pageTarget: 2, roles: 3 }, 9), 3);
  assert.equal(resolveCount(auto, { pageTarget: 2, roles: 3 }, 2), 2);
  assert.equal(resolveCount({ count: 4, order: "date" }, { pageTarget: 1, roles: 3 }, 3), 3);
  assert.equal(resolveCount({ count: 1, order: "date" }, { pageTarget: 2, roles: 3 }, 3), 1);
});

test("a date reads on one scale; a bare year reads as its last month; nonsense reads as nothing", () => {
  assert.equal(readPoolDate("Jan 2025"), 2025 * 12);
  assert.equal(readPoolDate("January 2025"), 2025 * 12);
  assert.equal(readPoolDate("01/2025"), 2025 * 12);
  assert.equal(readPoolDate("2025-03"), 2025 * 12 + 2);
  assert.equal(readPoolDate("2025"), 2025 * 12 + 11);
  for (const bad of ["", "soon", "13/2025", "Foo 2025"]) assert.equal(readPoolDate(bad), null, bad);
});

test("Ongoing counts as today, and one date reads by that date", () => {
  assert.equal(cardEnd(card("a", { ongoing: true, start: "Jan 2020" }), TODAY), 2026 * 12 + 10);
  assert.equal(cardEnd(card("a", { start: "Mar 2024" }), TODAY), 2024 * 12 + 2);
  assert.equal(cardEnd(card("a"), TODAY), null);
  assert.equal(hasDates(card("a")), false);
  assert.equal(hasDates(card("a", { ongoing: true })), true);
});

test("dates print exactly as written: a year is never given a month", () => {
  assert.equal(cardDateLine(card("a", { start: "2024", end: "2025" })), "2024 – 2025");
  assert.equal(cardDateLine(card("a", { start: "Jan 2025", ongoing: true })), "Jan 2025 – Present");
  assert.equal(cardDateLine(card("a", { end: "2025" })), "2025");
  assert.equal(cardDateLine(card("a")), "");
});

test("count 3, newest first: exactly 3, latest end date first, Ongoing as today, undated last", () => {
  const cards = [
    card("old", { end: "2021" }),
    card("undated"),
    card("mid", { end: "Jun 2025" }),
    card("now", { start: "Jan 2024", ongoing: true }),
    card("recent", { end: "Sep 2026" }),
  ];
  const s = selectCards(cards, { count: 3, order: "date" }, ctx());
  assert.deepEqual(names(s), ["now", "recent", "mid"]);
  assert.deepEqual(names(selectCards(cards, { count: 4, order: "date" }, ctx())), ["now", "recent", "mid", "old"]);
  const all = selectCards([card("undated"), card("dated", { end: "2020" })], { count: 2, order: "date" }, ctx());
  assert.deepEqual(names(all), ["dated", "undated"], "a card with no dates is last");
});

test("most relevant first: the posting's match, with end date as the tie-break", () => {
  const cards = [
    card("none", { end: "2026" }),
    card("tie-old", { tech: ["Python"], end: "2020" }),
    card("tie-new", { tech: ["Python"], end: "2025" }),
    card("best", { tech: ["Python", "AWS"], end: "2019" }),
  ];
  const s = selectCards(cards, { count: 3, order: "relevance" }, ctx({ keywords: ["Python", "AWS"] }));
  assert.deepEqual(names(s), ["best", "tie-new", "tie-old"]);
  assert.deepEqual(s.chosen[0].matches, ["Python", "AWS"]);
});

test("a required skill counts for more than a keyword", () => {
  const cards = [card("keyword", { tech: ["Docker", "Redis"] }), card("required", { tech: ["Python"] })];
  const s = selectCards(cards, { count: 1, order: "relevance" }, ctx({ keywords: ["Docker", "Redis", "Go"], required: ["Python", "Kubernetes"] }));
  assert.equal(s.chosen[0].card.name, "keyword", "two keywords tie a required skill's weight; a tie goes by date, then their order");
  const more = selectCards(cards, { count: 1, order: "relevance" }, ctx({ keywords: ["Docker"], required: ["Python"] }));
  assert.equal(more.chosen[0].card.name, "required");
});

test("a pinned project is always included and comes first, under either order", () => {
  const cards = [card("a", { end: "2026", tech: ["Python"] }), card("pinned", { end: "2010", pinned: true }), card("c", { end: "2025" })];
  for (const order of ["relevance", "date"] as const) {
    const s = selectCards(cards, { count: 2, order }, ctx({ keywords: ["Python"] }));
    assert.equal(s.chosen[0].card.name, "pinned", order);
    assert.equal(s.chosen.length, 2, "a pin counts towards the number");
    assert.equal(s.chosen[1].card.name, "a", order);
    assert.equal(s.pinWarning, null);
  }
});

test("pins past the number all stay, and the warning says so", () => {
  const cards = [card("a", { pinned: true }), card("b", { pinned: true }), card("c", { pinned: true }), card("d")];
  const s = selectCards(cards, { count: 2, order: "relevance" }, ctx());
  assert.equal(s.chosen.length, 3);
  assert.equal(s.pinWarning, "You pinned 3 but chose 2.");
  assert.equal(pinWarning(cards, { count: "auto", order: "date" }, 2), "You pinned 3 but Auto chose 2.");
  assert.equal(pinWarning(cards, { count: 3, order: "date" }, 3), null);
});

test("the line on the tailor page", () => {
  assert.equal(poolSummaryLine({ count: "auto", order: "relevance" }, 2), "Auto (2) · Most relevant");
  assert.equal(poolSummaryLine({ count: 3, order: "date" }, 3), "3 · Newest first");
});

test("the label is verbatim and once; the tailoring step cannot drop or reword it", () => {
  const label = "Personal portfolio project modelled on a real-world brief";
  const ridex = card("x", { id: "x", name: "RideX — Full-Stack Ride-Hailing Platform", label, start: "2025", end: "2026", tech: ["React"], body: "- Built the booking flow" });
  assert.equal(labelledCardName(ridex), `RideX — Full-Stack Ride-Hailing Platform (${label})`);
  assert.equal(labelledCardName({ name: `RideX (${label})`, label }), `RideX (${label})`);
  const chosen = [{ card: ridex, matches: [], score: 0 }];
  const reworded = alignWritten(chosen, [{ name: "RideX", date: "2019", tech: "Rust", bullets: ["Wrote the matching engine"] }]);
  assert.equal(reworded[0].name, labelledCardName(ridex), "the card's name, whatever came back");
  assert.equal(reworded[0].date, "2025 – 2026", "the card's dates");
  assert.equal(reworded[0].tech, "React", "the card's tech");
  assert.deepEqual(reworded[0].bullets, ["Wrote the matching engine"], "the model's bullets");
});

test("a RideX card with a label prints a CV heading holding the label verbatim", async () => {
  const label = "Personal portfolio project modelled on a real-world brief";
  const ridex = card("x", { name: "RideX — Full-Stack Ride-Hailing Platform", label, start: "2025", end: "2026", tech: ["React"] });
  const [written] = alignWritten([{ card: ridex, matches: [], score: 0 }], [{ name: "RideX", date: "", tech: "", bullets: ["Built the booking flow"] }]);
  const bytes = buildCvPdf({
    summary: "Software engineer.",
    skills: "Technical Tools: React",
    experience: "Software Engineer | Acme | Jan 2024 – Present\n• Built it",
    projects: { "0": written.bullets },
    projectsMeta: [{ name: `${written.name} | ${written.date}`, tech: written.tech, links: [], originalBullets: [] }],
    profile: { name: "Alex Tester", email: "alex@example.com", education: [], certifications: [], rightToWork: [], projects: [] },
    targetPages: 2,
  });
  const text = (await extractPdfText(bytes)).replace(/\s+/g, " ");
  assert.ok(text.includes(label), text.slice(0, 300));
  assert.match(text, /RideX — Full-Stack Ride-Hailing Platform/);
});

test("a project the model left out keeps the card's own words, in the chosen order", () => {
  const a = card("a", { name: "Alpha", body: "- First thing\n- Second thing\n\n- Third\n- Fourth" });
  const b = card("b", { name: "Beta" });
  const out = alignWritten([{ card: a, matches: [], score: 0 }, { card: b, matches: [], score: 0 }], [{ name: "Beta", date: "", tech: "", bullets: ["Did B"] }]);
  assert.deepEqual(out.map((p) => p.name), ["Alpha", "Beta"]);
  assert.deepEqual(out[0].bullets, ["First thing", "Second thing", "Third"]);
  assert.deepEqual(out[1].bullets, ["Did B"]);
});

test("a tight page: the top project keeps three bullets, the others two", () => {
  const bullets = ["1", "2", "3", "4"];
  const capped = capPoolBullets([{ name: "a", bullets }, { name: "b", bullets }, { name: "c", bullets: ["1"] }]);
  assert.deepEqual(capped.map((p) => p.bullets.length), [3, 2, 1]);
});

test("when it still runs over: the last unpinned project goes, and the message says so", () => {
  const ps = [{ name: "a" }, { name: "b" }, { name: "c" }];
  const fitsAt = (n: number) => (kept: unknown[]) => kept.length <= n;
  const two = dropToFit(ps, fitsAt(2), () => false);
  assert.deepEqual(two.projects.map((p) => p.name), ["a", "b"]);
  assert.deepEqual(two.dropped, ["c"]);
  assert.equal(two.message, "3 projects don't fit on 1 page; showing 2. Switch to 2 pages or pick 2.");
  const fits = dropToFit(ps, () => true, () => false);
  assert.equal(fits.message, null, "nothing silent, and nothing to say when it fits");
  assert.equal(fits.projects.length, 3);
  const pinned = dropToFit(ps, fitsAt(1), (p) => p.name === "c");
  assert.deepEqual(pinned.projects.map((p) => p.name), ["c"], "a pinned project is never the one to go");
  const allPinned = dropToFit(ps, fitsAt(1), () => true);
  assert.equal(allPinned.projects.length, 3);
  assert.equal(allPinned.message, null);
});

test("cards re-bound on read, and preferences keep them", () => {
  const out = normalizePoolCards([{ name: "A | B", tech: ["x", 5, ""], pinned: "yes", id: "a" }, { name: "" }, null, { name: "C", id: "a" }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "A – B", "the renderers split name and date on a pipe");
  assert.deepEqual(out[0].tech, ["x"]);
  assert.equal(out[0].pinned, false);
  assert.notEqual(out[1].id, "a", "ids stay unique");
  assert.deepEqual(normalizePoolCards("nope"), []);
  const prefs = normalizePreferences({ projectCards: [{ name: "Kept", id: "k" }], projectPoolSettings: { count: 2, order: "date" } });
  assert.equal(prefs.projectCards[0].name, "Kept");
  assert.deepEqual(prefs.projectPoolSettings, { count: 2, order: "date" });
  assert.deepEqual(normalizePreferences({}).projectCards, []);
});

const POOL = `Hailo — Full-Stack Ride-Hailing Platform | 2025
Personal portfolio project modelled on a real-world brief | Tech: React 19, Node.js, PostgreSQL
Live: https://hailo.example.com | GitHub: https://github.com/alex/hailo
- Built the booking flow with live driver tracking
- Added payments, with 100 requests per 15 minutes rate limiting

Parcel Tracker | Jan 2024 – Present
Tech: Python, FastAPI, AWS
- Tracks parcels across three carriers
  across all regions

Notes App (university coursework project)
2023
Wrote a small notes app in Java.

Old Thing
React, Node.js, MongoDB
Did some work on it`;

test("the free text reads into cards, with nothing lost", () => {
  const { cards, leftover } = parsePoolText(POOL);
  assert.deepEqual(cards.map((c) => c.name), ["Hailo — Full-Stack Ride-Hailing Platform", "Parcel Tracker", "Notes App", "Old Thing"]);
  assert.deepEqual(leftover, []);
  const [hailo, parcel, notes, old] = cards;
  assert.equal(hailo.end, "2025");
  assert.equal(hailo.label, "Personal portfolio project modelled on a real-world brief");
  assert.deepEqual(hailo.tech, ["React 19", "Node.js", "PostgreSQL"]);
  assert.equal(hailo.links.length, 1);
  assert.match(hailo.body, /booking flow/);
  assert.match(hailo.body, /100 requests per 15 minutes/);
  assert.equal(parcel.start, "Jan 2024");
  assert.equal(parcel.ongoing, true);
  assert.match(parcel.body, /across all regions/);
  assert.equal(notes.label, "university coursework project");
  assert.equal(notes.end, "2023");
  assert.match(notes.body, /notes app in Java/);
  assert.deepEqual(old.tech, ["React", "Node.js", "MongoDB"]);
  assert.equal(hasDates(old), false);
});

test("every word of the pool survives the round trip through cards", () => {
  const out = cardsToPoolText(parsePoolText(POOL).cards);
  for (const word of POOL.split(/[\s|,()]+/).filter((w) => w.length > 3)) {
    assert.ok(out.includes(word), `lost: ${word}`);
  }
  const again = parsePoolText(out).cards;
  assert.deepEqual(again.map((c) => c.name), ["Hailo — Full-Stack Ride-Hailing Platform", "Parcel Tracker", "Notes App", "Old Thing"], "and it reads back the same");
});

test("the shapes real pools are written in", () => {
  const { cards } = parsePoolText(`Tool One — Full-Stack App                                        2026
Tech Stack: Next.js 15, Supabase (Postgres, Auth, RLS), Vercel | GitHub |   Live: example.app
•\tBuilt it solo.

Tool Two — A Delivery Platform (GitHub)                                  2026
React 19, TypeScript, AWS Lambda, Terraform
Live: Tool Two
•\tBuilt the pipeline.

Tool Three
2025
Natural-language analysis of filings — without made-up numbers
Python, Claude API, pandas
Makes filings queryable.

The ETL pipeline parses filings.`);
  assert.deepEqual(cards.map((c) => c.name), ["Tool One — Full-Stack App", "Tool Two — A Delivery Platform", "Tool Three"]);
  assert.deepEqual(cards[0].tech, ["Next.js 15", "Supabase (Postgres, Auth, RLS)", "Vercel"], "brackets hold together, links are not tech");
  assert.deepEqual(cards[0].links, ["GitHub | Live: example.app"]);
  assert.equal(cards[0].end, "2026");
  assert.equal(cards[1].name.includes("GitHub"), false, "the link's word leaves the name");
  assert.deepEqual(cards[1].tech, ["React 19", "TypeScript", "AWS Lambda", "Terraform"]);
  assert.deepEqual(cards[1].links, ["Live: Tool Two"]);
  assert.equal(cards[2].end, "2025");
  assert.deepEqual(cards[2].tech, ["Python", "Claude API", "pandas"], "a tool list under a subtitle");
  assert.match(cards[2].body, /Natural-language analysis/);
  assert.match(cards[2].body, /ETL pipeline/);
});

test("tools with dots and sentences about links stay where the user wrote them", () => {
  const { cards } = parsePoolText(`Dispatch App | 2025
Tech: Socket.io, GitHub Actions, Fly.io
Live tracking of drivers on a map
Used Socket.io for dispatch with 3 retries
Live: dispatch.example.com`);
  assert.deepEqual(cards[0].tech, ["Socket.io", "GitHub Actions", "Fly.io"]);
  assert.match(cards[0].body, /Live tracking of drivers/);
  assert.match(cards[0].body, /Used Socket\.io/);
  assert.deepEqual(cards[0].links, ["Live: dispatch.example.com"]);
});

test("a body line after a blank line is not a project, and no text goes missing", () => {
  const { cards } = parsePoolText(`Hailo (Personal portfolio project on a brief)
Personal group project for a module

Wrote the driver matching service
Jobhuntz
Tech: Next.js, TypeScript, Supabase`);
  assert.equal(cards[0].name, "Hailo");
  assert.equal(cards[0].label, "Personal portfolio project on a brief");
  assert.match(cards[0].body, /Personal group project for a module/, "a second label line stays as text");
  assert.match(cards[0].body, /Wrote the driver matching service/);
  assert.ok(!cards.some((c) => c.name.startsWith("Wrote")), "a sentence is not a project");
});

test("a sentence with commas is not a tool list", () => {
  const { cards } = parsePoolText(`Shop | 2024
Built auth, payments, and search for the store`);
  assert.deepEqual(cards[0].tech, []);
  assert.match(cards[0].body, /Built auth/);
});

test("lines before the first project are kept for the review screen, and empty text is no cards", () => {
  const { cards, leftover } = parsePoolText("these are my projects:\n\nAlpha | 2025\n- Did it");
  assert.equal(cards.length, 1);
  assert.deepEqual(leftover, ["these are my projects:"]);
  assert.deepEqual(parsePoolText("").cards, []);
});
