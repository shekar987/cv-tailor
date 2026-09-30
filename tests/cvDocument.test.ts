// lib/cvDocument: the pre-pass the .docx route and the PDF builder share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareCvDocument, ensureHttps } from "../src/lib/cvDocument.ts";
import { normalizeProfile } from "../src/lib/profile.ts";

const profile = normalizeProfile({
  name: "Jane Doe", tagline: "Backend Engineer | github.com/jane", location: "London", phone: "",
  email: "jane@example.com", linkedin: "linkedin.com/in/jane", github: "https://github.com/jane", website: "",
  education: [{ degree: "BSc Computer Science", dates: "2018 – 2021", institution: "Test University", note: "First" }],
  certifications: ["AWS SAA"], rightToWork: [], projects: [], extraSections: [{ title: "Awards", bullets: ["Dean's list"] }],
});

const input = {
  profile,
  summary: "Backend engineer with four years on payment systems.",
  skills: "Languages: Go, TypeScript",
  experience: "Backend Engineer | Acme | 2021 – Present\n- Cut p99 latency 40%",
  projects: { "0": ["Built a widget tracker"] },
  projectsMeta: [{ name: "Widget Tracker", tech: "Go", links: [] }],
};

test("contact pieces: cleaned tagline, https on stored handles, a row when anything is set", () => {
  const { contact } = prepareCvDocument({ ...input, targetPages: 2 });
  assert.equal(contact.name, "Jane Doe");
  assert.equal(contact.tagline, "Backend Engineer");
  assert.equal(contact.linkedin, "https://linkedin.com/in/jane");
  assert.equal(contact.github, "https://github.com/jane");
  assert.equal(contact.website, "");
  assert.equal(contact.hasRow, true);
  assert.equal(ensureHttps("example.com"), "https://example.com");
  assert.equal(ensureHttps("http://example.com"), "http://example.com");
});

test("the profile's lists are remapped for the renderers", () => {
  const doc = prepareCvDocument({ ...input, targetPages: 2 });
  assert.deepEqual(doc.education, [{ head: "BSc Computer Science", date: "2018 – 2021", school: "Test University", note: "First" }]);
  assert.deepEqual(doc.certs, ["AWS SAA"]);
  assert.deepEqual(doc.rightToWork, []);
  assert.deepEqual(doc.extraSections, [{ title: "Awards", bullets: ["Dean's list"] }]);
});

test("an empty profile renders blank, never anything else", () => {
  const { contact, education, certs } = prepareCvDocument({ ...input, profile: normalizeProfile(null), targetPages: 2 });
  assert.equal(contact.name, "");
  assert.equal(contact.hasRow, false);
  assert.deepEqual(education, []);
  assert.deepEqual(certs, []);
});

test("the density is chosen for the target page count: one page is never roomier than two", () => {
  const two = prepareCvDocument({ ...input, targetPages: 2 }).density;
  const one = prepareCvDocument({ ...input, targetPages: 1 }).density;
  assert.ok(one.margin <= two.margin, `${one.margin} > ${two.margin}`);
  assert.ok(one.bulletAfter <= two.bulletAfter, `${one.bulletAfter} > ${two.bulletAfter}`);
});
