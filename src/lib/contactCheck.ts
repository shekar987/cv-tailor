// The contact details checked before they reach a CV.
//
// From 17 to 22 Oct 2026 every generated CV printed "Gmail" where the email
// address belonged: the uploaded CV's email was a link labelled "Gmail", the
// upload kept the label and lost the mailto: target, the extraction stored
// the word, and nothing checked it — about 42 applications went out with no
// way to reply. Every place a CV is generated (Customize's details, /app's
// Tailor and Download, /api/tailor, both CV download routes) now runs
// checkContact() and refuses with its message.
//
// Deliberately plain checks, not RFC parsers: the aim is to catch a word or a
// label where an address belongs, never to refuse a real address. An empty
// email is a problem (a CV nobody can reply to); an empty phone or link is
// not — those are optional.
//
// Import-free except its sibling (a relative .ts path): runs in the browser,
// the routes and under node:test.
import { cleanUrl } from "./projectLinks.ts";

export type ContactField = "email" | "phone" | "linkedin" | "github" | "website";
export type ContactProblem = { field: ContactField; value: string; message: string };
type ContactLike = { email?: unknown; phone?: unknown; linkedin?: unknown; github?: unknown; website?: unknown };

const FIELD_LABELS: Record<ContactField, string> = {
  email: "email",
  phone: "phone number",
  linkedin: "LinkedIn link",
  github: "GitHub link",
  website: "website link",
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

export function isValidEmail(raw: string): boolean {
  const s = raw.trim().replace(/^mailto:/i, "");
  return s.length <= 254 && EMAIL_RE.test(s);
}

// Digits with the usual separators and at most one leading "+"; "(0)" — the
// UK trunk prefix written after a country code — is allowed. A UK number
// (0… or +44…) has 10 or 11 national digits; any other has 7 to 15 digits
// in all (the E.164 maximum).
export function isValidPhone(raw: string): boolean {
  const s = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return false;
  const digits = s.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (s.startsWith("+44")) return digits.length - 2 >= 10 && digits.length - 2 <= 11;
  if (!s.startsWith("+") && digits.startsWith("0")) return digits.length >= 10 && digits.length <= 11;
  return true;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const PROFILE_HOSTS: Partial<Record<ContactField, string>> = { linkedin: "linkedin.com", github: "github.com" };

// A link field must be a web address (lib/projectLinks cleanUrl refuses a
// bare word such as "GitHub"); the LinkedIn and GitHub fields must also be
// on their own site (a regional host such as uk.linkedin.com counts).
export function isValidProfileUrl(raw: string, field: "linkedin" | "github" | "website"): boolean {
  const url = cleanUrl(raw);
  if (!url) return false;
  const want = PROFILE_HOSTS[field];
  if (!want) return true;
  const host = hostOf(url);
  return host === want || host.endsWith("." + want);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function checkContact(profile: ContactLike | null | undefined): ContactProblem[] {
  const p = profile ?? {};
  const out: ContactProblem[] = [];
  const email = str(p.email);
  if (!email) out.push({ field: "email", value: "", message: "Your CV has no email address. Add it in Your details." });
  else if (!isValidEmail(email)) out.push({ field: "email", value: email, message: wrong("email", email) });
  const phone = str(p.phone);
  if (phone && !isValidPhone(phone)) out.push({ field: "phone", value: phone, message: wrong("phone", phone) });
  for (const field of ["linkedin", "github", "website"] as const) {
    const v = str(p[field]);
    if (v && !isValidProfileUrl(v, field)) out.push({ field, value: v, message: wrong(field, v) });
  }
  return out;
}

function wrong(field: ContactField, value: string): string {
  const shown = value.length > 60 ? value.slice(0, 57) + "…" : value;
  return `Your ${FIELD_LABELS[field]} looks wrong: '${shown}'. Fix it in Your details.`;
}

// One sentence for a notice or a route's error: the first problem in full,
// then how many more.
export function contactBlockMessage(problems: ContactProblem[]): string {
  if (problems.length === 0) return "";
  const more = problems.length - 1;
  return more === 0 ? problems[0].message : `${problems[0].message} (${more} more contact detail${more === 1 ? "" : "s"} to fix.)`;
}

// ── Recovering an address from the CV's own text ─────────────────────────────
// The extraction backstop: when the model's field is not an address, the CV
// text may still carry exactly one (a pasted CV, or an upload whose link
// target lib/linkTargets wrote back). More than one distinct candidate is
// ambiguous and gives "" — never a guess.

const EMAIL_IN_TEXT = /[^\s@<>()[\]\\,;:"'|]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;

export function emailFromText(text: string): string {
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_IN_TEXT)) {
    const e = m[0].replace(/^mailto:/i, "");
    if (isValidEmail(e)) found.add(e.toLowerCase());
  }
  return found.size === 1 ? [...found][0] : "";
}

export function profileUrlFromText(text: string, field: "linkedin" | "github"): string {
  const host = PROFILE_HOSTS[field]!.replace(".", "\\.");
  const re = new RegExp(`(?:https?://)?(?:[a-z]{2,3}\\.|www\\.)?${host}/[^\\s|,;)\\]>"']+`, "gi");
  const found = new Map<string, string>();
  for (const m of text.matchAll(re)) {
    const url = cleanUrl(m[0]);
    if (!url || !isValidProfileUrl(url, field)) continue;
    // A repository link (github.com/user/repo) is a project's, not the
    // profile's: the profile is one path segment (github.com/user,
    // linkedin.com/in/user).
    const path = new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (field === "github" && path.length !== 1) continue;
    if (field === "linkedin" && !(path.length === 2 && path[0] === "in")) continue;
    found.set(url.toLowerCase().replace(/\/+$/, ""), url);
  }
  return found.size === 1 ? [...found.values()][0] : "";
}
