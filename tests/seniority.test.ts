// Unit tests for the pre-check seniority classifier. node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySeniority, seniorityFit, MID_MIN_YEARS, SENIOR_MIN_YEARS } from "../src/lib/seniority.ts";

const kinds = (jd: string, title?: string) => classifySeniority(jd, title).signals.map((s) => `${s.kind}:${s.level}`);

test("title tokens decide the level: senior words, level suffixes, junior words", () => {
  assert.equal(classifySeniority("Senior Full Stack Developer (Java)\nRemote, UK").level, "senior");
  assert.equal(classifySeniority("Staff Engineer, Platform").level, "senior");
  assert.equal(classifySeniority("Principal Software Engineer").level, "senior");
  assert.equal(classifySeniority("Head of Engineering").level, "senior");
  assert.equal(classifySeniority("Software Engineer III").level, "senior");
  assert.equal(classifySeniority("Software Engineer IV").level, "senior");
  assert.equal(classifySeniority("Software Engineer II").level, "mid");
  assert.equal(classifySeniority("Software Engineer I").level, "junior");
  assert.equal(classifySeniority("Graduate Software Engineer (Business Systems)").level, "junior");
  assert.equal(classifySeniority("Associate Software Engineer at Planes").level, "junior");
  assert.equal(classifySeniority("Engineering Software Industrial Placement").level, "junior");
  // The analyser's title wins over the first line when both are given.
  assert.equal(classifySeniority("About us\nWe build things.", "Lead Backend Engineer").level, "senior");
  assert.deepEqual(kinds("Senior Engineer"), ["title:senior"]);
});

test("stated minimum years, ownership language and a salary band add up", () => {
  const mid = "Software Engineer (AI/Backend)\nYou have 3+ years of experience building backend services.";
  assert.equal(classifySeniority(mid).level, "mid");
  assert.deepEqual(kinds(mid), ["years:mid"]);
  const senior = "Software Engineer\nAt least 5 years' professional experience. You will mentor junior engineers, own the technical roadmap and write the RFCs that set technical direction.";
  const r = classifySeniority(senior);
  assert.equal(r.level, "senior");
  assert.ok(r.signals.some((s) => s.kind === "years" && s.level === "senior"));
  assert.equal(r.signals.filter((s) => s.kind === "ownership").length, 2, "ownership signals are capped at two");
  // Being mentored is the opposite of mentoring.
  const junior = "Junior Developer\nYou'll be mentored by senior engineers. 0-2 years of experience.";
  assert.equal(classifySeniority(junior).level, "junior");
  assert.ok(!classifySeniority(junior).signals.some((s) => s.kind === "ownership"));
  // One ownership phrase with nothing else is not a level (the real Theodo
  // posting: "as you grow, you'll mentor junior developers" in a junior role).
  const theodo = "Full Stack Engineer — Theodo UK\nYou'll dive straight into hands-on learning, guided by experienced developers who will mentor you. As you grow, you'll take on more responsibility, mentor junior developers and become a technical advisor.";
  assert.equal(classifySeniority(theodo).level, "unknown");
  assert.equal(classifySeniority(theodo + " You will own the technical roadmap.").level, "senior", "two ownership phrases agree");
  // Salary: the midpoint of an annual band; day rates are ignored.
  assert.deepEqual(kinds("Software Engineer\nSalary GBP 48,500."), ["salary:mid"]);
  assert.deepEqual(kinds("Software Engineer\n£85,000 - £95,000 plus equity."), ["salary:senior"]);
  assert.deepEqual(kinds("Software Engineer\n$180k - $220k."), ["salary:senior"]);
  assert.deepEqual(kinds("Software Engineer\nSalary GBP 35,000 - 55,000."), ["salary:mid"]);
  assert.deepEqual(kinds("Contract Developer\n£480 per day, inside IR35."), []);
  // The real rejection: identified as mid-level and recommended anyway.
  const omnea = "Frontend Engineer — London\nStack and skills: TypeScript, React, modern component architecture. Salary £60,000 - £80,000.";
  assert.equal(classifySeniority(omnea).level, "mid");
  assert.equal(classifySeniority("").level, "unknown");
  assert.equal(classifySeniority("We are hiring.").level, "unknown");
});

test("seniorityFit: a mid-level read against fewer years than it expects is the blocking warning", () => {
  const mid = classifySeniority("Software Engineer\n3+ years of experience.");
  const f = seniorityFit(mid, 2);
  assert.equal(f.fits, false);
  assert.match(f.reason, /^This reads as mid-level — tailoring anyway will spend a credit\./);
  assert.match(f.reason, new RegExp(`${MID_MIN_YEARS}\\+ years; you have 2`));
  assert.equal(seniorityFit(mid, 3).fits, true);
  assert.equal(seniorityFit(mid, null).fits, null, "unknown years never block");
  const senior = classifySeniority("Senior Backend Engineer");
  assert.equal(seniorityFit(senior, 4).fits, false);
  assert.match(seniorityFit(senior, 4).reason, /senior — tailoring anyway will spend a credit/);
  assert.equal(seniorityFit(senior, SENIOR_MIN_YEARS).fits, true);
  assert.equal(seniorityFit(classifySeniority("Graduate Engineer"), 0).fits, true);
  assert.equal(seniorityFit(classifySeniority("We are hiring."), 2).fits, null);
});
