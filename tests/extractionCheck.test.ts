// Unit tests for the extraction shortfall check (Brief 3, Bug C). node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedCounts, extractionFlags, mergeProfileEdits } from "../src/lib/extractionCheck.ts";

const CV = `JANE DOE
Backend Engineer

EXPERIENCE
Backend Engineer | Acme | 2022 – Present
- Built things.

PROJECTS
Widget Tracker | 2024
Tech: Go, PostgreSQL
- Tracks widgets for 2k users.
RideX
Tech: React, Firebase
Live: https://ridex.example
- Ride hailing.
Ledger Sync | 2023
- Syncs ledgers.
Portfolio Site
- Static site.

EDUCATION
MSc Computer Science | University of East London
2025 – 2027
BSc Computer Science
Osmania University, 2018 – 2022

CERTIFICATIONS
- AWS Certified Solutions Architect – Associate
- Oracle Certified Java Programmer

RIGHT TO WORK
UK: full right to work`;

test("expectedCounts reads entry-shaped lines under the three headings", () => {
  assert.deepEqual(expectedCounts(CV), { projects: 4, education: 2, certifications: 2 });
  assert.deepEqual(expectedCounts("JANE\nEXPERIENCE\n- x"), { projects: null, education: null, certifications: null });
  assert.deepEqual(expectedCounts("Projects:\nAlpha\n- did\nBeta\n- did"), { projects: 2, education: null, certifications: null });
  // A bare stack line under a title is the project's tech, not a second
  // project (this false positive showed a red "2 listed, 1 extracted"
  // warning on Customize for a correctly extracted CV).
  assert.deepEqual(expectedCounts("PROJECTS\nWidget Tracker | 2024\nGo, PostgreSQL, Docker\n- Tracks widgets.\nRideX\nReact Native, Firebase, Google Maps API\n- Ride hailing."), { projects: 2, education: null, certifications: null });
  // A title that happens to contain a comma is still a title.
  assert.deepEqual(expectedCounts("PROJECTS\nAlpha, the Widget Tracker | 2024\n- did\nBeta\n- did"), { projects: 2, education: null, certifications: null });
});

test("extractionFlags names the shortfall (the audited case: 4 listed, 2 extracted)", () => {
  assert.deepEqual(extractionFlags(CV, { projects: 2, education: 2, certifications: 2 }), [{ section: "projects", label: "Projects", expected: 4, got: 2 }]);
  assert.deepEqual(extractionFlags(CV, { projects: 4, education: 2, certifications: 1 }), []); // certifications tolerate one wrapped line
  assert.deepEqual(extractionFlags(CV, { projects: 4, education: 1, certifications: 2 }), [{ section: "education", label: "Education", expected: 2, got: 1 }]);
  assert.deepEqual(extractionFlags("no headings here", { projects: 0, education: 0, certifications: 0 }), []);
});

test("mergeProfileEdits keeps the user's current contact fields over a fresh extraction", () => {
  const current = { name: "Jane Doe (edited)", tagline: "", email: "jane@example.com", projects: [{ name: "old" }] };
  const fresh = { name: "JANE DOE", tagline: "Backend Engineer", email: "", projects: [{ name: "new" }] };
  assert.deepEqual(mergeProfileEdits(current, fresh), { name: "Jane Doe (edited)", tagline: "Backend Engineer", email: "jane@example.com", projects: [{ name: "new" }] });
  assert.equal(mergeProfileEdits(null, fresh), fresh);
});
