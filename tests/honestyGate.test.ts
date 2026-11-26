// Tests for src/lib/honestyGate.ts (JH-6, 25 Nov 2026).
// All profiles are fictional.

import { test } from "node:test";
import assert from "node:assert/strict";
import { honestyGate, type HonestyDoc } from "../src/lib/honestyGate.ts";

// A minimal HonestyDoc with everything empty except what the test sets.
function doc(overrides: Partial<HonestyDoc> = {}): HonestyDoc {
  return {
    summary: "",
    skills: "",
    experience: "",
    projects: {},
    coverLetter: "",
    ...overrides,
  };
}

// ── Test 1: Availability claims stripped from experience ─────────────────────

test("availability claim in experience bullet is stripped and reported in removed", () => {
  const result = honestyGate({
    sections: doc({
      experience:
        "Built payment gateway for Cobalt Finance; available immediately for roles in fintech",
    }),
    masterCv: "Built payment gateway for Cobalt Finance",
  });

  assert.ok(
    !result.sections.experience.includes("available immediately"),
    "availability phrase should be gone from experience",
  );
  assert.ok(
    result.removed.some((r) => /available immediately/i.test(r)),
    "removed should mention the stripped line",
  );
});

// ── Test 2: Availability claims stripped from projects ───────────────────────

test("availability claim in project bullet is stripped and reported in removed", () => {
  const result = honestyGate({
    sections: doc({
      projects: {
        "0": ["Led data pipeline rebuild at Vanta Analytics; can start any role within 1 week"],
      },
    }),
    masterCv: "Led data pipeline rebuild at Vanta Analytics",
  });

  const allBullets = result.sections.projects["0"] ?? [];
  assert.ok(
    allBullets.every((b) => !/can start/i.test(b)),
    "availability phrase should be gone from project bullets",
  );
  assert.ok(
    result.removed.some((r) => /can start/i.test(r)),
    "removed should mention the stripped bullet",
  );
});

// ── Test 3: Allowed availability sentence is NOT stripped ────────────────────

test("the exact allowed availability sentence is preserved in summary", () => {
  const allowed = "Available immediately for full-time employment.";
  const result = honestyGate({
    sections: doc({
      summary: `Full-stack developer at Meridian Labs. ${allowed}`,
    }),
    masterCv: "Full-stack developer at Meridian Labs",
    allowedAvailabilitySentence: allowed,
  });

  assert.ok(
    result.sections.summary.includes(allowed),
    "allowed availability sentence must survive",
  );
  assert.ok(
    !result.removed.some((r) => r === allowed),
    "allowed sentence must not appear in removed",
  );
});

// ── Test 4: Unsupported figure flagged (not removed) ─────────────────────────

test("a figure not in master CV is flagged in blocked but bullet is kept", () => {
  const bullet = "Reduced deployment time by 150%";
  const result = honestyGate({
    sections: doc({
      experience: bullet,
    }),
    masterCv: "Reduced deployment time significantly",
  });

  // Bullet must still be present.
  assert.ok(
    result.sections.experience.includes(bullet),
    "bullet with unsupported figure must still be in output",
  );
  // 150 must be flagged.
  assert.ok(
    result.blocked.some((b) => b.includes("150")),
    `blocked should mention unsupported figure 150, got: ${JSON.stringify(result.blocked)}`,
  );
});

// ── Test 5: Figure in master CV is not flagged ───────────────────────────────

test("figures that appear in master CV do not appear in blocked", () => {
  const result = honestyGate({
    sections: doc({
      experience: "Cut deploy time from 40 to 8 minutes",
    }),
    masterCv: "Reduced deployment time by 40 minutes to 8 at Hexon Systems",
  });

  // No entry in blocked that mentions 150 (a different number), and nothing about 40 or 8.
  assert.ok(
    result.blocked.every((b) => !/unsupported figure in experience.*\b(40|8)\b/i.test(b)),
    `figures 40 and 8 from master CV should not be flagged, got: ${JSON.stringify(result.blocked)}`,
  );
});

// ── Test 6: Pinned bullet that survived is not flagged ───────────────────────

test("a pinned bullet present in experience output is not in blocked", () => {
  const pinned = "Built idempotent Stripe payment integration at Cobalt Finance";
  const result = honestyGate({
    sections: doc({
      experience: pinned,
    }),
    masterCv: pinned,
    pinnedTexts: [pinned],
  });

  assert.ok(
    !result.blocked.some((b) => /pinned bullet missing/i.test(b)),
    "pinned bullet that survived should not be flagged",
  );
});

// ── Test 7: Pinned bullet that was dropped is flagged ────────────────────────

test("a pinned bullet absent from all output sections is flagged in blocked", () => {
  const pinned = "Built idempotent Stripe payment integration at Cobalt Finance";
  const result = honestyGate({
    sections: doc({
      // The pinned text is NOT in any section — imagine a rewrite removed it.
      experience: "Worked on payment systems at Cobalt Finance",
    }),
    masterCv: pinned,
    pinnedTexts: [pinned],
  });

  assert.ok(
    result.blocked.some((b) => /pinned bullet missing/i.test(b)),
    `blocked should report the missing pinned bullet, got: ${JSON.stringify(result.blocked)}`,
  );
  assert.ok(
    result.blocked.some((b) => b.includes("Built idempotent Stripe")),
    "blocked entry should include the start of the pinned text",
  );
});

// ── Test 8: Retired claims re-applied in gate ────────────────────────────────

test("retired phrases are removed from summary and reported in removed", () => {
  const result = honestyGate({
    sections: doc({
      summary:
        "Research Assistant, AI and Full-Stack with three years of experience at Vanta Systems.",
    }),
    masterCv:
      "Research Assistant, AI and Full-Stack with three years of experience at Vanta Systems",
    retiredClaims: [{ phrase: "Research Assistant, AI and Full-Stack", replacement: null }],
  });

  assert.ok(
    !result.sections.summary.includes("Research Assistant, AI and Full-Stack"),
    "retired phrase should be gone from summary",
  );
  assert.ok(
    result.removed.some((r) => /Research Assistant, AI and Full-Stack/i.test(r)),
    `removed should mention the retired phrase, got: ${JSON.stringify(result.removed)}`,
  );
});

// ── Extra: availability NOT stripped from other non-availability text ─────────

test("non-availability content in experience is preserved", () => {
  const bullet = "Architected Vanta Finance's real-time payments platform";
  const result = honestyGate({
    sections: doc({ experience: bullet }),
    masterCv: bullet,
  });

  assert.equal(result.sections.experience, bullet);
  assert.equal(result.removed.length, 0);
  assert.equal(result.blocked.length, 0);
});

// ── Extra: availability in cover letter is stripped ──────────────────────────

test("availability in cover letter sentence is stripped", () => {
  const result = honestyGate({
    sections: doc({
      coverLetter:
        "I am excited to apply for this role at Cobalt Finance. I am available immediately and ready to start.",
    }),
    masterCv: "Excited to apply for roles in fintech",
  });

  assert.ok(
    !result.sections.coverLetter.includes("available immediately"),
    "availability should be stripped from cover letter",
  );
  assert.ok(
    result.removed.length > 0,
    "removed should be non-empty",
  );
});
