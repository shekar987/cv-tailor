import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildFreeQuestions,
  checkStar,
  extractRequirements,
  parseBulletsFromText,
  extractProjectNames,
  type FreeBullet,
} from "../src/lib/freePractice.ts";

// ── Fictional test data ───────────────────────────────────────────────────────

const FICTIONAL_JD = `
Software Engineer — TechCorp (London)

We are looking for a Software Engineer to join our platform team.

Requirements:
- Experience with React and TypeScript for building user interfaces
- Knowledge of Node.js and RESTful API design
- Familiarity with AWS (EC2, S3, Lambda)
- Background in writing automated tests (Jest, Playwright)
- Experience building CI/CD pipelines (GitHub Actions, Jenkins)

Nice to have:
- Docker and Kubernetes knowledge
- GraphQL experience

What we offer:
- Competitive salary
- Remote-first culture
`.trim();

const FICTIONAL_EXPERIENCE_TEXT = `
Software Engineer | Acme Digital | Jan 2024 – Present
• Built a React dashboard for real-time analytics, reducing page load time by 35%
• Designed and implemented RESTful APIs in Node.js serving 50 k requests per day
• Set up CI/CD pipelines using GitHub Actions, cutting release time from 4 h to 20 min

Junior Developer | StartupXYZ | Jul 2022 – Dec 2023
• Developed automated test suites with Jest, achieving 90% code coverage
• Migrated legacy services to AWS Lambda, saving £8 k per month in compute costs
• Collaborated with the design team to implement accessible React components
`.trim();

const FICTIONAL_PROJECTS_TEXT = `
Ridex App (React, Node.js, 2023)
• Full-stack ridesharing prototype with real-time location tracking
• Integrated Google Maps API and Socket.io for live driver updates

DataViz (D3.js, Python, 2022)
• Interactive data visualisation tool for UK election results
• Processed 500 MB of CSV data with a custom ETL pipeline
`.trim();

const FICTIONAL_BULLETS: FreeBullet[] = parseBulletsFromText(FICTIONAL_EXPERIENCE_TEXT);
const FICTIONAL_PROJECT_NAMES: string[] = extractProjectNames(FICTIONAL_PROJECTS_TEXT);
const FICTIONAL_REQUIREMENTS: string[] = extractRequirements(FICTIONAL_JD);

// ── Helper ────────────────────────────────────────────────────────────────────

function buildQuestions() {
  return buildFreeQuestions({
    requirements: FICTIONAL_REQUIREMENTS,
    bullets: FICTIONAL_BULLETS,
    projectNames: FICTIONAL_PROJECT_NAMES,
    company: "TechCorp",
  });
}

// ── Source check: no AI import ────────────────────────────────────────────────

describe("freePractice.ts source", () => {
  it("does not import callClaude or lib/claude", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/lib/freePractice.ts", import.meta.url)),
      "utf-8"
    );
    // Check that no line actually imports from claude (allow comments)
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      assert.ok(!/claude/i.test(line), `freePractice.ts has an AI import: ${line.trim()}`);
      assert.ok(!/@anthropic-ai/.test(line), `freePractice.ts imports Anthropic SDK: ${line.trim()}`);
    }
    // No callClaude anywhere in code (even non-import usage)
    const codeLines = src.split("\n").filter((l) => !/^\s*\/\//.test(l));
    assert.ok(!codeLines.join("\n").includes("callClaude"), "freePractice.ts must not call callClaude");
  });
});

// ── extractRequirements ───────────────────────────────────────────────────────

describe("extractRequirements", () => {
  it("returns at least 3 requirements from the fictional JD", () => {
    assert.ok(FICTIONAL_REQUIREMENTS.length >= 3, `expected ≥ 3, got ${FICTIONAL_REQUIREMENTS.length}`);
  });

  it("includes React or TypeScript in the extracted requirements", () => {
    const hasReact = FICTIONAL_REQUIREMENTS.some((r) =>
      /react|typescript/i.test(r)
    );
    assert.ok(hasReact, `requirements do not mention React/TypeScript: ${JSON.stringify(FICTIONAL_REQUIREMENTS)}`);
  });

  it("returns at most 10 requirements", () => {
    assert.ok(FICTIONAL_REQUIREMENTS.length <= 10);
  });

  it("returns an empty array for a JD with no bullets", () => {
    assert.deepEqual(extractRequirements("No bullets here, just prose."), []);
  });
});

// ── parseBulletsFromText ──────────────────────────────────────────────────────

describe("parseBulletsFromText", () => {
  it("parses 6 bullets from the fictional experience text", () => {
    assert.strictEqual(FICTIONAL_BULLETS.length, 6, `expected 6 bullets, got ${FICTIONAL_BULLETS.length}`);
  });

  it("assigns IDs in R<role>.<bullet> format", () => {
    for (const b of FICTIONAL_BULLETS) {
      assert.match(b.id, /^R\d+\.\d+$/, `invalid id: ${b.id}`);
    }
  });

  it("all bullet IDs are unique", () => {
    const ids = FICTIONAL_BULLETS.map((b) => b.id);
    assert.strictEqual(new Set(ids).size, ids.length, "duplicate bullet IDs found");
  });
});

// ── extractProjectNames ───────────────────────────────────────────────────────

describe("extractProjectNames", () => {
  it("extracts at least 2 project names from the fictional projects text", () => {
    assert.ok(FICTIONAL_PROJECT_NAMES.length >= 2);
  });

  it("includes 'Ridex App' and 'DataViz'", () => {
    assert.ok(FICTIONAL_PROJECT_NAMES.some((n) => /ridex/i.test(n)));
    assert.ok(FICTIONAL_PROJECT_NAMES.some((n) => /dataviz/i.test(n)));
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(extractProjectNames(""), []);
  });
});

// ── buildFreeQuestions ────────────────────────────────────────────────────────

describe("buildFreeQuestions", () => {
  it("returns exactly 5 questions", () => {
    const qs = buildQuestions();
    assert.strictEqual(qs.length, 5, `expected 5, got ${qs.length}`);
  });

  it("produces the same questions given the same input (determinism)", () => {
    const a = buildQuestions();
    const b = buildQuestions();
    for (let i = 0; i < a.length; i++) {
      assert.strictEqual(a[i].text, b[i].text, `question ${i + 1} differs between runs`);
      assert.strictEqual(a[i].suggestedStoryId, b[i].suggestedStoryId);
    }
  });

  it("every suggestedStoryId points to a real bullet in the input (no invented IDs)", () => {
    const validIds = new Set(FICTIONAL_BULLETS.map((b) => b.id));
    const qs = buildQuestions();
    for (const q of qs) {
      if (q.suggestedStoryId !== null) {
        assert.ok(
          validIds.has(q.suggestedStoryId),
          `invented story ID "${q.suggestedStoryId}" not in input bullets`
        );
      }
    }
  });

  it("every suggestedStory matches the bullet text for its ID", () => {
    const bulletMap = new Map(FICTIONAL_BULLETS.map((b) => [b.id, b.text]));
    const qs = buildQuestions();
    for (const q of qs) {
      if (q.suggestedStoryId !== null && q.suggestedStory !== null) {
        assert.strictEqual(
          q.suggestedStory,
          bulletMap.get(q.suggestedStoryId),
          `suggestedStory does not match bullet ${q.suggestedStoryId}`
        );
      }
    }
  });

  it("includes exactly one motivation / 'Why' question", () => {
    const qs = buildQuestions();
    const whyQs = qs.filter((q) => /why are you interested/i.test(q.text));
    assert.strictEqual(whyQs.length, 1, `expected 1 'Why' question, got ${whyQs.length}`);
  });

  it("includes exactly one project question mentioning a project name", () => {
    const qs = buildQuestions();
    const projQs = qs.filter((q) =>
      FICTIONAL_PROJECT_NAMES.some((name) => q.text.toLowerCase().includes(name.toLowerCase()))
    );
    assert.strictEqual(projQs.length, 1, `expected 1 project question, got ${projQs.length}`);
  });

  it("includes the company name in the motivation question", () => {
    const qs = buildQuestions();
    const whyQ = qs.find((q) => /why are you interested/i.test(q.text));
    assert.ok(whyQ, "no motivation question found");
    assert.ok(whyQ!.text.includes("TechCorp"), `motivation question missing company: ${whyQ!.text}`);
  });

  it("all question IDs are unique", () => {
    const qs = buildQuestions();
    const ids = qs.map((q) => q.id);
    assert.strictEqual(new Set(ids).size, ids.length, "duplicate question IDs");
  });

  it("no two question texts are identical", () => {
    const qs = buildQuestions();
    const texts = qs.map((q) => q.text);
    assert.strictEqual(new Set(texts).size, texts.length, "duplicate question texts");
  });

  it("works with no bullets (all suggestedStoryId are null)", () => {
    const qs = buildFreeQuestions({
      requirements: FICTIONAL_REQUIREMENTS,
      bullets: [],
      projectNames: FICTIONAL_PROJECT_NAMES,
      company: "TechCorp",
    });
    assert.strictEqual(qs.length, 5);
    for (const q of qs) {
      if (!FICTIONAL_PROJECT_NAMES.some((n) => q.text.includes(n)) && !/why are you/i.test(q.text)) {
        assert.strictEqual(q.suggestedStoryId, null);
      }
    }
  });

  it("works with no requirements (uses generic questions)", () => {
    const qs = buildFreeQuestions({
      requirements: [],
      bullets: FICTIONAL_BULLETS,
      projectNames: FICTIONAL_PROJECT_NAMES,
      company: "TechCorp",
    });
    assert.strictEqual(qs.length, 5);
  });
});

// ── checkStar ─────────────────────────────────────────────────────────────────

describe("checkStar", () => {
  it("empty string → all parts missing, parts = 0", () => {
    const s = checkStar("");
    assert.strictEqual(s.parts, 0);
    assert.strictEqual(s.check.situation, false);
    assert.strictEqual(s.check.task, false);
    assert.strictEqual(s.check.action, false);
    assert.strictEqual(s.check.result, false);
    assert.strictEqual(s.check.resultHasNumber, false);
    assert.strictEqual(s.missing.length, 4);
  });

  it("vague answer → no STAR parts detected", () => {
    const s = checkStar("I did something important and it went pretty well.");
    assert.strictEqual(s.parts, 0, `unexpectedly detected parts: ${JSON.stringify(s.check)}`);
  });

  it("full STAR answer → all 4 parts present", () => {
    const answer =
      "I was working at Acme as a backend engineer on their payments API. " +
      "My goal was to reduce transaction failures caused by timeout errors. " +
      "I implemented a retry mechanism with exponential backoff using Node.js. " +
      "As a result, we reduced transaction failures by 40% within two weeks.";
    const s = checkStar(answer);
    assert.strictEqual(s.check.situation, true, "Situation not detected");
    assert.strictEqual(s.check.task, true, "Task not detected");
    assert.strictEqual(s.check.action, true, "Action not detected");
    assert.strictEqual(s.check.result, true, "Result not detected");
    assert.strictEqual(s.parts, 4);
  });

  it("flags a number in the result when present", () => {
    const answer =
      "I was working at a startup. The challenge was to speed up deployments. " +
      "I built a CI/CD pipeline. As a result, releases went from 4 hours to 20 minutes.";
    const s = checkStar(answer);
    assert.strictEqual(s.check.result, true, "Result not detected");
    assert.strictEqual(s.check.resultHasNumber, true, "Number in result not flagged");
  });

  it("does not flag a number when result is missing", () => {
    const answer = "I was working at Acme. I had to fix a bug. I implemented a patch.";
    const s = checkStar(answer);
    assert.strictEqual(s.check.result, false, "Result should not be detected");
    assert.strictEqual(s.check.resultHasNumber, false, "resultHasNumber must be false without result");
  });

  it("result present but no number → resultHasNumber false", () => {
    const answer =
      "I was working on a backend service. The goal was to reduce load. " +
      "I redesigned the caching layer. In the end, the system performed much better.";
    const s = checkStar(answer);
    assert.strictEqual(s.check.result, true, "Result not detected");
    assert.strictEqual(s.check.resultHasNumber, false, "No number, but resultHasNumber is true");
  });

  it("label is always 'structure only, not content'", () => {
    assert.strictEqual(checkStar("").label, "structure only, not content");
    assert.strictEqual(checkStar("I built a thing.").label, "structure only, not content");
    assert.strictEqual(checkStar("I was working at Acme. I had to fix a bug. I implemented a patch. As a result we saved 50%.").label, "structure only, not content");
  });

  it("missing[] lists the absent parts by name", () => {
    const answer =
      "I was working at Acme. " +
      "I implemented a new service.";
    const s = checkStar(answer);
    assert.ok(s.missing.includes("Task") || s.missing.includes("Result"),
      `expected Task or Result missing, got: ${JSON.stringify(s.missing)}`);
  });

  it("parts count matches number of true values in check (excluding resultHasNumber)", () => {
    const answer =
      "I was working at a large company. I needed to redesign the auth layer. " +
      "I implemented OAuth 2.0. As a result, login time dropped by 60%.";
    const s = checkStar(answer);
    const manual = [s.check.situation, s.check.task, s.check.action, s.check.result].filter(Boolean).length;
    assert.strictEqual(s.parts, manual, "parts count does not match check fields");
  });
});
