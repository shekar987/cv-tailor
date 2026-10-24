import test from "node:test";
import assert from "node:assert/strict";
import { applyLinkTargets } from "../src/lib/linkTargets.ts";

const header = "Jane Doe\nLondon | 07700 900123 | Gmail | LinkedIn | GitHub";

test("a mailto: behind 'Gmail' becomes the address", () => {
  const r = applyLinkTargets(header, [{ label: "Gmail", href: "mailto:jane.doe@example.com?subject=Hello" }]);
  assert.equal(r.text, "Jane Doe\nLondon | 07700 900123 | jane.doe@example.com | LinkedIn | GitHub");
  assert.equal(r.rewritten, 1);
});

test("percent-encoded mailto targets are decoded; an invalid one leaves the label", () => {
  assert.equal(applyLinkTargets("Email me", [{ label: "Email me", href: "mailto:jane%2Bcv@example.com" }]).text, "jane+cv@example.com");
  assert.equal(applyLinkTargets("Gmail", [{ label: "Gmail", href: "mailto:not-an-address" }]).text, "Gmail");
});

test("web links behind a link word gain the address; other labels stay exactly as written", () => {
  const r = applyLinkTargets(header, [
    { label: "LinkedIn", href: "https://www.linkedin.com/in/jane-doe/" },
    { label: "GitHub", href: "https://github.com/janedoe" },
  ]);
  assert.equal(r.text, "Jane Doe\nLondon | 07700 900123 | Gmail | LinkedIn: linkedin.com/in/jane-doe | GitHub: github.com/janedoe");
  // A project title with a link stays the title: rewriting it would change
  // the header line the project detector reads.
  assert.equal(applyLinkTargets("Ridex | React, Node", [{ label: "Ridex", href: "https://ridex.app" }]).text, "Ridex | React, Node");
});

test("a label that already is the address, or is already followed by it, is left alone", () => {
  assert.equal(applyLinkTargets("jane@example.com", [{ label: "jane@example.com", href: "mailto:jane@example.com" }]).rewritten, 0);
  assert.equal(applyLinkTargets("github.com/jane", [{ label: "github.com/jane", href: "https://github.com/jane" }]).rewritten, 0);
  assert.equal(applyLinkTargets("GitHub: github.com/jane", [{ label: "GitHub", href: "https://github.com/jane" }]).text, "GitHub: github.com/jane");
});

test("two 'GitHub' labels keep their own targets, in document order", () => {
  const text = "Ridex\nGitHub | Live\nAssetGuard\nGitHub";
  const r = applyLinkTargets(text, [
    { label: "GitHub", href: "https://github.com/jane/ridex" },
    { label: "Live", href: "https://ridex.vercel.app" },
    { label: "GitHub", href: "https://github.com/jane/assetguard" },
  ]);
  assert.equal(r.text, "Ridex\nGitHub: github.com/jane/ridex | Live: ridex.vercel.app\nAssetGuard\nGitHub: github.com/jane/assetguard");
});

test("a label inside a longer word is never matched; javascript: targets are ignored", () => {
  assert.equal(applyLinkTargets("Gmailbox Gmail", [{ label: "Gmail", href: "mailto:jane@example.com" }]).text, "Gmailbox jane@example.com");
  assert.equal(applyLinkTargets("Portfolio", [{ label: "Portfolio", href: "javascript:alert(1)" }]).text, "Portfolio");
});
