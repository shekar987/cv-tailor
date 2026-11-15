// Chunk 29 (15 Nov 2026): a first-run path a new jobseeker can follow.
// The card's state in each case, the details confirmation, the Schedule page's
// "Get started" title, and the sign-up line (no "API key" before sign-in).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { firstRunStep, firstRunTitle, readConfirmedAt, stepState, type FirstRunFacts } from "../src/lib/firstRun.ts";
import { normalizeProfile } from "../src/lib/profile.ts";
import { SIGN_IN_INTRO, SIGN_UP_INTRO } from "../src/lib/authCopy.ts";
import FirstRunGuide, { RTW_QUESTION_HREF } from "../src/components/FirstRunGuide.tsx";

const facts = (f: Partial<FirstRunFacts>): FirstRunFacts => ({ hasCv: false, detailsConfirmed: false, rtwStatus: "unknown", applicationCount: 0, ...f });
const render = (f: FirstRunFacts, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(FirstRunGuide, { facts: f, ...extra }));
const stateOf = (html: string, step: string) => new RegExp(`data-step="${step}" data-state="(\\w+)"`).exec(html)?.[1];

test("no CV: step 1 is current with Upload your CV; step 2 can be answered already; the Tailor page is a link", () => {
  const f = facts({});
  assert.equal(firstRunStep(f), "cv");
  assert.deepEqual([stepState(f, "cv"), stepState(f, "rtw"), stepState(f, "job")], ["current", "next", "next"]);
  const html = render(f, { onChooseRtw: async () => true });
  assert.equal(stateOf(html, "cv"), "current");
  assert.match(html, /href="\/customize#master-cv"[^>]*data-first-run-cv|data-first-run-cv[^>]*href="\/customize#master-cv"/);
  // The question itself, on the card: no hunt between Eligibility and Right to work on the CV.
  assert.equal((html.match(/data-first-run-rtw="/g) ?? []).length, 3);
  // Step 3 names the Tailor page as a link, on every screen size.
  assert.match(html, /<a(?=[^>]*href="\/app")(?=[^>]*data-first-run-tailor-link)[^>]*>Tailor page<\/a>/);
  // Nothing to tailor from yet: no job button.
  assert.doesNotMatch(html, /data-first-run-job/);
});

test("no CV and no way to save here: step 2 links straight to the one question", () => {
  const html = render(facts({}));
  assert.equal(RTW_QUESTION_HREF, "/customize#eligibility-rtw");
  assert.match(html, /href="\/customize#eligibility-rtw"/);
  assert.doesNotMatch(html, /data-first-run-rtw="/);
});

test("CV saved but its details not confirmed: step 1 stays current and asks for the check", () => {
  const f = facts({ hasCv: true });
  assert.equal(firstRunStep(f), "cv");
  const html = render(f, { onChooseRtw: async () => true });
  assert.equal(stateOf(html, "cv"), "current");
  assert.match(html, /href="\/customize#your-details"[^>]*data-first-run-details|data-first-run-details[^>]*href="\/customize#your-details"/);
  assert.match(html, /your name, email, phone, location and education/);
  assert.equal(firstRunTitle(f), "Get started");
});

test("CV and details confirmed, no eligibility: step 1 ticks, step 2 is current with its three answers", () => {
  const f = facts({ hasCv: true, detailsConfirmed: true });
  assert.equal(firstRunStep(f), "rtw");
  assert.deepEqual([stepState(f, "cv"), stepState(f, "rtw"), stepState(f, "job")], ["done", "current", "next"]);
  const html = render(f, { onChooseRtw: async () => true });
  assert.equal(stateOf(html, "cv"), "done");
  assert.equal(stateOf(html, "rtw"), "current");
  assert.equal((html.match(/data-first-run-rtw="/g) ?? []).length, 3);
  // The job is reachable, outlined: the answer is this step.
  assert.match(html, /data-first-run-job[^>]*>Skip to your first job|>Skip to your first job/);
  // Past step 1, Schedule is Schedule again.
  assert.equal(firstRunTitle(f), null);
});

test("both done: the card ticks steps 1 and 2 and the job is the one filled action", () => {
  const f = facts({ hasCv: true, detailsConfirmed: true, rtwStatus: "time_limited" });
  assert.equal(firstRunStep(f), "job");
  const html = render(f, { onChooseRtw: async () => true });
  assert.equal(stateOf(html, "cv"), "done");
  assert.equal(stateOf(html, "rtw"), "done");
  assert.equal(stateOf(html, "job"), "current");
  assert.match(html, /data-first-run-rtw-answer="time_limited"/);
  assert.match(html, /Answered: Time-limited visa/);
  assert.doesNotMatch(html, /data-first-run-rtw="/);
  assert.match(html, />Paste your first job</);
});

test("right to work answered before the CV ticks at once; step 1 is still the current one", () => {
  const f = facts({ rtwStatus: "full" });
  assert.equal(firstRunStep(f), "cv");
  assert.equal(stepState(f, "rtw"), "done");
  assert.equal(stateOf(render(f), "rtw"), "done");
});

test("the title is Get started only while step 1 is open, and only for a new account", () => {
  assert.equal(firstRunTitle(null), null);
  assert.equal(firstRunTitle(facts({})), "Get started");
  // An account with applications never sees the guide, so never this title.
  assert.equal(firstRunTitle(facts({ applicationCount: 3 })), null);
  assert.equal(firstRunTitle(facts({ hasCv: true, detailsConfirmed: true })), null);
});

test("a confirmation is a real time or nothing; a fresh profile carries none", () => {
  assert.equal(readConfirmedAt("2026-11-15T10:00:00.000Z"), "2026-11-15T10:00:00.000Z");
  for (const bad of [null, undefined, "", "yes", true, 1, "2026-11-15", "2026-13-45T99:00:00Z", "x".repeat(60)]) assert.equal(readConfirmedAt(bad), null);
  const kept = normalizeProfile({ name: "Alex Tester", detailsConfirmedAt: "2026-11-15T10:00:00.000Z" });
  assert.equal(kept.detailsConfirmedAt, "2026-11-15T10:00:00.000Z");
  assert.equal("detailsConfirmedAt" in normalizeProfile({ name: "Alex Tester" }), false);
  assert.equal("detailsConfirmedAt" in normalizeProfile({ name: "Alex Tester", detailsConfirmedAt: "true" }), false);
});

test("the extraction route never stores a confirmation, whatever the model writes", () => {
  const route = readFileSync(new URL("../src/app/api/extract-profile/route.ts", import.meta.url), "utf8");
  assert.match(route, /delete profile\.detailsConfirmedAt;/);
});

test("sign-up copy: the agreed line, and no API key before sign-in", () => {
  assert.equal(
    SIGN_UP_INTRO,
    "Free to start: 3 tailored CVs included. Need more? Connect a free AI account in about 2 minutes and keep going at no cost. We show you how."
  );
  assert.equal(SIGN_IN_INTRO, "Sign in to open your CV and your applications.");
  const login = readFileSync(new URL("../src/app/auth/login/page.tsx", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../src/app/(home)/page.tsx", import.meta.url), "utf8");
  for (const [name, text] of [["sign-up", SIGN_UP_INTRO], ["login page", login], ["landing", landing]] as const) {
    assert.doesNotMatch(text, /API key/i, `${name} says "API key"`);
  }
  assert.match(login, /SIGN_UP_INTRO/);
});
