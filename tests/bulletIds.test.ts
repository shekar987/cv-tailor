import test from "node:test";
import assert from "node:assert/strict";
import { parseMasterExperience, renderIdBlock, substitutions, reconcileExperience, diffAgainstMaster, diffProjects, MAX_SUBSTITUTIONS } from "../src/lib/bulletIds.ts";

const master = `SOMA SHEKAR
Full Stack Engineer

EXPERIENCE
Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024
Highlight: Shipped 20+ API modules across 2 product lines.
- Built AI-enabled services with FastAPI and React for 3,000 users.
- Cut frontend load time by 20% with code splitting.
- Wrote 90+ Jest tests covering the checkout flow.

Research Assistant | University of East London | Jan 2026 – Present
- Analysed 11 industry asset-management platforms from verified user reviews.
- Built a gap-analysis dashboard in Next.js.

PROJECTS
Jobhuntz | 2026
- Built a CV tool.
`;

test("parseMasterExperience numbers every role and bullet, highlight included", () => {
  const roles = parseMasterExperience(master);
  assert.equal(roles.length, 2);
  assert.equal(roles[0].header, "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024");
  assert.deepEqual(roles[0].bullets.map((b) => b.id), ["R1.1", "R1.2", "R1.3", "R1.4"]);
  assert.equal(roles[0].bullets[0].text, "Highlight: Shipped 20+ API modules across 2 product lines.");
  assert.deepEqual(roles[1].bullets.map((b) => b.id), ["R2.1", "R2.2"]);
  assert.match(renderIdBlock(roles), /^ROLE 1: Full Stack Engineer \| Brane Group[^\n]*\n\[R1\.1\] Highlight/);
  assert.deepEqual(parseMasterExperience("No experience heading here."), []);
});

test("substitutions counts replaced words by longest common subsequence, ignoring bold and case", () => {
  assert.deepEqual(substitutions("Built AI-enabled services with FastAPI and React for 3,000 users.", "Built **AI-enabled** services with FastAPI and React for 3,000 users."), { changed: 0, from: [], to: [] });
  const one = substitutions("Cut frontend load time by 20% with code splitting.", "Cut front-end load time by 20% with code splitting.");
  assert.equal(one.changed, 1);
  const two = substitutions("Wrote 90+ Jest tests covering the checkout flow.", "Wrote 90+ Jest tests covering the payment flow for merchants.");
  assert.equal(two.changed, 3, JSON.stringify(two));
  assert.ok(two.changed > MAX_SUBSTITUTIONS);
});

test("reconcileExperience: ids resolve, ≤2 substitutions stand, more is reverted, no-id bullets match by overlap, unknown text is dropped, markers stripped", () => {
  const roles = parseMasterExperience(master);
  const output = [
    "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024",
    "• [R1.2] Built AI-enabled services with FastAPI and React for **3,000 users**.",
    "• [R1.4] Wrote 90+ Jest tests covering the payment flow for merchants and partners.",
    "• [R1.1] Highlight: Shipped 20+ API modules across 2 product lines.",
    "• Cut front-end load time by 20% with code splitting.",
    "• [R9.9] Led a team of 12 engineers to deliver a £2m platform.",
    "",
    "Research Assistant | University of East London | Jan 2026 – Present",
    "• [R2.1] Analysed 11 industry asset-management platforms from verified user reviews.",
  ].join("\n");
  const { experience, changes } = reconcileExperience(output, roles);
  assert.ok(changes);
  assert.doesNotMatch(experience, /\[R\d/);
  assert.doesNotMatch(experience, /£2m/, "an id nothing matches is dropped, not kept");
  assert.match(experience, /• Wrote 90\+ Jest tests covering the checkout flow\./, "3 substitutions → reverted to master wording");
  const r1 = changes.roles[0];
  assert.equal(r1.role, roles[0].header);
  assert.deepEqual(r1.bullets.map((b) => [b.id, b.status]), [["R1.2", "kept"], ["R1.4", "reverted"], ["R1.1", "kept"], ["R1.3", "edited"]]);
  assert.deepEqual(r1.bullets[3].from, ["frontend"]);
  assert.deepEqual(r1.bullets[3].to, ["front-end"]);
  assert.equal(r1.reordered, true);
  assert.deepEqual(r1.dropped, []);
  assert.deepEqual(changes.roles[1].dropped.map((d) => d.id), ["R2.2"]);
  assert.equal(changes.reverted, 1);
  assert.equal(changes.dropped, 1);
  // No ids anywhere: the protocol was not followed; text passes through untouched.
  const plain = "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024\n• Something new entirely.";
  assert.deepEqual(reconcileExperience(plain, roles), { experience: plain, changes: null });
});

test("diffAgainstMaster reads the finished text by closest bullet: kept, edited, dropped, new", () => {
  const roles = parseMasterExperience(master);
  const finalText = [
    "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024",
    "• Cut frontend load time by 20% with code splitting.",
    "• Built AI-enabled services with FastAPI and React for 3,000 customers.",
    "• Mentored three junior engineers on the payments team.",
    "",
    "Research Assistant | University of East London | Jan 2026 – Present",
    "• Analysed 11 industry asset-management platforms from verified user reviews.",
  ].join("\n");
  const d = diffAgainstMaster(finalText, roles)!;
  assert.deepEqual(d.roles[0].bullets.map((b) => b.status), ["kept", "edited", "new"]);
  assert.deepEqual(d.roles[0].bullets[1].from, ["users"]);
  assert.deepEqual(d.roles[0].bullets[1].to, ["customers"]);
  assert.deepEqual(d.roles[0].dropped.map((x) => x.id), ["R1.1", "R1.4"]);
  assert.equal(d.roles[0].reordered, true);
  assert.equal(d.added, 1);
  assert.equal(d.dropped, 3);
});

test("diffProjects compares each project's bullets with its own master bullets", () => {
  const d = diffProjects({ "0": ["Built a CV tool with a real PDF text layer.", "Something invented."], "1": ["Deployed on Vercel."] }, [
    { name: "Jobhuntz", originalBullets: ["Built a CV tool with a real PDF text layer.", "Wrote 90+ tests."] },
    { name: "RideX", originalBullets: ["Deployed on Vercel."] },
  ]);
  assert.equal(d[0].role, "Jobhuntz");
  assert.deepEqual(d[0].bullets.map((b) => b.status), ["kept", "new"]);
  assert.deepEqual(d[0].dropped.map((x) => x.text), ["Wrote 90+ tests."]);
  assert.deepEqual(d[1].bullets.map((b) => b.status), ["kept"]);
});
