// Build the structured master profile from a master CV, by rules, no LLM.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/build-profile.ts <cv.txt> [out.json]
//
// Reads the CV text from the given file (defaults to the fictional fixture),
// runs the rule-based importer and the validator, prints a summary (bullets
// placed, unmapped lines, any validation problems) and writes the JSON.
//
// The owner runs this on his REAL master CV — exported from the app, kept
// OUTSIDE the repo — and reviews `unmapped[]` before trusting the result. His
// real profile is never committed; only the fictional fixture is.
//
// The importer and validator live in src/lib/profile so they are unit-tested
// and shared with the app; this file is only the CLI around them.

import { readFileSync, writeFileSync } from "node:fs";
import { buildStructuredProfile } from "../src/lib/profile/import.ts";
import { validateStructuredProfile } from "../src/lib/profile/validate.ts";

function main() {
  const [, , inPath = "fixtures/cv.example.txt", outPath = "fixtures/profile.example.json"] = process.argv;
  const cvText = readFileSync(inPath, "utf8");
  // PROFILE_NOW pins the timestamp so the committed fixture is reproducible;
  // a real run leaves it unset and stamps the current time.
  const { profile, problems } = buildStructuredProfile(cvText, process.env.PROFILE_NOW || new Date().toISOString());
  const validation = validateStructuredProfile(profile, cvText);

  const expBullets = profile.experience.reduce((n, e) => n + e.bullets.length, 0);
  const projBullets = profile.projects.reduce((n, p) => n + p.bullets.length, 0);
  const metrics = profile.experience
    .flatMap((e) => e.bullets)
    .concat(profile.projects.flatMap((p) => p.bullets))
    .flatMap((b) => b.metrics);

  console.log(`Imported ${inPath}`);
  console.log(`  experience: ${profile.experience.length} roles, ${expBullets} bullets`);
  console.log(`  projects:   ${profile.projects.length} (${projBullets} bullets)`);
  console.log(`  skills:     ${profile.skills.length}`);
  console.log(`  metrics:    ${metrics.length} — ${metrics.map((m) => m.value).join(", ")}`);
  console.log(`  education:  ${profile.education.length}   certifications: ${profile.certifications.length}`);
  console.log(`  unmapped:   ${profile.unmapped.length}`);
  if (profile.unmapped.length) for (const u of profile.unmapped) console.log(`    · ${u}`);
  if (problems.length) {
    console.log("  importer notes:");
    for (const p of problems) console.log(`    ! ${p}`);
  }
  if (!validation.ok) {
    console.log("  validation problems:");
    for (const p of validation.problems) console.log(`    ✗ ${p}`);
  } else {
    console.log("  validation: OK");
  }

  writeFileSync(outPath, JSON.stringify(profile, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

main();
