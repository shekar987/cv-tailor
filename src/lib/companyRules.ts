// Company cooldown rules (10 Nov 2026, Chunk 21; imports ./companyMatch.ts, ./tracker.ts,
// ./planTime.ts and jdTriage's types; tests/safeNotes).
//
// What a company said about applying again — "wait at least one year", "no new
// applications this intake year", "90 days", not the same role again — kept as a rule
// (table company_rules, migration 20261110120000) and checked by JD triage with the
// user's own rows for that company, before any credit is spent. On 10 Nov the sweep
// tailored four roles it could never apply to; the tracker already knew.
//
// A wrong rule is a false "Skip" on a real job, so the reading leans safe (the review of
// 10 Nov found ordinary rejection wording turning into permanent blocks):
// - readCooldowns() marks a draft `sure` only for a wait tied to applying again in the same
//   clause ("wait at least one year before applying again", "re-apply after 90 days"). Only
//   a sure draft is ever saved without the user's click, and only from text appended to the
//   notes. An intake year, "this year", the same role, or a posting's own rule are offered
//   on the row for one click, never saved on their own.
// - A date is never guessed: "this intake year" comes back needing one (the next 1 September
//   is offered for the user to change).
// - Rules match a company by its whole name (sameCompany: "Wise" is not "Wise Owl
//   Consulting") and a role by its whole title (sameRole: "Software Engineer" is not
//   "Software Engineer in Test"), a trailing place aside ("… - London", "(Remote)").
// checkCompanyRules() answers TriageHits, so the badge /app already shows says
// "Skip: reapply after 5 Jul 2027, from "wait at least one year"".
import { normalizeCompanyName } from "./companyMatch.ts";
import { STATUS_LABELS, normalizeStatus, type Status } from "./tracker.ts";
import { addDays, dayMonthYear } from "./planTime.ts";
import type { JdTriage, TriageHit } from "./triage/jdTriage.ts";

export const RULE_TYPES = ["reapply_after_days", "no_reapply_until", "same_role_block"] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  reapply_after_days: "Wait before reapplying",
  no_reapply_until: "No new applications until",
  same_role_block: "Not the same role again",
};
export const MAX_RULE_DAYS = 3650;
export const MAX_ACTIVE_RULES = 500;
const MAX_SOURCE_CHARS = 500;
const MAX_NAME_CHARS = 200;
const REASON_SOURCE_CHARS = 80;

export type CompanyRule = {
  id?: string;
  company_key?: string;
  company_name: string;
  rule_type: RuleType;
  value: string;
  // Where the days of reapply_after_days count from; null = the latest application on record.
  anchor_date?: string | null;
  source_text?: string | null;
  source?: "manual" | "notes" | "seed";
  application_id?: string | null;
  created_at?: string;
  dismissed_at?: string | null;
};

/** A rule read off some text, before it is saved. */
export type RuleDraft = {
  rule_type: RuleType;
  // null when the text cannot say: the date of "this intake year", or the role (the caller's row has it).
  value: string | null;
  anchor_date: string | null;
  source_text: string;
  // Safe to save without asking: a wait tied to applying again in the same clause.
  sure: boolean;
  // A posting's "if you applied for this position in the last 6 months": the role, not the company.
  scope?: "company" | "role";
  needs?: "date" | "role";
  // For needs "date": the next 1 September, offered for the user to change.
  suggested?: string;
};

export function companyKey(name: string | null | undefined): string {
  return normalizeCompanyName(name);
}

// Words a company's name carries or drops depending on who writes it.
const CORPORATE_WORDS = new Set(["s", "p", "a", "spa", "ag", "sa", "se", "bv", "nv", "llp", "lp", "uk", "group", "holdings", "plc", "ltd", "limited", "inc", "gmbh", "co", "corp", "corporation", "the", "llc"]);

/** The same company, by its whole name: "Bending Spoons S.p.A." is "Bending Spoons", "Eleven Labs" is "ElevenLabs", "Wise" is not "Wise Owl Consulting". */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (s: string | null | undefined) =>
    normalizeCompanyName(s)
      .split(" ")
      .filter((t) => t && !CORPORATE_WORDS.has(t))
      .join("");
  const x = key(a);
  return x.length > 0 && x === key(b);
}

// A trailing part of a title that only says where: "- London", "(Remote)", ", UK".
const PLACE_WORDS = new Set([
  "london", "remote", "hybrid", "uk", "united", "kingdom", "england", "scotland", "wales", "ireland", "manchester", "edinburgh",
  "bristol", "cambridge", "oxford", "leeds", "birmingham", "glasgow", "belfast", "cardiff", "reading", "sheffield", "newcastle",
  "nottingham", "liverpool", "brighton", "onsite", "on", "site", "office", "based", "emea", "europe", "eu", "flexible", "or", "and",
]);

function roleKey(role: unknown): string {
  const text = typeof role === "string" ? role.toLowerCase().replace(/&/g, " and ") : "";
  const parts = text.split(/\s[-–—|]\s|[,()[\]/:]/).map((p) => p.replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean);
  while (parts.length > 1 && parts[parts.length - 1].split(" ").every((w) => PLACE_WORDS.has(w))) parts.pop();
  return parts.join(" ");
}

/** The same job, by its whole title, a trailing place aside: "Junior Data Platform Engineer - London" is "Junior Data Platform Engineer"; "Software Engineer in Test" is not "Software Engineer". */
export function sameRole(a: unknown, b: unknown): boolean {
  const x = roleKey(a);
  return x.length > 0 && x === roleKey(b);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The first 1 September after the day: when a UK graduate intake usually opens again. */
export function nextSeptember(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return `${m < 9 ? y : y + 1}-09-01`;
}

// --- Reading the phrases ---------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, eighteen: 18, "twenty-four": 24,
};
const NUM = String.raw`(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty-four)`;
const UNIT = String.raw`(days?|weeks?|months?|years?)`;
const DURATION = String.raw`(?:at\s+least\s+|a\s+minimum\s+of\s+|minimum\s+of\s+|a\s+full\s+)?${NUM}(?:\s+|-)(?:full\s+|calendar\s+)?${UNIT}`;
// Applying again, said outright.
const AGAIN = String.raw`(?:re-?appl(?:y|ying|ication)|appl(?:y|ying)\s+(?:to\s+us\s+|with\s+us\s+)?again|submit(?:ting)?\s+(?:a\s+)?(?:new|another|further)\s+application|be\s+considered\s+(?:again|for\s+(?:a\s+)?(?:new|another|further)\s+application))`;
// One clause: no comma, semicolon or colon, and no "and / but / however" starting another.
const CLAUSE = String.raw`(?:(?![,;:]|\b(?:and|but|however|while|whereas|although)\b)[^.!?\n])`;
// "wait at least one year before applying again", "for 12 months before you can reapply".
const WAIT_THEN_AGAIN_RE = new RegExp(String.raw`\b(?:wait|after|for|in|within|until)\s+(?:the\s+next\s+)?${DURATION}\b${CLAUSE}{0,40}?\b${AGAIN}\b`, "i");
// "re-apply after 90 days", "apply again in 6 months", "do not reapply within the next 12 months".
const AGAIN_THEN_WAIT_RE = new RegExp(String.raw`\b${AGAIN}\b${CLAUSE}{0,30}?\b(?:after|in|once|within|until|for)\s+(?:the\s+next\s+|a\s+period\s+of\s+)?${DURATION}\b`, "i");
// "we won't accept new applications from you for 12 months": a refusal of the candidate's next
// application, with how long, in one clause. "We are not accepting further applications for
// our 12-month programme" is about the programme, and never matches.
const REFUSED_FOR_RE = new RegExp(String.raw`\b(?:won['’]t|will\s+not|cannot|can['’]t|unable\s+to|do\s+not|don['’]t)\s+(?:be\s+able\s+to\s+)?(?:accept|consider|review)\s+(?:any\s+)?(?:new|further|another|future)\s+applications?\b(?:\s+from\s+you)?${CLAUSE}{0,20}?\b(?:for|within|in)\s+(?:the\s+next\s+)?${DURATION}\b`, "i");
// A posting's "if you (have) applied (for this position) in the last 6 months, please do not reapply".
const BACKWARD_RE = new RegExp(String.raw`\b(?:you|candidates|applicants|anyone|those|people)\s+(?:who\s+)?(?:have\s+|has\s+|had\s+)?(?:previously\s+|already\s+|recently\s+)?applied\b(${CLAUSE}{0,60}?)\b(?:in|within|during|over)\s+the\s+(?:last|past|previous)\s+(?:${DURATION}|(day|week|month|year))\b`, "i");
const REFUSE_RE = /\b(?:do\s+not|don['’]t|will\s+not|won['’]t|cannot|can['’]t|unable\s+to|not\s+(?:be\s+)?(?:able|eligible|considered)|ineligible)\b/i;
const THIS_ROLE_RE = /\b(?:this|the\s+same)\s+(?:role|position|vacancy|job|opening)\b/i;
// "we won't be able to accept any new applications from you this intake year".
const MORE_APPLICATIONS_RE = /\b(?:accept|consider|take|progress)\b[^.!?\n]{0,30}?\b(?:any\s+)?(?:new|further|another|more)\s+applications?\b|\bapplications?\s+from\s+you\b/i;
const INTAKE_RE = /\b(?:this|the\s+current)\s+(?:(intake|recruitment|hiring|application|graduate|academic|calendar)\s+)?(year|cycle|season|round|intake|campaign|period)\b/i;
// "we can't consider further applications from you for this role" — never beside an invitation.
const SAME_ROLE_RE = new RegExp(String.raw`\b(?:do\s+not|don['’]t|cannot|can['’]t|won['’]t\s+be\s+able\s+to|will\s+not\s+be\s+able\s+to|unable\s+to|not\s+be\s+able\s+to)\s+(?:${AGAIN}|consider|accept)\b${CLAUSE}{0,50}?\b(?:for|to)\s+(?:this|the\s+same)\s+(?:role|position|vacancy|job)\b`, "i");
const INVITATION_RE = /\b(?:however|encourage|welcome|other\s+(?:roles|positions|opportunities|vacancies))\b/i;
const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// A line's own date: "10 Nov 2026 16:22 …" (stampNoteLine), "10 Nov 2026: …", "2026-11-10 …".
const STAMP_RE = /^\s*(?:(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})|(\d{4}-\d{2}-\d{2}))\b(?:\s+\d{1,2}:\d{2})?\s*:?\s*/i;

function unitDays(n: number, unit: string): number {
  const u = unit.toLowerCase().replace(/s$/, "");
  if (u === "day") return n;
  if (u === "week") return n * 7;
  if (u === "month") return Math.ceil((n * 365) / 12);
  return n * 365;
}

function durationIn(text: string): number | null {
  const m = new RegExp(DURATION, "i").exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  if (!n) return null;
  const days = unitDays(n, m[2]);
  return days >= 1 && days <= MAX_RULE_DAYS ? days : null;
}

function stampOf(line: string): { date: string | null; rest: string } {
  const m = STAMP_RE.exec(line);
  if (!m) return { date: null, rest: line };
  const date = m[4] ?? `${m[3]}-${String(MONTH_INDEX[m[2].slice(0, 3).toLowerCase()]).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  return { date: isDateKey(date) ? date : null, rest: line.slice(m[0].length) };
}

function clipWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trimEnd()}…`;
}

function draftFrom(sentence: string, date: string | null): RuleDraft | null {
  const source_text = clipWords(sentence, 300);
  const backward = BACKWARD_RE.exec(sentence);
  if (backward && REFUSE_RE.test(sentence)) {
    // Groups: 2 and 3 a number and its unit ("6 months"), or 4 a unit alone ("the past year").
    const n = backward[2] ? (/^\d+$/.test(backward[2]) ? Number(backward[2]) : NUMBER_WORDS[backward[2].toLowerCase()]) : 1;
    const days = n ? unitDays(n, backward[3] ?? backward[4] ?? "year") : null;
    if (days && days <= MAX_RULE_DAYS) return { rule_type: "reapply_after_days", value: String(days), anchor_date: null, source_text, sure: false, scope: THIS_ROLE_RE.test(backward[1] ?? "") ? "role" : "company" };
  }
  const forward = WAIT_THEN_AGAIN_RE.exec(sentence) ?? AGAIN_THEN_WAIT_RE.exec(sentence) ?? REFUSED_FOR_RE.exec(sentence);
  if (forward) {
    const days = durationIn(forward[0]);
    if (days) return { rule_type: "reapply_after_days", value: String(days), anchor_date: date, source_text, sure: true, scope: "company" };
  }
  const intake = INTAKE_RE.exec(sentence);
  if (intake && REFUSE_RE.test(sentence) && MORE_APPLICATIONS_RE.test(sentence)) {
    const plainYear = intake[2].toLowerCase() === "year" && (!intake[1] || intake[1].toLowerCase() === "calendar");
    if (plainYear && date) return { rule_type: "no_reapply_until", value: `${Number(date.slice(0, 4)) + 1}-01-01`, anchor_date: null, source_text, sure: false };
    return { rule_type: "no_reapply_until", value: null, anchor_date: null, source_text, sure: false, needs: "date", ...(date ? { suggested: nextSeptember(date) } : {}) };
  }
  if (SAME_ROLE_RE.test(sentence) && !INVITATION_RE.test(sentence)) {
    return { rule_type: "same_role_block", value: null, anchor_date: null, source_text, sure: false, needs: "role" };
  }
  return null;
}

/**
 * The cooldown phrases in a text, one draft per sentence that says one. Each line's own
 * date stamp is when the company said it; a line without one takes `fallbackDate`
 * (today, for text being added now; null when it is not known).
 */
export function readCooldowns(text: string | null | undefined, fallbackDate: string | null): RuleDraft[] {
  const out: RuleDraft[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? "").split("\n")) {
    const { date, rest } = stampOf(raw);
    for (const sentence of rest.split(/(?<=[.!?])\s+(?=["“(]?[A-Z])/)) {
      if (!sentence.trim()) continue;
      const draft = draftFrom(sentence, date ?? fallbackDate);
      if (!draft) continue;
      const key = `${draft.rule_type}|${draft.value}|${draft.anchor_date}|${draft.scope ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(draft);
    }
  }
  return out;
}

// --- Checking a posting --------------------------------------------------------------

export type CooldownRow = { id?: string; company_name?: unknown; role?: unknown; status?: unknown; date_applied?: unknown };

function submitted(status: unknown): Status | null {
  const s = normalizeStatus(status);
  return s && s !== "saved" ? s : null;
}

// A row that was sent. An ending with no date applied was closed before it was ever sent
// (a parked row whose role went, Chunk 22): it is no earlier application.
const ENDED_UNSENT = new Set<Status>(["rejected", "withdrawn", "ghosted"]);
function sentRow(r: { status?: unknown; date_applied?: unknown }): Status | null {
  const s = submitted(r.status);
  if (!s) return null;
  return ENDED_UNSENT.has(s) && !isDateKey(r.date_applied) ? null : s;
}

/** The newest date applied among the user's submitted rows for the company (for one role, when given). */
export function lastAppliedAt(company: string, rows: readonly CooldownRow[], role?: string | null): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    if (typeof r.company_name !== "string" || !sameCompany(company, r.company_name) || !sentRow(r)) continue;
    if (role !== undefined && !(role && sameRole(role, r.role))) continue;
    if (isDateKey(r.date_applied) && (!latest || r.date_applied > latest)) latest = r.date_applied;
  }
  return latest;
}

function fromSource(source: string | null | undefined): string {
  const s = (source ?? "").trim();
  return s ? `, from "${clipWords(s, REASON_SOURCE_CHARS)}"` : "";
}

/** When a reapply_after_days rule ends, or null when nothing on record says when it began. */
export function reapplyDate(rule: Pick<CompanyRule, "value" | "anchor_date" | "company_name">, rows: readonly CooldownRow[]): string | null {
  const anchor = isDateKey(rule.anchor_date) ? rule.anchor_date : lastAppliedAt(rule.company_name, rows);
  const days = Number(rule.value);
  return anchor && Number.isInteger(days) && days > 0 ? addDays(anchor, days) : null;
}

/** One line for a saved rule, and whether it still holds today. */
export function describeRule(rule: CompanyRule, rows: readonly CooldownRow[], today: string): { line: string; inForce: boolean } {
  if (rule.rule_type === "reapply_after_days") {
    const until = reapplyDate(rule, rows);
    if (!until) return { line: `Wait ${rule.value} days before reapplying (no application date on record yet)`, inForce: true };
    return { line: `Reapply after ${dayMonthYear(until)} (${rule.value} days)`, inForce: today < until };
  }
  if (rule.rule_type === "no_reapply_until") return { line: `No new applications until ${dayMonthYear(rule.value)}`, inForce: today < rule.value };
  return { line: `Not the same role again: ${rule.value}`, inForce: true };
}

export type CompanyCheckInput = {
  company: string;
  role?: string | null;
  // The posting being triaged: its own "if you applied in the last 6 months" counts too.
  jdText?: string | null;
  rules: readonly CompanyRule[];
  rows: readonly CooldownRow[];
  today: string;
};

/**
 * The triage reasons for one posting from what the company said before and what the user
 * did before. Skip: a rule in force (a wait, a closed intake, the same role blocked).
 * Review: the same role applied for before, or a wait with no date on record.
 */
export function checkCompanyRules({ company, role, jdText, rules, rows, today }: CompanyCheckInput): TriageHit[] {
  if (!company.trim()) return [];
  const hits: TriageHit[] = [];
  const hit = (level: TriageHit["level"], rule: TriageHit["rule"], phrase: string, sentence: string) => {
    if (!hits.some((h) => h.phrase === phrase)) hits.push({ level, rule, phrase, sentence });
  };
  for (const r of rules) {
    if (r.dismissed_at || !sameCompany(company, r.company_name)) continue;
    const said = (r.source_text ?? "").trim() || `A rule you saved for ${r.company_name}.`;
    if (r.rule_type === "reapply_after_days") {
      const until = reapplyDate(r, rows);
      if (!until) hit("review", "company_cooldown", `reapply wait of ${r.value} days, no application date on record${fromSource(r.source_text)}`, said);
      else if (today < until) hit("skip", "company_cooldown", `reapply after ${dayMonthYear(until)}${fromSource(r.source_text)}`, said);
    } else if (r.rule_type === "no_reapply_until") {
      if (isDateKey(r.value) && today < r.value) hit("skip", "company_closed", `no reapply until ${dayMonthYear(r.value)}${fromSource(r.source_text)}`, said);
    } else if (role && sameRole(role, r.value)) {
      hit("skip", "same_role", `same role blocked (${r.value})${fromSource(r.source_text)}`, said);
    } else if (!role) {
      hit("review", "same_role", `same-role block on ${r.value}; check this is a different role${fromSource(r.source_text)}`, said);
    }
  }
  // The posting's own rule: a wait counted from the last application to this company, or to
  // this role when it says "for this position".
  if (jdText) {
    for (const d of readCooldowns(jdText, null)) {
      if (d.rule_type !== "reapply_after_days" || !d.value) continue;
      const last = d.scope === "role" ? lastAppliedAt(company, rows, role ?? null) : lastAppliedAt(company, rows);
      if (!last) continue;
      const until = addDays(last, Number(d.value));
      if (today < until) hit("skip", "company_cooldown", `reapply after ${dayMonthYear(until)} (you applied ${dayMonthYear(last)})${fromSource(d.source_text)}`, d.source_text);
    }
  }
  // What the user did before: the same role at the same company.
  if (role && !hits.some((h) => h.rule === "same_role" && h.level === "skip")) {
    const before = rows
      .filter((r) => typeof r.company_name === "string" && sameCompany(company, r.company_name) && sentRow(r) && sameRole(role, r.role))
      .sort((a, b) => String(b.date_applied ?? "").localeCompare(String(a.date_applied ?? "")))[0];
    if (before) {
      const status = submitted(before.status)!;
      const when = isDateKey(before.date_applied) ? ` on ${dayMonthYear(before.date_applied)}` : "";
      const phrase = status === "rejected" ? `rejected for this role${when}` : `already applied for this role${when} (${STATUS_LABELS[status]})`;
      hit("review", "same_role_before", phrase, `Your tracker: ${String(before.company_name)}, ${String(before.role ?? "")}${when}, ${STATUS_LABELS[status]}.`);
    }
  }
  return hits;
}

/** The posting's own triage with the company's reasons put first. */
export function mergeCompanyHits(triage: JdTriage | null, hits: readonly TriageHit[]): JdTriage | null {
  if (hits.length === 0) return triage;
  const base: JdTriage = triage ?? { verdict: "apply", reasons: [], hits: [] };
  const skip = base.verdict === "skip" || hits.some((h) => h.level === "skip");
  const verdict = skip ? "skip" : "review";
  const reasons: string[] = [];
  for (const r of [...hits.map((h) => h.phrase), ...base.reasons]) {
    if (!reasons.some((x) => x.toLowerCase() === r.toLowerCase())) reasons.push(r);
  }
  return { verdict, reasons: reasons.slice(0, 8), hits: [...hits, ...base.hits] };
}

// --- Saving a rule -------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RuleInsert = {
  company_key: string;
  company_name: string;
  rule_type: RuleType;
  value: string;
  anchor_date: string | null;
  source_text: string;
  source: "manual" | "notes";
  application_id: string | null;
};

/** A rule from a request body, checked the way the table's constraints check it. */
export function readRuleInput(body: Record<string, unknown>): { rule: RuleInsert } | { error: string } {
  const name = typeof body.company_name === "string" ? body.company_name.replace(/\s+/g, " ").trim() : "";
  const key = companyKey(name);
  if (!name || !key) return { error: "Name the company." };
  if (name.length > MAX_NAME_CHARS) return { error: `The company name is too long (max ${MAX_NAME_CHARS} characters).` };
  const type = body.rule_type;
  if (typeof type !== "string" || !(RULE_TYPES as readonly string[]).includes(type)) return { error: "Pick a kind of rule." };
  const rule_type = type as RuleType;
  let value: string;
  if (rule_type === "reapply_after_days") {
    const days = typeof body.value === "number" ? body.value : typeof body.value === "string" && /^\d+$/.test(body.value.trim()) ? Number(body.value) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > MAX_RULE_DAYS) return { error: `Enter the wait as a number of days (1 to ${MAX_RULE_DAYS}).` };
    value = String(days);
  } else if (rule_type === "no_reapply_until") {
    if (!isDateKey(body.value)) return { error: "Enter the date as YYYY-MM-DD." };
    value = body.value;
  } else {
    const roleName = typeof body.value === "string" ? body.value.replace(/\s+/g, " ").trim() : "";
    if (!roleName) return { error: "Name the role." };
    if (roleName.length > MAX_NAME_CHARS) return { error: `The role is too long (max ${MAX_NAME_CHARS} characters).` };
    value = roleName;
  }
  let anchor_date: string | null = null;
  if (body.anchor_date != null && body.anchor_date !== "") {
    if (rule_type !== "reapply_after_days") return { error: "Only a wait counts from a date." };
    if (!isDateKey(body.anchor_date)) return { error: "Enter the start date as YYYY-MM-DD." };
    anchor_date = body.anchor_date;
  }
  const source_text = typeof body.source_text === "string" ? body.source_text.replace(/\s+/g, " ").trim() : "";
  if (source_text.length > MAX_SOURCE_CHARS) return { error: `Keep what they said under ${MAX_SOURCE_CHARS} characters.` };
  const application_id = typeof body.application_id === "string" && UUID_RE.test(body.application_id) ? body.application_id : null;
  const source = body.source === "notes" ? "notes" : "manual";
  return { rule: { company_key: key, company_name: name, rule_type, value, anchor_date, source_text, source, application_id } };
}

/** A stored rule, re-bounded on read (the user can write their own rows). */
export function normalizeRule(value: unknown): CompanyRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.company_name !== "string" || typeof v.value !== "string") return null;
  if (typeof v.rule_type !== "string" || !(RULE_TYPES as readonly string[]).includes(v.rule_type)) return null;
  return {
    ...(typeof v.id === "string" ? { id: v.id } : {}),
    company_name: v.company_name.slice(0, MAX_NAME_CHARS),
    rule_type: v.rule_type as RuleType,
    value: v.value.slice(0, MAX_NAME_CHARS),
    anchor_date: isDateKey(v.anchor_date) ? v.anchor_date : null,
    source_text: typeof v.source_text === "string" ? v.source_text.slice(0, MAX_SOURCE_CHARS) : "",
    source: v.source === "notes" || v.source === "seed" ? v.source : "manual",
    application_id: typeof v.application_id === "string" ? v.application_id : null,
    ...(typeof v.created_at === "string" ? { created_at: v.created_at } : {}),
    dismissed_at: typeof v.dismissed_at === "string" ? v.dismissed_at : null,
  };
}

type Draftish = Pick<CompanyRule, "company_name" | "rule_type" | "value"> & { anchor_date?: string | null; source_text?: string | null };
const sameWords = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === (b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Does a saved rule already say at least what the draft says? An equal or later end for a wait. */
function covers(r: CompanyRule, d: Draftish, rows: readonly CooldownRow[] | undefined): boolean {
  if (r.rule_type !== d.rule_type || !sameCompany(r.company_name, d.company_name)) return false;
  if (r.rule_type === "same_role_block") return sameRole(r.value, d.value);
  if (r.rule_type === "no_reapply_until") return r.value >= d.value;
  if (r.value === d.value && (r.anchor_date ?? null) === (d.anchor_date ?? null)) return true;
  // Nothing on record dates the draft (no rows given, or no application there yet): the same
  // wait is the same rule, or adding "365 days" again would save a second copy.
  const draftEnds = reapplyDate({ ...d, anchor_date: d.anchor_date ?? null }, rows ?? []);
  if (!draftEnds) return r.value === d.value;
  const ends = reapplyDate(r, rows ?? []);
  return !!ends && ends >= draftEnds;
}

/**
 * Is the draft already saved? A rule in use that covers it, or (for a rule read off text,
 * `auto`) one the user switched off that came from the same words, which stays off.
 */
export function ruleExists(rules: readonly CompanyRule[], draft: Draftish, opts: { rows?: readonly CooldownRow[]; auto?: boolean } = {}): boolean {
  return rules.some((r) => (r.dismissed_at ? !!opts.auto && sameWords(r.source_text, draft.source_text) && r.rule_type === draft.rule_type && sameCompany(r.company_name, draft.company_name) : covers(r, draft, opts.rows)));
}
