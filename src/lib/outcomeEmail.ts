// "Log outcome" on /applications (13 Nov 2026, Chunk 26): an outcome email read in the
// browser, with no model call. Relative imports, so it runs under node:test
// (tests/outcomeEmail, with six made-up emails in tests/fixtures/outcome-emails).
//
// On 13 Nov eight outcome emails arrived in a day and each one took a search, a status
// change and a note; two screened rows were still waiting for a confirm click that
// evening. Here the email is pasted once: readOutcomeEmail says what it reads (the
// outcome, who it names, the sentence that says so, its date), matchOutcomeRows ranks
// the user's own applications against it, and the user clicks the right one.
//
// THE RULE: when unsure, say nothing and let the user choose. The click this feeds ends an
// application, a screened one too, so a wrong read costs more than a missed one. A fresh
// review of the first version (13 Nov) read "if you have not heard from us, please assume
// you have been unsuccessful", an offer that mentioned "the other candidates" and a test
// invitation as rejections, and called a company "clearly ahead" on one loose word. So:
//
// - The outcome is "rejected" only when a sentence STATES it: a plain phrase, about this
//   application, with no "if / unless / assume / should" before it and not about other
//   people ("candidates who do not finish…"). Anything that reads like an invitation, an
//   offer or a pass, anywhere, leaves the outcome to the user.
// - A match is `sure` (the one filled button) only when TWO separate parts of the email
//   agree on the company by its whole name (the sender, the subject, the body, the
//   sign-off, the address), no other company is named that way, and one application of
//   that company is clearly ahead. One sign, a name inside a longer name, or a name found
//   loose in the text is listed for the user to judge and never called sure.
import { companyNamesMatch, normalizeCompanyName } from "./companyMatch.ts";
import { sameCompany } from "./companyRules.ts";
import { isEnding } from "./closing.ts";
import { MAX_APPENDED_NOTE } from "./notesWrite.ts";
import { dayMonthYear } from "./planTime.ts";
import { normalizeRole } from "./tracker.ts";
import { matchesSearch } from "./trackerSearch.ts";

export const MAX_OUTCOME_EMAIL_CHARS = 20_000;
export const OUTCOME_MATCH_LIMIT = 3;
export const OUTCOME_SEARCH_LIMIT = 8;
const NOTE_PREFIX = "Outcome email";
// Bounds that keep every pattern below linear on an odd paste (a line of 20,000 spaces, a
// run of dots): no line, header value or name is read past these.
const MAX_LINE_CHARS = 1000;
const MAX_HEADER_CHARS = 300;
const MAX_NAME_SCAN = 160;
const MAX_SIGNATURE_LINE = 60;

/** Where in the email a company's name was read. */
export type NameSource = "sender" | "subject" | "body" | "signoff" | "domain";
export type NamedCompany = { name: string; from: NameSource };

export type OutcomeRead = {
  /** "rejected" when a sentence states it plainly; null when the email does not, or says two things. */
  outcome: "rejected" | null;
  /** The words that said so, as the email writes them. */
  phrase: string;
  /** It reads like an invitation, an offer or a pass (alone, or beside a rejection). */
  invitation: boolean;
  /** The names it gives, in the order read: the sender, the subject, the body, the sign-off, the address. */
  companies: string[];
  /** The same names, each with where it was read. */
  named: NamedCompany[];
  /** The sentence the note quotes: the one that states the outcome, else the first one. */
  sentence: string;
  /** The day it was sent (YYYY-MM-DD), when a Date: or Sent: line says so without doubt. */
  date: string | null;
};

// ── Text ────────────────────────────────────────────────────────────────────

function tidy(text: string): string {
  return text
    .slice(0, MAX_OUTCOME_EMAIL_CHARS)
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[   \t]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    // Runs of spaces, and of one punctuation mark, are layout: folded, they can't make a pattern crawl.
    .replace(/ {2,}/g, " ")
    .replace(/([.,!?'"_=*~#>-])\1{3,}/g, "$1$1$1")
    .split("\n")
    .map((line) => line.slice(0, MAX_LINE_CHARS))
    .join("\n");
}

const HEADER_RE = /^ ?(from|to|cc|bcc|subject|date|sent|received|reply-to) ?: ?(.*)$/i;
// A sender written the way a mail client shows it, on a line of its own: Name <address>.
const SENDER_LINE_RE = /^ ?"?([^"<>\n]{1,80}?)"? ?<([^<>\s@]{1,100}@[^<>\s@]{1,200})> ?$/;
const ADDRESS_RE = /[^\s<>@]{1,100}@[^\s<>@]{1,200}/;
const GREETING_RE = /^ ?(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^\n]{0,60}$/i;

type Parts = { sender: string; address: string; subject: string; dateLine: string; body: string };

function splitParts(text: string): Parts {
  const lines = text.split("\n");
  const parts: Parts = { sender: "", address: "", subject: "", dateLine: "", body: "" };
  let i = 0;
  // The top of a pasted email: header lines, a "Name <address>" line, "to me", blanks.
  for (; i < lines.length && i < 12; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const header = HEADER_RE.exec(line);
    if (header) {
      const name = header[1].toLowerCase();
      const value = header[2].trim().slice(0, MAX_HEADER_CHARS);
      if (name === "from") {
        const m = SENDER_LINE_RE.exec(value);
        parts.sender = m ? m[1].trim() : value.includes("@") ? "" : value;
        parts.address = m ? m[2] : (ADDRESS_RE.exec(value)?.[0] ?? "");
      } else if (name === "subject") parts.subject = value;
      else if (name === "date" || name === "sent" || name === "received") parts.dateLine ||= value;
      continue;
    }
    const sender = !parts.sender && !parts.address ? SENDER_LINE_RE.exec(line.slice(0, MAX_HEADER_CHARS)) : null;
    if (sender) {
      parts.sender = sender[1].trim();
      parts.address = sender[2];
      continue;
    }
    if (/^ ?to (me|[^\s@]+@\S+) ?$/i.test(line)) continue;
    break;
  }
  parts.body = lines.slice(i).join("\n");
  return parts;
}

/** The body's sentences, greeting and quoted lines aside. */
function sentencesOf(body: string): string[] {
  const out: string[] = [];
  for (const block of body.split(/\n *\n/)) {
    const lines = block.split("\n").filter((l) => l.trim() && !/^ ?>/.test(l));
    if (lines.length === 0) continue;
    if (GREETING_RE.test(lines[0]) && lines[0].trim().split(" ").length <= 6) lines.shift();
    const para = lines.join(" ").replace(/ {2,}/g, " ").trim();
    if (!para) continue;
    // A sentence ends before a capital, a quote or a bracket; never inside "i.AI" or "e.g. x".
    for (const s of para.split(/(?<=[.!?]) (?=["'(]?[A-Z])/)) {
      const sentence = s.trim();
      if (sentence) out.push(sentence);
    }
  }
  return out;
}

// ── The outcome ─────────────────────────────────────────────────────────────

// What a rejection states. Each is read inside ONE sentence, and counts only when stated()
// below agrees: nothing conditional before it, and not about other people.
const REJECTION_RES: readonly RegExp[] = [
  // "we won't be taking it forward", "will not be progressing your application any further"
  /\b(?:won't|will not|wouldn't|would not|are not|aren't|unable to|not able to|not be able to|cannot|can't)\b[^.!?]{0,14}?\b(?:tak|progress|proceed|mov|advanc|continu)\w*\b[^.!?]{0,60}?\b(?:forward|further|ahead|your application|your candidacy)\b/i,
  // "decided not to progress", "the decision not to proceed"
  /\b(?:decided|chosen|opted|decision)\b[^.!?]{0,12}?\bnot to (?:progress|proceed|move|take|continue|advance|pursue|shortlist|offer)\b/i,
  // "your application has been unsuccessful", "you have not been selected"
  /\b(?:you|your application|your candidacy|your interview|application)\b[^.!?]{0,50}?\b(?:unsuccessful|not (?:been )?successful|not (?:been )?(?:selected|shortlisted))\b/i,
  // "sadly it is not this time"; a sentence that is "Not this time, I'm afraid."
  /\b(?:it's|it is|sadly|unfortunately|afraid|sorry)\b[^.!?]{0,40}?\bnot (?:this|on this) (?:time|occasion)\b/i,
  /^\W{0,3}not (?:this|on this) (?:time|occasion)\b/i,
  // "decided to move forward with other candidates", "offered the role to another candidate"
  /\b(?:mov\w+|proceed\w*|progress\w*|going|gone|went|go|continu\w+|pursu\w+|chose|chosen|selected|offered|appointed|hired)\b[^.!?]{0,40}?\b(?:other|another|a different) (?:candidates?|applicants?)\b/i,
  // "other candidates whose experience more closely matches"
  /\b(?:other|another) (?:candidates?|applicants?) (?:whose|who|that)\b[^.!?]{0,60}?\b(?:more closely|closer|better)\b/i,
  // "we regret to inform you"
  /\bregret(?:fully|tably)?\b[^.!?]{0,40}?\b(?:inform|say|tell|advise|let you know)\b/i,
  // "we feel you are not the right fit"
  /\b(?:you|your|we|this)\b[^.!?]{0,60}?\bnot (?:quite )?(?:the right|a good|the best|a) (?:fit|match)\b/i,
];
// Before the phrase, in its own sentence: it is a condition, a guess or an instruction, not news.
const HEDGE_RE = /\b(?:if|unless|should|assume|whether|in case|in the event|until|otherwise|may|might|when)\b/i;
// The sentence is about other people: "candidates who do not finish in time will not be progressing".
const OTHERS_RE = /\b(?:candidates?|applicants?|those|anyone|people|everyone)\b[^.!?]{0,12}?\b(?:who|that|will|are|were)\b/i;

/** The rejection a sentence STATES, or "": a phrase with nothing conditional before it, about this application. */
function stated(sentence: string): string {
  for (const re of REJECTION_RES) {
    const m = re.exec(sentence);
    if (!m) continue;
    // A hedge before the phrase or inside it ("you may be unsuccessful"); one after it changes nothing.
    if (HEDGE_RE.test(sentence.slice(0, m.index + m[0].length)) || OTHERS_RE.test(sentence.slice(0, m.index))) continue;
    return m[0].replace(/ {2,}/g, " ").trim();
  }
  return "";
}

// What an invitation, an offer or a pass says. A rejection that invites the reader to "apply
// again" or offers feedback is none of these: it has to be a call, an interview, a test, a
// stage, or the job itself.
const INVITATION_RES: readonly RegExp[] = [
  /\binvit(?:e|ed|ing|ation)\b[^.!?]{0,60}?\b(?:interview|call|assessment|next stage|next round|next step|test|chat|conversation|meet(?:ing)?|video)\b/i,
  /\b(?:pleased|delighted|happy|excited|thrilled|glad) to (?:offer you|invite|move you|progress you|confirm|let you know that you|inform you that you)\b/i,
  /\b(?:would|'d) like to (?:offer you (?:the|a|an)|invite|move you|progress you|arrange|schedule|book)\b/i,
  /\boffer you (?:the|a|an) (?:position|role|job|place|contract|internship|placement)\b/i,
  /\bcongratulations\b/i,
  /\b(?:offer of employment|job offer|formal offer|offer letter)\b/i,
  /\b(?:you have|you've|you) (?:been successful|progressed|passed|made it|been shortlisted|been selected)\b/i,
  /\bsuccessful (?:at|in) (?:this|the|your)\b/i,
  /\b(?:move|moving|progress|progressing|put|take|taking) you (?:forward |through )?to the next\b/i,
  /\b(?:schedule|book|arrange) (?:a|an|your)(?: \w+)? (?:call|interview|slot|time)\b/i,
  /\b(?:please|you can now|you will need to|you'll need to|like you to|asked to|ready to) (?:complete|take|sit|start)\b[^.!?]{0,30}?\b(?:assessment|test|challenge|exercise|questionnaire)\b/i,
  /\b(?:here is|here's|below is) your\b[^.!?]{0,30}?\b(?:link|invitation|assessment|test)\b/i,
];

// ── Who it names ────────────────────────────────────────────────────────────

// Tools that send on a company's behalf: never the company.
const SENDING_TOOLS = new Set([
  "ashby", "ashbyhq", "greenhouse", "lever", "workable", "smartrecruiters", "teamtailor", "aiapply", "workday", "myworkday", "myworkdayjobs",
  "linkedin", "indeed", "bamboohr", "gem", "icims", "jobvite", "taleo", "successfactors", "pinpoint", "pinpointhq", "recruitee",
  "breezy", "personio", "jazzhr", "applytojob", "otta", "welcome to the jungle", "reed", "totaljobs", "cv library", "glassdoor", "gmail",
  "googlemail", "outlook", "hotmail", "yahoo", "icloud", "proton", "protonmail", "mail", "email",
]);
// A tool by its own name, or by its mail host's: "teamtailor-mail", "greenhouse mail".
function isSendingTool(label: string): boolean {
  const core = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (SENDING_TOOLS.has(core)) return true;
  const stripped = core.replace(/\b(?:mail|hq|jobs|app|notifications?|recruiting)\b/g, " ").replace(/ {2,}/g, " ").trim();
  return stripped !== core && SENDING_TOOLS.has(stripped);
}
// Words a sender's name carries beside the company's: "Nevis Hiring Team", "AJ Bell Recruitment".
const TEAM_WORDS_RE = /\b(?:the|talent acquisition|talent|recruit(?:ing|ment|ers?)?|careers?|hiring|people|human resources|hr|team|jobs|notifications?|no-?reply|do-?not-?reply|early careers|early talent|graduates?|resourcing|applications?|candidates?|experience|updates?|support)\b/gi;
const GENERIC_LABELS = new Set(["jobs", "mail", "email", "noreply", "no-reply", "notifications", "notification", "careers", "career", "app", "www", "hello", "info", "talent", "recruiting", "recruitment", "hire", "hiring", "apply", "candidates", "updates", "mailer", "send", "em", "e", "m", "t", "eu", "us", "uk"]);
// Words that follow "at", "to", "from" or "with" in an ordinary sentence and name nobody.
const NOT_A_NAME = new Set([
  "the", "this", "that", "these", "those", "our", "us", "your", "you", "a", "an", "any", "all", "least", "once", "time", "present", "which", "me",
  "it", "for", "work", "first", "last", "some", "such", "their", "them", "we", "i", "be", "have", "apply", "future", "next", "each", "every",
  "home", "hand", "length", "interview", "now", "date", "do", "discuss", "hear", "keep", "let", "make", "move", "see", "take", "wish", "inform",
  "thank", "learn", "meet", "share", "consider", "review", "progress", "proceed", "regards", "best", "kind", "many", "other", "another", "more",
]);
// A job, not an employer: "Your application to Software Engineer at Acme" names Acme.
const ROLE_WORD_RE = /\b(?:engineer|developer|analyst|manager|consultant|designer|scientist|architect|administrator|officer|specialist|associate|assistant|intern|internship|graduate|programme|program|scheme|placement|apprentice|apprenticeship|role|position|vacancy|trainee)\b/i;
const CONNECTOR_RE = /^(?:&|and|of|for|the|de|du|la)$/i;

/** A name as a sentence writes it: capitalised words, or ones with a capital or a dot inside ("i.AI", "monday.com"). */
function nameAt(rest: string): string {
  const words = rest.slice(0, MAX_NAME_SCAN).split(" ");
  const kept: string[] = [];
  for (let i = 0; i < words.length && kept.length < 5; i++) {
    const raw = words[i].slice(0, 40);
    const open = raw.replace(/^[("']{1,3}/, "");
    const word = open.replace(/[)"',;:!?]{1,3}$/, "");
    const bare = word.endsWith(".") ? word.slice(0, -1) : word;
    if (!bare) break;
    const connector = CONNECTOR_RE.test(bare) && kept.length > 0;
    const nameLike = /^[A-Z0-9]/.test(bare) || /[a-z][A-Z]/.test(bare) || /^[a-z][\w-]*\.[A-Za-z]{2,}$/.test(bare);
    if (kept.length === 0 && (NOT_A_NAME.has(bare.toLowerCase()) || !nameLike)) break;
    if (!nameLike && !connector) break;
    kept.push(bare);
    // The sentence's own punctuation ends the name; a dot inside it ("J.P.") does not.
    if (/[,;:!?)]$/.test(raw) || (raw.endsWith(".") && !/^[A-Z]\.$/.test(open))) break;
  }
  // A connector left hanging at the end names nothing.
  while (kept.length && CONNECTOR_RE.test(kept[kept.length - 1])) kept.pop();
  return kept.join(" ");
}

function cleanSender(name: string): string {
  let text = name.replace(/["']/g, "").trim();
  // "Priya at Harbourline", "Priya from Harbourline": the company is what follows.
  const person = /^[A-Z][\w'-]{0,30}(?: [A-Z][\w'-]{0,30})? (?:at|from|@|\|) (.{1,80})$/.exec(text);
  if (person) text = person[1];
  // "Harbourline via Ashby", "Harbourline (via Teamtailor)".
  const via = text.search(/\(?\bvia\b/i);
  if (via >= 0) text = text.slice(0, via);
  return text.replace(TEAM_WORDS_RE, " ").replace(/[|·•,()–—-]/g, " ").replace(/ {2,}/g, " ").trim();
}

function addName(list: NamedCompany[], value: string, from: NameSource) {
  const name = value.replace(/ {2,}/g, " ").replace(/^[ .,'"-]{1,5}/, "").replace(/[ .,'"-]{1,5}$/, "").trim();
  if (!name || name.length > 60) return;
  const key = normalizeCompanyName(name);
  if (!key || isSendingTool(name) || ROLE_WORD_RE.test(name)) return;
  if (name.split(" ").every((w) => NOT_A_NAME.has(w.toLowerCase()))) return;
  if (list.some((c) => c.from === from && normalizeCompanyName(c.name) === key)) return;
  list.push({ name, from });
}

// A word that leads to a company's name. "in" is left out on purpose: it leads to a team or
// a town ("the Graduate role in London"), and London is not the London Stock Exchange.
const DIRECT_CUE_RE = /\b(?:update|news|message|decision|response|reply) from |\b(?:role|position|job|vacancy|opportunity|programme|program|scheme|internship|placement|team) (?:at|with) |\b(?:here at|everyone at|all of us at|on behalf of|team at|careers at) /gi;
const APPLY_WORD_RE = /\b(?:application|applying|applied|apply|interest|candidacy)\b/gi;
const AFTER_APPLY_RE = /\b(?:to|at|with) /gi;

function namesIn(text: string, from: NameSource, found: NamedCompany[]) {
  DIRECT_CUE_RE.lastIndex = 0;
  for (let m = DIRECT_CUE_RE.exec(text); m; m = DIRECT_CUE_RE.exec(text)) addName(found, nameAt(text.slice(m.index + m[0].length)), from);
  // "your application for the X role at Y", "applying to Y": every "to / at / with" in the 80
  // characters after the word is tried, so a job title in between does not hide the employer.
  APPLY_WORD_RE.lastIndex = 0;
  for (let m = APPLY_WORD_RE.exec(text); m; m = APPLY_WORD_RE.exec(text)) {
    const start = m.index + m[0].length;
    const window = text.slice(start, start + 80);
    AFTER_APPLY_RE.lastIndex = 0;
    for (let p = AFTER_APPLY_RE.exec(window); p; p = AFTER_APPLY_RE.exec(window)) addName(found, nameAt(text.slice(start + p.index + p[0].length)), from);
  }
}

function domainName(address: string): string {
  const domain = address.split("@")[1]?.toLowerCase().replace(/[>. ]{1,3}$/, "") ?? "";
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  // The registrable label: before ".com", or before ".co.uk" and its like.
  const twoPart = labels.length >= 3 && /^(co|com|org|ac|gov|net)$/.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2;
  const at = labels.length - (twoPart ? 3 : 2);
  const main = labels[at];
  if (!isSendingTool(main)) return GENERIC_LABELS.has(main) ? "" : main;
  // A tool's own host: the company is the label in front, when there is one.
  return labels.slice(0, at).reverse().find((l) => !GENERIC_LABELS.has(l) && !isSendingTool(l)) ?? "";
}

const SIGNOFF_RE = /^(?:the )?([A-Z][\w&.' -]{1,40}?) (?:(?:talent|recruit\w{0,6}|hiring|people|careers|early careers|resourcing) )?team$/i;

function namedIn(parts: Parts, sentences: readonly string[]): NamedCompany[] {
  const found: NamedCompany[] = [];
  addName(found, cleanSender(parts.sender), "sender");
  namesIn(parts.subject, "subject", found);
  for (const sentence of sentences) namesIn(sentence, "body", found);
  // The sign-off: "The Harbourline Team", "Harbourline Talent Team".
  for (const line of lastLines(parts.body, 12)) {
    const m = SIGNOFF_RE.exec(line);
    if (m) addName(found, cleanSender(m[1]), "signoff");
  }
  // The signature: each part of a short closing line ("Co-founder, Harbourline", "Priya | Tidewell").
  // A whole part must be the name: "Team" is not named by "The Quillstone Talent Team".
  for (const line of lastLines(parts.body, 4)) {
    if (line.length > MAX_SIGNATURE_LINE || /[.!?]$/.test(line)) continue;
    for (const part of line.split(/[,|·•–—]| - | at /)) addName(found, cleanSender(part), "signoff");
  }
  addName(found, domainName(parts.address), "domain");
  return found.slice(0, 24);
}

function lastLines(body: string, count: number): string[] {
  return body.split("\n").map((l) => l.trim()).filter(Boolean).slice(-count);
}

// ── The date ────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A date line's day, only when it states the year and can be read one way: "Thu, 13 Nov 2026
 * 10:02", "13 November 2026", "2026-11-13", "13/11/2026". "11/03/2026" is 11 March here and
 * 3 November in the US, so it is not read at all: the panel then offers today, which the user
 * can change.
 */
export function readEmailDate(line: string): string | null {
  const text = line.trim().slice(0, MAX_HEADER_CHARS);
  let m = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(text);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})(?:st|nd|rd|th)?,? ([A-Za-z]{3,9})\.?,? (\d{4})\b/.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(+m[3], month + 1, +m[1]);
  }
  m = /\b([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b/.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(+m[3], month + 1, +m[2]);
  }
  m = /(?<!\d)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?!\d)/.exec(text);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) return iso(+m[3], b, a);
    if (b > 12 && a <= 12) return iso(+m[3], a, b);
    return a === b ? iso(+m[3], a, b) : null;
  }
  return null;
}

// ── The read ────────────────────────────────────────────────────────────────

/** What a pasted email says, or as little as it lets us be sure of. Never a guess at the outcome. */
export function readOutcomeEmail(raw: string): OutcomeRead {
  const text = tidy(typeof raw === "string" ? raw : "");
  const parts = splitParts(text);
  const sentences = sentencesOf(parts.body);
  const judged = parts.subject ? [parts.subject, ...sentences] : sentences;
  let phrase = "";
  let statedIn = "";
  let invitation = false;
  for (const sentence of judged) {
    const rejection = stated(sentence);
    if (rejection) {
      if (!phrase) {
        phrase = rejection;
        statedIn = sentence;
      }
      continue;
    }
    // A sentence that states a rejection is not also an invitation ("…not to progress it to the next stage").
    if (!invitation && INVITATION_RES.some((re) => re.test(sentence))) invitation = true;
  }
  const named = namedIn(parts, sentences);
  const companies: string[] = [];
  for (const n of named) if (!companies.some((c) => normalizeCompanyName(c) === normalizeCompanyName(n.name))) companies.push(n.name);
  return {
    outcome: phrase && !invitation ? "rejected" : null,
    phrase,
    invitation,
    companies,
    named,
    sentence: statedIn || sentences[0] || "",
    date: parts.dateLine ? readEmailDate(parts.dateLine) : null,
  };
}

/** "Outcome email 13 Nov 2026: <sentence>", within the cap one appended note may have. */
export function outcomeNoteLine(date: string, sentence: string): string {
  const head = `${NOTE_PREFIX} ${dayMonthYear(date)}`;
  const quote = sentence.replace(/\s+/g, " ").trim();
  if (!quote) return `${head}.`;
  const room = MAX_APPENDED_NOTE - head.length - 2;
  return `${head}: ${quote.length > room ? `${quote.slice(0, room - 1).trimEnd()}…` : quote}`;
}

/** The note for an outcome picked by hand, with no email: "Outcome 13 Nov 2026: Rejected. <the user's words>". */
export function manualOutcomeNoteLine(date: string, label: string, words: string = ""): string {
  const head = `Outcome ${dayMonthYear(date)}: ${label}.`;
  const extra = words.replace(/\s+/g, " ").trim();
  if (!extra) return head;
  const room = MAX_APPENDED_NOTE - head.length - 1;
  return `${head} ${extra.length > room ? `${extra.slice(0, room - 1).trimEnd()}…` : extra}`;
}

export type NextStep = { kind: "due" | "followups" | "apply"; text: string; action: string };

/**
 * One thing to do after an outcome is logged, so the user leaves with an action and not only a
 * closed application: what is due in the next 48 hours first, then today's follow-ups, else
 * the next application.
 */
export function nextStepAfterOutcome(counts: { dueSoon: number; followupsToday: number }): NextStep {
  if (counts.dueSoon > 0) {
    const one = counts.dueSoon === 1;
    return { kind: "due", text: one ? "1 thing is due in the next 48 hours." : `${counts.dueSoon} things are due in the next 48 hours.`, action: one ? "Show it" : "Show them" };
  }
  if (counts.followupsToday > 0) {
    const one = counts.followupsToday === 1;
    return { kind: "followups", text: one ? "1 follow-up is due today." : `${counts.followupsToday} follow-ups are due today.`, action: one ? "Show it" : "Show them" };
  }
  return { kind: "apply", text: "Nothing else is due today. A good next step is one more application.", action: "Tailor a CV" };
}

// ── Which application ───────────────────────────────────────────────────────

export type OutcomeRow = { id: string; company_name: string; role: string; status: unknown; date_applied?: string | null };
export type OutcomeMatch<R extends OutcomeRow> = {
  row: R;
  score: number;
  /** How many separate parts of the email name this company by its whole name (0 = a loose match). */
  signs: number;
  /** Why it is listed, in words. */
  why: string;
  /** It has already ended (rejected, withdrawn, no reply). */
  ended: boolean;
};

const SCORE_SIGN = 30;
const SCORE_LOOSE = 15;
const SCORE_ROLE = 20;
const SCORE_LIVE = 10;
// Sure: two parts of the email agree, and the next application of that company is this far behind.
const SURE_SIGNS = 2;
const SURE_GAP = 20;

function folded(text: string): string {
  return ` ${text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The name exactly as the row spells it, capitals and all, as words of its own. */
function spelledIn(text: string, name: string): boolean {
  const exact = name.trim();
  return exact.length >= 2 && exact.length <= 80 && new RegExp(`(?<![A-Za-z0-9])${escapeRe(exact)}(?![A-Za-z0-9])`).test(text);
}

/**
 * The user's applications this email may be about, best first, at most `limit`, with how
 * many more there were. A row is listed when the email names its company; how it does so
 * decides how far it is trusted:
 *
 * - a SIGN is one part of the email (the sender, the subject, a "role at X" in the body,
 *   the sign-off or signature, the address) giving the company's whole name (lib/companyRules
 *   sameCompany: "Wise" is not "Wise Owl Consulting", and a sender called Hannah Wise is not
 *   Wise);
 * - a LOOSE match is a name inside a longer one, or the row's own spelling found somewhere
 *   in the text ("Next" is also a word): listed, never trusted.
 *
 * The role in the email and an open application rank a row higher; the newest breaks a tie.
 * `sure` is true only when the top row has two signs, is open, no other company has any
 * sign, and no other application of the same company is close behind.
 */
export function matchOutcomeRows<R extends OutcomeRow>(
  rows: readonly R[],
  raw: string,
  read: OutcomeRead = readOutcomeEmail(raw),
  limit: number = OUTCOME_MATCH_LIMIT
): { matches: OutcomeMatch<R>[]; sure: boolean; more: number } {
  const text = tidy(typeof raw === "string" ? raw : "");
  const haystack = folded(text);
  const scored: OutcomeMatch<R>[] = [];
  for (const row of rows) {
    if (!normalizeCompanyName(row.company_name)) continue;
    const signs = new Set<NameSource>(read.named.filter((n) => sameCompany(n.name, row.company_name)).map((n) => n.from)).size;
    const loose = signs === 0 && (read.named.some((n) => companyNamesMatch(n.name, row.company_name)) || spelledIn(text, row.company_name));
    if (!signs && !loose) continue;
    let score = signs ? signs * SCORE_SIGN : SCORE_LOOSE;
    let why = signs >= SURE_SIGNS ? "The email is from this company" : signs ? "The email names this company" : "The email may mean this company";
    const role = normalizeRole(row.role);
    if (role && (role.includes(" ") || role.length >= 6) && haystack.includes(` ${role} `)) {
      score += SCORE_ROLE;
      why += " and this role";
    }
    const ended = isEnding(row.status);
    if (!ended) score += SCORE_LIVE;
    scored.push({ row, score, signs, why: `${why}.`, ended });
  }
  scored.sort((a, b) => b.score - a.score || (b.row.date_applied ?? "").localeCompare(a.row.date_applied ?? "") || a.row.company_name.localeCompare(b.row.company_name));
  // Once two parts of the email agree on a company, a name found loose in the text is noise
  // ("The Quillstone Talent Team" is not an application to a company called Team). On one
  // sign nothing is hidden: the real company may be the loose one.
  const agreed = scored.length > 0 && scored[0].signs >= SURE_SIGNS;
  const kept = agreed ? scored.filter((m) => m.signs > 0) : scored;
  const matches = kept.slice(0, Math.max(1, limit));
  const top = kept[0];
  const sure =
    !!top &&
    top.signs >= SURE_SIGNS &&
    !top.ended &&
    kept.slice(1).every((m) => sameCompany(m.row.company_name, top.row.company_name) && top.score - m.score >= SURE_GAP);
  return { matches, sure, more: kept.length - matches.length };
}

/** The search box: the tracker's own matcher (company, role, date applied), open applications first. */
export function searchOutcomeRows<R extends OutcomeRow>(rows: readonly R[], query: string, limit: number = OUTCOME_SEARCH_LIMIT): R[] {
  if (!query.trim()) return [];
  return rows
    .filter((r) => matchesSearch(r, query))
    .sort((a, b) => Number(isEnding(a.status)) - Number(isEnding(b.status)) || (b.date_applied ?? "").localeCompare(a.date_applied ?? ""))
    .slice(0, Math.max(1, limit));
}
