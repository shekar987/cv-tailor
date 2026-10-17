// The style's format check (lib/styleCheck): each item in pass, fail and
// (where it exists) na, over a CareerSet-shaped document, and the stored
// check re-bounded on read.
import test from "node:test";
import assert from "node:assert/strict";
import { checkStyle, summarizeStyleCheck, normalizeStyleCheck, documentBullets, type StyleCheckInput } from "../src/lib/styleCheck.ts";
import { STYLE_RULES } from "../src/lib/formatStyles/ids.ts";

const CS = STYLE_RULES.careerset;
const bullet = (i: number) => `${["Built", "Designed", "Wrote", "Cut", "Shipped", "Fixed", "Ran", "Led", "Tested", "Moved", "Set", "Added", "Mapped"][i % 13]} thing ${i} with Python on PostgreSQL in ${i + 1} weeks`;
const experience = ["Engineer | Acme | 2020 – 2024", ...Array.from({ length: 8 }, (_, i) => `• ${bullet(i)}`)].join("\n");
const projects = { "0": [bullet(8), bullet(9)], "1": [bullet(10), bullet(11)] };
const profile = { name: "Jane Doe", tagline: "Engineer | 2 years' experience | Python", email: "j@x.com", linkedin: "linkedin.com/in/jane", github: "github.com/jane", website: "" };
const letter = [
  "Dear Acme Hiring Team,",
  "I am applying for the Engineer role at Acme. I cut response times by 25% at Brane. I am particularly interested in this role because Acme builds payment rails for banks.",
  "In Jobhuntz, a personal project, I built an eight-step pipeline that cut untraceable sentences from 28% to 6%.",
  "Having read the job description, these are the four areas where I can add value from the start:",
  "1. Python: I delivered 20+ API modules in Python at Brane.",
  "2. Testing: I wrote 192 unit tests for CampaignPulse, a personal project.",
  "3. PostgreSQL: I tuned queries at Brane, making them 30% faster.",
  "4. AWS: I provisioned a London-region stack with Terraform for CampaignPulse.",
  "I am completing an MSc in Computer Science at the University of East London, expected January 2027.",
  "Thank you for considering my application. I would welcome a conversation about the role.",
  "Kind regards,",
  "Jane Doe",
].join("\n");
const pad = (text: string, to: number) => {
  const extra = Array.from({ length: Math.max(0, to - text.split(/\s+/).length) }, (_, i) => `word${i}`).join(" ");
  return text.replace("Kind regards,", `${extra}\nKind regards,`);
};
const good: StyleCheckInput = { sections: { summary: "S one. S two.", skills: "Technical Tools:\nLanguages & Frameworks: Python", experience, projects }, profile, coverLetter: pad(letter, 300), pages: 2 };

test("a document that keeps every rule passes every item", () => {
  const items = checkStyle(CS, good);
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.deepEqual(Object.keys(by), ["bullets", "words", "pages", "longest", "verbs", "banned", "letterBanned", "fullStops", "contact", "letterWords", "interest", "thanks", "points"]);
  for (const i of items) assert.equal(i.status, "pass", `${i.key}: ${i.detail}`);
  assert.deepEqual(summarizeStyleCheck(items), { pass: 13, fail: 0, na: 0 });
  assert.equal(documentBullets(good.sections).length, 12);
});

test("each rule fails on its own evidence", () => {
  const by = (input: Partial<StyleCheckInput>) => Object.fromEntries(checkStyle(CS, { ...good, ...input }).map((i) => [i.key, i]));
  // Too few bullets.
  const few = by({ sections: { ...good.sections, projects: {} } });
  assert.equal(few.bullets.status, "fail");
  assert.match(few.bullets.detail, /^8 across/);
  // Too many words.
  const long = by({ sections: { ...good.sections, summary: Array.from({ length: 900 }, (_, i) => `w${i}`).join(" ") } });
  assert.equal(long.words.status, "fail");
  // Three pages, and not measured.
  assert.equal(by({ pages: 3 }).pages.status, "fail");
  assert.equal(by({ pages: null }).pages.status, "na");
  // A 31-word bullet.
  const wide = by({ sections: { ...good.sections, projects: { ...projects, "2": [Array.from({ length: 31 }, (_, i) => `w${i}`).join(" ")] } } });
  assert.equal(wide.longest.status, "fail");
  assert.match(wide.longest.detail, /^31 words/);
  // The same opening verb three times.
  const built = by({ sections: { ...good.sections, projects: { "0": ["Built a", "Built b"], "1": ["Built c", "Made d"] } } });
  assert.equal(built.verbs.status, "fail");
  assert.match(built.verbs.detail, /Built ×4/);
  // A banned word in a bullet, and in the letter.
  const banned = by({ sections: { ...good.sections, projects: { "0": ["Used Docker daily", bullet(9)], "1": projects["1"] } } });
  assert.equal(banned.banned.status, "fail");
  assert.equal(banned.banned.detail, "used");
  const lb = by({ coverLetter: good.coverLetter.replace("I delivered", "I also delivered") });
  assert.equal(lb.letterBanned.status, "fail");
  assert.equal(lb.letterBanned.detail, "also");
  // A full stop on a bullet (etc. and an ellipsis are fine).
  const dotted = by({ sections: { ...good.sections, projects: { "0": [`${bullet(8)}.`, `${bullet(9)}, etc.`], "1": [`${bullet(10)}...`, bullet(11)] } } });
  assert.equal(dotted.fullStops.status, "fail");
  assert.match(dotted.fullStops.detail, /^1: /);
  // No address on the profile: not applicable.
  assert.equal(by({ profile: { name: "Jane Doe", email: "j@x.com" } }).contact.status, "na");
  // The letter: too short, no interest line, no thanks, three points.
  const short = by({ coverLetter: letter });
  assert.equal(short.letterWords.status, "fail");
  assert.match(short.letterWords.detail, /this style wants 300 to 420/);
  assert.equal(by({ coverLetter: good.coverLetter.replace("I am particularly interested in this role because Acme builds payment rails for banks.", "") }).interest.status, "fail");
  assert.equal(by({ coverLetter: good.coverLetter.replace("Thank you for considering my application. ", "") }).thanks.status, "fail");
  const three = by({ coverLetter: good.coverLetter.replace("4. AWS: I provisioned a London-region stack with Terraform for CampaignPulse.\n", "") });
  assert.equal(three.points.status, "fail");
  assert.match(three.points.detail, /^3 numbered points/);
  // No letter at all: the letter items are not applicable.
  const none = by({ coverLetter: "" });
  for (const k of ["letterBanned", "letterWords", "interest", "thanks", "points"]) assert.equal(none[k].status, "na", k);
  // The date line the preview adds on top is not counted.
  assert.equal(by({ coverLetter: `16 October 2026\n${good.coverLetter}` }).letterWords.detail, by({}).letterWords.detail);
});

test("UKJI's rules have no check of their own, and the items still compute without crashing", () => {
  assert.equal(STYLE_RULES.ukji.check, false);
  const items = checkStyle(STYLE_RULES.ukji, good);
  assert.deepEqual(items.map((i) => i.key), ["pages", "letterWords"], "nothing else is a UKJI rule");
});

test("normalizeStyleCheck re-bounds a stored check", () => {
  const stored = [
    { key: "bullets", label: "Bullets in total", status: "pass", detail: "14 across experience and projects." },
    { key: "x".repeat(60), label: "y".repeat(100), status: "fail", detail: "z".repeat(300) },
    { key: "bad", label: "bad", status: "meh", detail: "" },
    "junk",
    null,
  ];
  const n = normalizeStyleCheck(stored)!;
  assert.equal(n.length, 2);
  assert.equal(n[1].key.length, 40);
  assert.equal(n[1].label.length, 80);
  assert.equal(n[1].detail.length, 200);
  assert.equal(normalizeStyleCheck("nope"), null);
  assert.equal(normalizeStyleCheck([]), null);
  assert.equal(normalizeStyleCheck(Array.from({ length: 30 }, () => stored[0]))!.length, 16);
});
