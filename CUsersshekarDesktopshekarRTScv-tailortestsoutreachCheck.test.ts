// Tests for lib/outreachCheck — fictional profile and rows only.
// Covers every scenario named in the JH-7 spec.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOutreach } from "../src/lib/outreachCheck.ts";

// A fictional master CV used throughout.
const MASTER_CV = `
Software Engineer | Acme Systems | Jan 2024 – Present
• Built a fraud-detection API serving 12,000 requests/day using Python and FastAPI
• Reduced deployment time by 35% by introducing a CI/CD pipeline with GitHub Actions
• Mentored two junior engineers and ran weekly code reviews

Software Engineer | BuildCo | Jun 2022 – Dec 2023
• Developed the customer-portal backend with Node.js and PostgreSQL
• Shipped an internal reporting dashboard used by 200 staff

Projects
PayTrack (personal portfolio project)
Tech Stack: Python, FastAPI, PostgreSQL, Redis
• Implemented OAuth 2.0 and JWT-based authentication

Education
BSc Computer Science | University of Example | 2019 – 2022
`.trim();

// ── 1. Unsupported number is flagged (warn, not block) ────────────────────────

describe("unsupported number", () => {
  it("warns when a number is not in the master CV", () => {
    const result = checkOutreach({
      text: "I built a fraud-detection prototype with 150 automated tests and it cut latency by 60%.",
      kind: "follow_up",
      masterText: MASTER_CV,
    });
    // 150 is NOT in master CV → warn
    // 60% is NOT in master CV → warn
    // 35% IS in master CV (deployment time) → no warn for that
    const codes = result.warns.map((w) => w.code);
    assert.ok(codes.includes("unsupported_number"), "150 automated tests should warn");
    const phrases = result.warns.map((w) => w.phrase);
    assert.ok(phrases.some((p) => p.includes("150")), "phrase should include '150'");
  });

  it("does not warn for a number present in the master CV", () => {
    const result = checkOutreach({
      text: "My deployment pipeline cut time by 35%.",
      kind: "follow_up",
      masterText: MASTER_CV,
    });
    const numberWarns = result.warns.filter((w) => w.code === "unsupported_number");
    assert.strictEqual(numberWarns.length, 0, "35% is in master CV, should not warn");
  });
});

// ── 2. Retired claim blocks ───────────────────────────────────────────────────

describe("retired claim", () => {
  it("blocks when a user retired phrase appears in the text", () => {
    const result = checkOutreach({
      text: "I wanted to follow up on my application. I previously worked on AssetGuard+ and would love to discuss my background.",
      kind: "follow_up",
      masterText: MASTER_CV,
      retiredClaims: [{ phrase: "AssetGuard+", replacement: null }],
    });
    assert.ok(!result.ok, "should not be ok");
    const blockCodes = result.blocks.map((b) => b.code);
    assert.ok(blockCodes.includes("retired_claim"), "should block on retired claim");
    const phrases = result.blocks.map((b) => b.phrase);
    assert.ok(phrases.some((p) => p.includes("AssetGuard+")), "phrase should include AssetGuard+");
  });

  it("blocks on a multi-word retired title", () => {
    const result = checkOutreach({
      text: "My background as a Research Assistant, AI and Full-Stack developer gives me broad skills.",
      kind: "cold_email",
      masterText: MASTER_CV,
      retiredClaims: [{ phrase: "Research Assistant, AI and Full-Stack", replacement: null }],
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "retired_claim"));
  });

  it("passes when no retired phrase is present", () => {
    const result = checkOutreach({
      text: "I wanted to follow up on my application for the Software Engineer role.",
      kind: "follow_up",
      masterText: MASTER_CV,
      retiredClaims: [{ phrase: "AssetGuard+", replacement: null }],
    });
    assert.ok(result.ok, "clean message should pass");
    assert.strictEqual(result.blocks.filter((b) => b.code === "retired_claim").length, 0);
  });
});

// ── 3. Availability claim blocks ──────────────────────────────────────────────

describe("availability claim", () => {
  it("blocks 'immediate full-time availability' in a follow-up", () => {
    const result = checkOutreach({
      text: "I am available immediately for full-time employment and very keen on this role.",
      kind: "follow_up",
      masterText: MASTER_CV,
    });
    assert.ok(!result.ok, "availability claim should block");
    assert.ok(result.blocks.some((b) => b.code === "availability_claim"));
  });

  it("blocks 'can start now' in a cold email", () => {
    const result = checkOutreach({
      text: "I can start now and have no notice period.",
      kind: "cold_email",
      masterText: MASTER_CV,
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "availability_claim"));
  });

  it("does not block a message with no availability claim", () => {
    const result = checkOutreach({
      text: "I wanted to follow up on my application from last week.",
      kind: "follow_up",
      masterText: MASTER_CV,
    });
    const availBlocks = result.blocks.filter((b) => b.code === "availability_claim");
    assert.strictEqual(availBlocks.length, 0);
  });
});

// ── 4. Closed / non-live row blocks a follow-up ───────────────────────────────

describe("closed row blocks a follow-up", () => {
  it("blocks when status is 'rejected'", () => {
    const result = checkOutreach({
      text: "Following up on my application.",
      kind: "follow_up",
      masterText: MASTER_CV,
      row: { status: "rejected" },
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "closed_row"), "should block on closed row");
    assert.ok(result.blocks.some((b) => /closed|waiting|confirmation/i.test(b.fix)));
  });

  it("blocks when status is 'withdrawn'", () => {
    const result = checkOutreach({
      text: "I wanted to check in.",
      kind: "follow_up",
      masterText: MASTER_CV,
      row: { status: "withdrawn" },
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "closed_row"));
  });

  it("blocks when pending_outcome is a rejection", () => {
    const result = checkOutreach({
      text: "Following up on my application.",
      kind: "follow_up",
      masterText: MASTER_CV,
      row: {
        status: "screening",
        pending_outcome: { outcome: "rejected", date: "2026-11-25", source: "gmail" },
      },
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "closed_row"));
  });

  it("does not block a live row with no pending ending", () => {
    const result = checkOutreach({
      text: "Following up on my application for the Software Engineer role.",
      kind: "follow_up",
      masterText: MASTER_CV,
      row: { status: "applied" },
    });
    const rowBlocks = result.blocks.filter((b) => b.code === "closed_row");
    assert.strictEqual(rowBlocks.length, 0);
  });

  it("does not apply the row check for cold_email (no row expected)", () => {
    // Cold emails have no existing tracker row to check; pass no row.
    const result = checkOutreach({
      text: "I am writing to enquire about engineering opportunities at your company.",
      kind: "cold_email",
      masterText: MASTER_CV,
    });
    const rowBlocks = result.blocks.filter((b) => b.code === "closed_row");
    assert.strictEqual(rowBlocks.length, 0);
  });
});

// ── 5. ATS / no-reply recipient blocks ───────────────────────────────────────

describe("ATS / no-reply recipient", () => {
  it("blocks a no-reply address", () => {
    const result = checkOutreach({
      text: "Following up on my application.",
      kind: "follow_up",
      masterText: MASTER_CV,
      recipient: "noreply@example-ats.com",
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "automated_recipient"));
  });

  it("blocks an ATS parser domain", () => {
    const result = checkOutreach({
      text: "Following up.",
      kind: "follow_up",
      masterText: MASTER_CV,
      recipient: "apply@workablemail.com",
    });
    assert.ok(!result.ok);
    assert.ok(result.blocks.some((b) => b.code === "automated_recipient"));
  });

  it("does not block a human address", () => {
    const result = checkOutreach({
      text: "Following up on my application for the Software Engineer role.",
      kind: "follow_up",
      masterText: MASTER_CV,
      recipient: "hiring@example.com",
    });
    const recipientBlocks = result.blocks.filter((b) => b.code === "automated_recipient");
    assert.strictEqual(recipientBlocks.length, 0);
  });
});

// ── 6. Repeated 8+ word phrase warns ─────────────────────────────────────────

describe("repeated phrase", () => {
  const REPEATED_PHRASE = "I am particularly excited about the technical challenges at your company";
  const recentTexts = [
    `Dear team, ${REPEATED_PHRASE} and would love to contribute.`,
    `Hi there, ${REPEATED_PHRASE} given my background in distributed systems.`,
    `Hello, ${REPEATED_PHRASE} and believe my skills are a strong fit.`,
  ];

  it("warns when an 8+ word phrase appears in 3 or more recent texts", () => {
    const result = checkOutreach({
      text: `Thank you for considering my application. ${REPEATED_PHRASE} and I believe I could add real value.`,
      kind: "cold_email",
      masterText: MASTER_CV,
      recentTexts,
    });
    assert.ok(result.warns.some((w) => w.code === "repeated_phrase"), "should warn on repeated phrase");
    const warn = result.warns.find((w) => w.code === "repeated_phrase")!;
    assert.ok(/used \d+ times/i.test(warn.fix), "fix should say 'used N times'");
  });

  it("does not warn when phrase appears fewer than 3 times", () => {
    const result = checkOutreach({
      text: `Thank you for considering my application. ${REPEATED_PHRASE}.`,
      kind: "cold_email",
      masterText: MASTER_CV,
      recentTexts: recentTexts.slice(0, 2), // only 2 recent texts
    });
    const phraseWarns = result.warns.filter((w) => w.code === "repeated_phrase");
    assert.strictEqual(phraseWarns.length, 0, "2 occurrences should not warn");
  });

  it("does not warn when no recentTexts are provided", () => {
    const result = checkOutreach({
      text: `${REPEATED_PHRASE}.`,
      kind: "follow_up",
      masterText: MASTER_CV,
    });
    const phraseWarns = result.warns.filter((w) => w.code === "repeated_phrase");
    assert.strictEqual(phraseWarns.length, 0);
  });
});

// ── 7. Clean message passes ───────────────────────────────────────────────────

describe("clean message", () => {
  it("passes with no flags for a simple, honest follow-up", () => {
    const result = checkOutreach({
      text: "Thank you for considering my application for the Software Engineer role. I wanted to follow up and ask if there are any updates on the timeline.",
      kind: "follow_up",
      masterText: MASTER_CV,
      row: { status: "applied" },
      recipient: "hiring@example.com",
    });
    assert.ok(result.ok, "should be ok");
    assert.strictEqual(result.blocks.length, 0, "no blocks");
    assert.strictEqual(result.warns.length, 0, "no warns");
  });

  it("passes for a clean cold email", () => {
    const result = checkOutreach({
      text: "I am writing to enquire about engineering opportunities. I have been building backend systems with Python and FastAPI for three years.",
      kind: "cold_email",
      masterText: MASTER_CV,
      recipient: "careers@startup.io",
    });
    assert.ok(result.ok);
    assert.strictEqual(result.blocks.length, 0);
  });
});

// ── 8. Determinism ────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("gives the same result for the same input", () => {
    const input = {
      text: "I built a fraud-detection prototype with 150 automated tests.",
      kind: "follow_up" as const,
      masterText: MASTER_CV,
      row: { status: "applied" },
    };
    const r1 = checkOutreach(input);
    const r2 = checkOutreach(input);
    assert.deepStrictEqual(r1, r2);
  });
});
