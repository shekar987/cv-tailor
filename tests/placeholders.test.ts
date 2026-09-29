// Unit tests for the template-text detector (lib/placeholders) and the two
// honesty rules it backs (src/prompts/rules.ts 10 and 11). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeholderHits, hasPlaceholder } from "../src/lib/placeholders.ts";
import { ABSOLUTE_RULES } from "../src/prompts/rules.ts";

test("template text a model leaves for a missing figure is found", () => {
  const cases: [string, string[]][] = [
    ["Reduced page load time by X% by caching API responses.", ["X%"]],
    ["Cut costs by [X%] across [NUMBER] services.", ["[X%]", "[NUMBER]"]],
    ["Served <N> requests a day for {Company}.", ["<N>", "{Company}"]],
    ["Grew sign-ups to XX users in [TIMEFRAME].", ["to XX users", "[TIMEFRAME]"]],
    ["Saved £XK a year on hosting.", ["£XK"]],
    ["Improved throughput by X through batching.", ["by X"]],
    ["Delivered the migration (dates TBC).", ["TBC"]],
    ["Built the dashboard - add metric here.", ["add metric here"]],
    ["Dear [Hiring Manager], I am applying for the [Role Title] role.", ["[Hiring Manager]", "[Role Title]"]],
  ];
  for (const [text, want] of cases) assert.deepEqual(placeholderHits(text), want, text);
});

test("real CV prose is never read as a placeholder", () => {
  const clean = [
    "• Built REST services in Python and FastAPI, cutting response times by 25%",
    "Integrated the X (formerly Twitter) API to schedule 1,200 posts a day.",
    "Worked with X-ray imaging data in a university research project.",
    "Automated CI/CD with GitHub Actions; wrote C# and C++ services on .NET 8.",
    "Delivered 10x faster imports and saved £2.3m in licence costs.",
    "Completing an MSc Computer Science (expected Jan 2027).",
    "Next.js, Node.js, PostgreSQL, Supabase, Jest, Playwright",
    "Built the event-driven pipeline on AWS Lambda, SQS and SNS with 192 tests.",
  ];
  for (const text of clean) assert.deepEqual(placeholderHits(text), [], text);
  assert.equal(hasPlaceholder(""), false);
  assert.equal(hasPlaceholder(undefined), false);
});

test("a bullet id left in finished text is reported: every check runs after the ids are stripped", () => {
  assert.deepEqual(placeholderHits("• **[R1.1] Rebuilt the order service in Spring Boot.**"), ["[R1.1]"]);
});

test("each placeholder is reported once, in order", () => {
  assert.deepEqual(placeholderHits("by X% then by X% again, then [N]"), ["X%", "[N]"]);
});

test("the honesty rules keep all nine originals and add evidence level and no placeholders", () => {
  for (let n = 1; n <= 11; n++) assert.match(ABSOLUTE_RULES, new RegExp(`\\n${n}\\. `), `rule ${n}`);
  assert.match(ABSOLUTE_RULES, /1\. No invention\./);
  assert.match(ABSOLUTE_RULES, /NEVER graft JD terminology/);
  assert.match(ABSOLUTE_RULES, /contributing is not owning, participating is not leading/);
  assert.match(ABSOLUTE_RULES, /No placeholders, ever\./);
});
