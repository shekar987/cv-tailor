import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail, isValidPhone, isValidProfileUrl, checkContact, contactBlockMessage, emailFromText, profileUrlFromText,
} from "../src/lib/contactCheck.ts";
import { mergeProfileEdits } from "../src/lib/extractionCheck.ts";

test("email: a word, a label or a half address is not an email", () => {
  for (const ok of ["jane@example.com", "jane.doe+cv@mail.co.uk", "MAILTO:jane@example.com", " j_d-1@sub.example.io "]) {
    assert.equal(isValidEmail(ok), true, ok);
  }
  for (const bad of ["Gmail", "Email", "gmail.com", "jane@", "@example.com", "jane@example", "jane @example.com", "jane@example.c", "jane@@example.com", "LinkedIn"]) {
    assert.equal(isValidEmail(bad), false, bad);
  }
});

test("phone: UK and international numbers pass, words and short numbers do not", () => {
  for (const ok of ["07700 900123", "+44 7700 900123", "+44 (0)7700 900123", "020 7946 0958", "(020) 7946-0958", "+1 415 555 0132", "+91 98765 43210", "+353 1 234 5678"]) {
    assert.equal(isValidPhone(ok), true, ok);
  }
  for (const bad of ["Phone", "Mobile", "12345", "0770 090", "+44 7700", "07700 900123 ext", "+44 7700 900123 456789", "++44 7700 900123"]) {
    assert.equal(isValidPhone(bad), false, bad);
  }
});

test("links: must be web addresses, and LinkedIn / GitHub on their own sites", () => {
  assert.equal(isValidProfileUrl("linkedin.com/in/jane", "linkedin"), true);
  assert.equal(isValidProfileUrl("https://uk.linkedin.com/in/jane", "linkedin"), true);
  assert.equal(isValidProfileUrl("https://www.github.com/jane", "github"), true);
  assert.equal(isValidProfileUrl("jane.dev", "website"), true);
  assert.equal(isValidProfileUrl("LinkedIn", "linkedin"), false, "the label, the Gmail bug's twin");
  assert.equal(isValidProfileUrl("GitHub", "github"), false);
  assert.equal(isValidProfileUrl("github.com/jane", "linkedin"), false, "the wrong site");
  assert.equal(isValidProfileUrl("Portfolio", "website"), false);
  assert.equal(isValidProfileUrl("javascript:alert(1)", "website"), false);
});

test("checkContact: 'Gmail' blocks with the sentence the user sees; empty optional fields are fine", () => {
  const p = { email: "Gmail", phone: "", linkedin: "", github: "", website: "" };
  const problems = checkContact(p);
  assert.deepEqual(problems.map((x) => x.field), ["email"]);
  assert.equal(problems[0].message, "Your email looks wrong: 'Gmail'. Fix it in Your details.");
  assert.equal(contactBlockMessage(problems), "Your email looks wrong: 'Gmail'. Fix it in Your details.");

  assert.deepEqual(checkContact({ email: "" }).map((x) => x.message), ["Your CV has no email address. Add it in Your details."]);
  assert.deepEqual(checkContact({ email: "jane@example.com", phone: "", linkedin: "", github: "", website: "" }), []);
  assert.deepEqual(checkContact(null).map((x) => x.field), ["email"]);

  const many = checkContact({ email: "Gmail", phone: "Mobile", linkedin: "LinkedIn", github: "github.com/jane", website: "" });
  assert.deepEqual(many.map((x) => x.field), ["email", "phone", "linkedin"]);
  assert.equal(contactBlockMessage(many), "Your email looks wrong: 'Gmail'. Fix it in Your details. (2 more contact details to fix.)");
});

test("emailFromText / profileUrlFromText: the one address in the text, never a guess between two", () => {
  assert.equal(emailFromText("Jane Doe\nLondon | jane@example.com | LinkedIn"), "jane@example.com");
  assert.equal(emailFromText("mailto:Jane@Example.com and again jane@example.com"), "jane@example.com", "case-folded, counted once");
  assert.equal(emailFromText("jane@example.com or work: jane@acme.co.uk"), "", "two addresses: ambiguous");
  assert.equal(emailFromText("Gmail | LinkedIn"), "");

  assert.equal(profileUrlFromText("LinkedIn: linkedin.com/in/jane-doe | GitHub: github.com/janedoe", "linkedin"), "https://linkedin.com/in/jane-doe");
  assert.equal(profileUrlFromText("LinkedIn: linkedin.com/in/jane-doe | GitHub: github.com/janedoe", "github"), "https://github.com/janedoe");
  assert.equal(profileUrlFromText("Projects\nRidex — github.com/janedoe/ridex", "github"), "", "a repository is a project's link, not the profile");
  assert.equal(profileUrlFromText("github.com/jane and github.com/other", "github"), "");
});

test("mergeProfileEdits: a stored 'Gmail' gives way to a fresh address; a good typed value still wins", () => {
  const current = { name: "Jane", email: "Gmail", phone: "07700 900123", linkedin: "LinkedIn", github: "github.com/jane" };
  const fresh = { name: "J", email: "jane@example.com", phone: "07700 111222", linkedin: "linkedin.com/in/jane", github: "github.com/other" };
  assert.deepEqual(mergeProfileEdits(current, fresh), { name: "Jane", email: "jane@example.com", phone: "07700 900123", linkedin: "linkedin.com/in/jane", github: "github.com/jane" });
  assert.equal(mergeProfileEdits({ email: "Gmail" }, { email: "Email" }).email, "Gmail", "a fresh read that also fails changes nothing");
});
