// A hyperlink's target written back into the text of an uploaded CV.
//
// lib/parseCv reads only the TEXT of a PDF or .docx: a link drawn as "Gmail"
// with mailto:jane@example.com behind it reached the master CV — and the
// extraction model — as the word "Gmail". The model stored that word as the
// email, and from 17 to 22 Oct 2026 every generated CV printed it (see
// lib/contactCheck). parseCv now collects each link's visible label and its
// target, and this rewrites the label in the extracted text:
//
//   - mailto: whose label is not itself an address → the address;
//   - http(s) whose label is a link word ("LinkedIn", "GitHub", "Portfolio",
//     "Live demo" …) → "Label: address", the form lib/projectLinks
//     linksFromText already reads under a project.
//
// Any other label (a project title, a sentence with a link inside it) is left
// exactly as written — rewriting it would change a heading the section and
// project detectors read. Links are matched in document order, each to the
// first occurrence of its label not yet rewritten, so two "GitHub" labels with
// two targets each keep their own.
//
// Import-free except its siblings (relative .ts paths): runs under node:test.
import { cleanUrl, displayUrl } from "./projectLinks.ts";
import { isValidEmail } from "./contactCheck.ts";

export type LinkTarget = { label: string; href: string };

const LINK_WORD = /^(?:my\s+)?(?:linked\s?in|github|gitlab|bitbucket|portfolio|website|web\s?site|personal\s+(?:site|website)|live(?:\s+(?:demo|site|app|link))?|demo|repo(?:sitory)?|source(?:\s+code)?|code|site|blog|profile|link|view)(?:\s+(?:profile|page|link))?$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The label's own words, whitespace-flexible, standing alone (not inside a
// longer word: "Gmail" never matches "Gmailbox").
function labelPattern(label: string): RegExp {
  const words = label.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}@.])${words}(?![\\p{L}\\p{N}@])`, "giu");
}

function mailtoAddress(href: string): string {
  if (!/^mailto:/i.test(href)) return "";
  let addr = href.slice(7).split("?")[0];
  try {
    addr = decodeURIComponent(addr);
  } catch {
    return "";
  }
  return isValidEmail(addr) ? addr.trim() : "";
}

// What the label becomes, or "" to leave it.
function replacementFor(link: LinkTarget): string {
  const label = link.label.replace(/\s+/g, " ").trim();
  if (!label) return "";
  const email = mailtoAddress(link.href);
  if (email) {
    if (isValidEmail(label) || label.toLowerCase().includes(email.toLowerCase())) return "";
    return email;
  }
  if (!/^https?:\/\//i.test(link.href.trim())) return "";
  const url = cleanUrl(link.href);
  if (!url || cleanUrl(label)) return ""; // not a web address, or the label already is one
  if (!LINK_WORD.test(label.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))) return "";
  return `${label}: ${displayUrl(url)}`;
}

export function applyLinkTargets(text: string, links: LinkTarget[]): { text: string; rewritten: number } {
  let out = text;
  let cursor = 0;
  let rewritten = 0;
  for (const link of links) {
    const replacement = replacementFor(link);
    if (!replacement) continue;
    const re = labelPattern(link.label);
    // The first occurrence at or after the previous rewrite, else the first
    // anywhere — a link annotation list is in page order, the text mostly so.
    re.lastIndex = cursor;
    let m = re.exec(out);
    if (!m) {
      re.lastIndex = 0;
      m = re.exec(out);
    }
    if (!m) continue;
    // Already followed by its address ("GitHub: github.com/x" written out
    // beside the link): nothing to add.
    if (out.slice(m.index + m[0].length).trimStart().startsWith(":") && !replacement.includes("@")) continue;
    out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    cursor = m.index + replacement.length;
    rewritten++;
  }
  return { text: out, rewritten };
}
