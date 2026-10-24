import test from "node:test";
import assert from "node:assert/strict";
import { FORMAT_STYLES, styleFor, normalizeFormatStyle, isFormatStyleId, rowStyle, FORMAT_STYLE_LABELS, ROW_STYLE_LABELS, RENDER_OPTIONS, SKILLS_SHAPE, CAREERSET_TOOL_GROUPS, STYLE_RULES } from "../src/lib/formatStyles/index.ts";
import { UKJI } from "../src/lib/formatStyles/ukji.ts";
import { CAREERSET, CAREERSET_EQUIVALENCES, CAREERSET_BANNED_WORDS } from "../src/lib/formatStyles/careerset.ts";
import { MAX_SUMMARY_SENTENCES, MAX_SUMMARY_WORDS, MAX_TECHNICAL_TOOLS, MAX_COMPETENCIES } from "../src/lib/formatRules.ts";
import { TOOLS_LEAD_SLOTS } from "../src/lib/claims.ts";
import { HEADLINE_SEP } from "../src/lib/headline.ts";
import { MAX_BULLET_LINES } from "../src/lib/bulletShape.ts";
import { PROJECT_MIN_BULLETS } from "../src/lib/onePage.ts";
import { normalizePreferences, DEFAULT_PREFERENCES } from "../src/lib/preferences.ts";

test("normalizeFormatStyle: only the exact id is CareerSet, everything else is UKJI", () => {
  assert.equal(normalizeFormatStyle("careerset"), "careerset");
  assert.equal(normalizeFormatStyle("ukji"), "ukji");
  for (const v of ["CAREERSET", "CareerSet", "", null, undefined, 3, {}, "career"]) assert.equal(normalizeFormatStyle(v), "ukji", String(v));
  assert.equal(isFormatStyleId("careerset"), true);
  assert.equal(isFormatStyleId("unknown"), false);
});

test("rowStyle: a stored style, else not recorded — never read as UKJI", () => {
  assert.equal(rowStyle("ukji"), "ukji");
  assert.equal(rowStyle("careerset"), "careerset");
  assert.equal(rowStyle(undefined), "unknown");
  assert.equal(rowStyle(null), "unknown");
  assert.equal(rowStyle("x"), "unknown");
  assert.equal(ROW_STYLE_LABELS.unknown, "Not recorded");
  assert.deepEqual(FORMAT_STYLE_LABELS, { ukji: "UKJI", careerset: "CareerSet" });
});

test("preferences carry the style, defaulting to UKJI", () => {
  assert.equal(DEFAULT_PREFERENCES.formatStyle, "ukji");
  assert.equal(normalizePreferences({ formatStyle: "careerset" }).formatStyle, "careerset");
  assert.equal(normalizePreferences({ formatStyle: "nope" }).formatStyle, "ukji");
  assert.equal(normalizePreferences({}).formatStyle, "ukji");
});

test("the UKJI style is today's constants, by import", () => {
  assert.equal(UKJI.limits.summary.maxSentences, MAX_SUMMARY_SENTENCES);
  assert.equal(UKJI.limits.summary.maxWords, MAX_SUMMARY_WORDS);
  assert.equal(UKJI.limits.tools.max, MAX_TECHNICAL_TOOLS);
  assert.equal(UKJI.limits.tools.leadSlots, TOOLS_LEAD_SLOTS);
  assert.equal(UKJI.limits.competencies.max, MAX_COMPETENCIES);
  assert.equal(UKJI.limits.bullets.maxLines, MAX_BULLET_LINES);
  assert.equal(UKJI.limits.bullets.perProject.min, PROJECT_MIN_BULLETS);
  assert.equal(UKJI.limits.bullets.total, null);
  assert.equal(UKJI.limits.cv.maxWords, null);
  assert.deepEqual(UKJI.limits.letter, { minWords: 230, maxWords: 330 });
  assert.equal(UKJI.render.headlineSeparator, HEADLINE_SEP);
  assert.equal(UKJI.render.contactLinks, "addresses"); // since 24 Oct: printed, like CareerSet (lib/contactCheck)
  assert.equal(UKJI.render.contactSeparator, " · ");
  assert.equal(UKJI.render.bold, true);
  assert.equal(UKJI.render.highlightLine, true);
  assert.equal(UKJI.render.trailingFullStop, true);
  assert.equal(UKJI.skills.grouped, false);
  assert.deepEqual(UKJI.lint, { bannedWords: [], equivalences: {}, verbCap: null, letterBanned: [] });
  assert.equal(UKJI.summary.appendAvailability, false);
  assert.equal(UKJI.letter.points, 3);
  assert.equal(UKJI.letter.teamSuffix, "team");
  assert.equal(UKJI.prompts.projectsBullets, "");
  assert.equal(UKJI.prompts.summaryForm({ availabilityAppended: true }), UKJI.prompts.summaryForm({ availabilityAppended: false }), "UKJI never appends");
});

test("the CareerSet style: the owner's rules, every number as specified", () => {
  assert.deepEqual(CAREERSET.limits.summary, { maxSentences: 5, maxWords: 95 });
  assert.equal(CAREERSET.limits.competencies.max, 12);
  assert.deepEqual(CAREERSET.limits.tools, { max: 30, leadSlots: 8 });
  assert.deepEqual(CAREERSET.limits.bullets, { maxWords: 30, maxLines: 2, total: { min: 12, max: 20 }, perProject: { min: 2, max: 4 } });
  assert.equal(CAREERSET.limits.cv.maxWords, 900);
  assert.deepEqual(CAREERSET.limits.letter, { minWords: 300, maxWords: 420 });
  assert.deepEqual([...CAREERSET.skills.groups], ["Languages & Frameworks", "Databases", "AI & LLM", "Cloud & DevOps", "Testing", "Other"]);
  assert.equal(CAREERSET.skills.commaItems, true);
  assert.deepEqual([...CAREERSET_BANNED_WORDS], ["contributed", "supported", "assisted", "helped", "worked on", "work in", "responsible for", "successfully", "used"]);
  assert.equal(CAREERSET.lint.verbCap, 2);
  assert.deepEqual([...CAREERSET.lint.letterBanned], ["used", "assisted", "contribute", "contributed", "also", "kind of"]);
  assert.deepEqual(CAREERSET.render, { contactLinks: "addresses", contactSeparator: " | ", headlineSeparator: " | ", bold: false, highlightLine: false, trailingFullStop: false, measureRunHeader: true, headlineShape: "careerset" });
  assert.equal(UKJI.render.headlineShape, "ukji");
  assert.equal(CAREERSET.summary.appendAvailability, true);
  assert.equal(CAREERSET.letter.points, 4);
  assert.equal(CAREERSET.letter.teamSuffix, "Hiring Team");
  assert.equal(CAREERSET.letter.statementPlacement, "close_paragraph");
  assert.equal(CAREERSET.letter.renumberPoints, true);
  assert.equal(SKILLS_SHAPE.careerset.groups, CAREERSET_TOOL_GROUPS);
  assert.equal(RENDER_OPTIONS.careerset, CAREERSET.render);
});

test("CareerSet equivalences never claim more: no automatic swap for supported / assisted / contributed / helped / worked on / work in", () => {
  for (const w of ["supported", "assisted", "contributed", "helped", "worked on", "work in"]) assert.equal(CAREERSET_EQUIVALENCES[w], undefined, w);
  assert.deepEqual([...CAREERSET_EQUIVALENCES.used], ["applied", "implemented"]);
  assert.deepEqual([...CAREERSET_EQUIVALENCES.successfully], [""]);
  assert.deepEqual([...CAREERSET_EQUIVALENCES["responsible for"]], ["owned"]);
  for (const targets of Object.values(CAREERSET_EQUIVALENCES)) for (const t of targets) assert.ok(!(CAREERSET_BANNED_WORDS as readonly string[]).includes(t), `a swap never lands on a banned word: ${t}`);
});

test("CareerSet furniture matches its fixed lines and nothing else", () => {
  const [fixed, interest] = CAREERSET.letter.furniture;
  assert.ok(fixed.test("Having read the job description, these are the four areas where I can add value from the start:"));
  assert.ok(fixed.test("Having read the job description, these are the four areas where I can add value from the start"));
  assert.ok(!fixed.test("Having read the job description, I built a pipeline."));
  assert.ok(interest.test("I am particularly interested in this role because Enablis puts engineers with clients."));
  assert.ok(!interest.test("I am particularly interested in roles because of X."));
  assert.equal(CAREERSET.letter.fixedLine, "Having read the job description, these are the four areas where I can add value from the start:");
  assert.equal(CAREERSET.letter.thanksLine, "Thank you for considering my application.");
});

test("the server styles are the import-free rules plus the prompts", () => {
  assert.equal(UKJI.limits, STYLE_RULES.ukji.limits);
  assert.equal(UKJI.render, STYLE_RULES.ukji.render);
  assert.equal(UKJI.letter, STYLE_RULES.ukji.letter);
  assert.equal(CAREERSET.limits, STYLE_RULES.careerset.limits);
  assert.equal(CAREERSET.lint, STYLE_RULES.careerset.lint);
  assert.equal(CAREERSET.letter, STYLE_RULES.careerset.letter);
  assert.equal(STYLE_RULES.ukji.check, false);
  assert.equal(STYLE_RULES.careerset.check, true);
  assert.equal(typeof UKJI.prompts.coverLetter, "function");
});

test("the registry and styleFor", () => {
  assert.equal(styleFor("ukji"), UKJI);
  assert.equal(styleFor("careerset"), CAREERSET);
  assert.deepEqual(Object.keys(FORMAT_STYLES), ["ukji", "careerset"]);
  assert.equal(FORMAT_STYLES.ukji.id, "ukji");
  assert.equal(FORMAT_STYLES.careerset.id, "careerset");
});
