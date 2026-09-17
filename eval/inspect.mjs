// Free helper: which filler words and weak bullets a stored harness run
// contains, so a prompt change can be aimed rather than guessed.
//   node eval/inspect.mjs <label>
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { inflationHits, weakBullets } = await import(pathToFileURL(join(HERE, "..", "src/lib/quality.ts")));
const label = process.argv[2];
if (!label) { console.log("usage: node eval/inspect.mjs <label>"); process.exit(2); }
const dir = join(HERE, "out", label);
const words = new Map();
const perSection = { summary: 0, experience: 0, coverLetter: 0 };
const weak = [];
for (const f of readdirSync(dir)) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8")).result;
  for (const section of ["summary", "experience", "coverLetter"]) {
    for (const h of inflationHits(d[section])) {
      words.set(h.word, (words.get(h.word) ?? 0) + h.count);
      perSection[section] += h.count;
    }
  }
  for (const b of weakBullets(d.experience, d.projects)) weak.push(`${f.replace(".json", "")}: ${b}`);
}
console.log(`=== ${label}`);
console.log("filler by word:", JSON.stringify([...words.entries()].sort((a, b) => b[1] - a[1])));
console.log("filler by section:", JSON.stringify(perSection));
console.log("weak bullets:");
for (const w of weak) console.log("  " + w);
