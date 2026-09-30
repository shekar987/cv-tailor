// Experience bullets by ID. The experience step SELECTS and REORDERS the
// master CV's own bullets instead of writing new ones: the prompt gets the
// master's experience numbered ([R1.1], [R1.2] …), the model answers with
// those ids, and each bullet may differ from its master wording by at most
// MAX_SUBSTITUTIONS words. A deterministic pass then checks every id, counts
// the substitutions (LCS over word tokens), reverts a bullet that changed
// more than that to its master wording, drops what has no id it can match,
// and strips the markers. Later, the finished text is diffed against the
// master again (by closest bullet, since the markers are gone) so /app can
// show "Changes vs master CV": kept, edited (from → to), reverted, dropped,
// and anything that matches no master bullet at all.
//
// Import-free, so it runs under node:test.

export const MAX_SUBSTITUTIONS = 2;

export type MasterBullet = { id: string; role: number; index: number; text: string };
export type MasterRole = { index: number; header: string; bullets: MasterBullet[] };

const EXPERIENCE_HEADING = /^\s*(?:WORK\s+|PROFESSIONAL\s+)?EXPERIENCE\s*:?\s*$/i;
const NEXT_HEADING = /^\s*[A-Z][A-Z\s&/-]{2,40}:?\s*$/;
const YEAR = String.raw`(?:\d{1,2}\/)?(?:19|20)\d{2}`;
const ROLE_HEADER = new RegExp(String.raw`${YEAR}\s*(?:[–—-]|to)\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?${YEAR}|present)`, "i");
const BULLET = /^\s*[-•*]\s+/;
const HIGHLIGHT = /^\s*highlight\s*:/i;
export const BULLET_ID_RE = /^\s*(?:[•\-*]\s*)?\[(R\d+\.\d+)\]\s*/i;
// The same id inside bold the model opened before it: "• **[R1.1] Rebuilt
// the order service …**" or "• **[R1.1]** Rebuilt …". Missed until 29 Sep,
// when a paid eval run shipped six bullets starting "[R1.1]": the line fell
// through to closest-match, which kept the marker as a one-word "edit".
const BOLD_ID_RE = /^\s*(?:[•\-]\s*|\*\s+)?\*\*\s*\[(R\d+\.\d+)\]\s*(\*\*)?\s*/i;
// Any marker left anywhere in a bullet: never CV text.
const STRAY_ID_RE = /\s*\[R\d+\.\d+\]\s*/gi;
const OUTPUT_HEADER = /^[^•\-*\s].*\|.*\|/;

function idLine(line: string): { id: string; text: string } | null {
  const m = BULLET_ID_RE.exec(line);
  if (m) return { id: m[1], text: line.slice(m[0].length) };
  const b = BOLD_ID_RE.exec(line);
  if (!b) return null;
  // "**[R1.1] Rebuilt …**": the bold goes on past the id, so it reopens.
  const rest = line.slice(b[0].length);
  return { id: b[1], text: b[2] ? rest : `**${rest}` };
}

// A bullet that is ONE bold span from end to end emphasises nothing — bold
// is for the figures — so it is unwrapped; partial bold is left alone.
function unwrapWholeBold(text: string): string {
  const m = /^\*\*([^*]+)\*\*([.!]?)$/.exec(text.trim());
  return m ? `${m[1].trim()}${m[2]}` : text;
}

// The master CV's experience section as numbered roles and bullets. A
// bullet-less master (PDF extraction lost the glyphs) counts every content
// line under a header as a bullet, as contentBudget does.
export function parseMasterExperience(cvText: string): MasterRole[] {
  const lines = (cvText || "").split("\n");
  const start = lines.findIndex((l) => EXPERIENCE_HEADING.test(l));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_HEADING.test(lines[i]) && !EXPERIENCE_HEADING.test(lines[i])) {
      end = i;
      break;
    }
  }
  const roles: { header: string; lines: string[]; marked: number }[] = [];
  // The last line pushed as plain (unmarked) content, if it could be a title.
  let lastPlain: string | null = null;
  for (let i = start + 1; i < end; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (!BULLET.test(raw) && ROLE_HEADER.test(line)) {
      // A two-line header (title line, then a dates line) folds into one.
      const prev = roles[roles.length - 1];
      if (prev && prev.lines.length === 0 && !ROLE_HEADER.test(prev.header)) prev.header = `${prev.header} | ${line}`;
      else if (prev && lastPlain !== null && prev.lines[prev.lines.length - 1] === lastPlain) {
        // This role's title sits directly above its dates line, after the
        // previous role's bullets ("Full Stack Engineer — Brane Group", then
        // "Jul 2023 – Sep 2024"): it was read as that role's last line.
        prev.lines.pop();
        roles.push({ header: `${lastPlain} | ${line}`, lines: [], marked: 0 });
      } else roles.push({ header: line, lines: [], marked: 0 });
      lastPlain = null;
      continue;
    }
    if (roles.length === 0) {
      // A title line that precedes its dates line.
      if (!BULLET.test(raw) && line.length < 120) roles.push({ header: line, lines: [], marked: 0 });
      lastPlain = null;
      continue;
    }
    const role = roles[roles.length - 1];
    if (role.lines.length === 0 && !BULLET.test(raw) && !HIGHLIGHT.test(line) && !ROLE_HEADER.test(role.header) && line.length < 120) {
      role.header = `${role.header} | ${line}`;
      lastPlain = null;
      continue;
    }
    role.lines.push(line);
    if (BULLET.test(raw) || HIGHLIGHT.test(line)) {
      role.marked += 1;
      lastPlain = null;
    } else {
      // A short line with no closing full stop can be the next role's title.
      lastPlain = line.length < 100 && !/[.;]$/.test(line) ? line : null;
    }
  }
  const anyMarked = roles.some((r) => r.marked > 0);
  return roles
    .map((r, ri) => {
      const content = anyMarked ? r.lines.filter((l) => BULLET.test(l) || HIGHLIGHT.test(l)) : r.lines;
      return {
        index: ri + 1,
        header: r.header,
        bullets: content.map((l, bi) => ({ id: `R${ri + 1}.${bi + 1}`, role: ri + 1, index: bi + 1, text: l.replace(BULLET, "").trim() })),
      };
    })
    .filter((r) => r.bullets.length > 0);
}

// The numbered listing the experience prompt shows the model.
export function renderIdBlock(roles: MasterRole[]): string {
  if (roles.length === 0) return "";
  return roles
    .map((r) => [`ROLE ${r.index}: ${r.header}`, ...r.bullets.map((b) => `[${b.id}] ${b.text}`)].join("\n"))
    .join("\n\n");
}

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\*\*/g, "")
    // A hyphenated word ("front-end", "AI-enabled") is one token.
    .split(/[^a-z0-9%£$€+.#-]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean);
}

function lcs(a: string[], b: string[]): boolean[][] {
  // Returns, for each side, which tokens are on the longest common subsequence.
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const inA = new Array<boolean>(n).fill(false), inB = new Array<boolean>(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { inA[i] = true; inB[j] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [inA, inB];
}

export type Substitution = { changed: number; from: string[]; to: string[] };

// Word-level difference: tokens of the master not kept (from) and tokens of
// the output not in the master (to); `changed` is the larger of the two.
export function substitutions(master: string, output: string): Substitution {
  const a = tokens(master), b = tokens(output);
  const [inA, inB] = lcs(a, b);
  const from = a.filter((_, i) => !inA[i]);
  const to = b.filter((_, i) => !inB[i]);
  return { changed: Math.max(from.length, to.length), from, to };
}

export function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

export type BulletStatus = "kept" | "edited" | "reverted" | "new";
export type BulletChange = { id: string | null; status: BulletStatus; master: string; output: string; from: string[]; to: string[] };
export type RoleChanges = { role: string; bullets: BulletChange[]; dropped: { id: string; text: string }[]; reordered: boolean };
export type BulletChanges = { roles: RoleChanges[]; kept: number; edited: number; reverted: number; dropped: number; added: number };

function closest(text: string, candidates: MasterBullet[], min = 0.5): MasterBullet | null {
  let best: MasterBullet | null = null, bestScore = 0;
  for (const c of candidates) {
    const s = overlap(text, c.text);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return bestScore >= min ? best : null;
}

function summarise(roles: RoleChanges[]): BulletChanges {
  const all = roles.flatMap((r) => r.bullets);
  return {
    roles,
    kept: all.filter((b) => b.status === "kept").length,
    edited: all.filter((b) => b.status === "edited").length,
    reverted: all.filter((b) => b.status === "reverted").length,
    dropped: roles.reduce((n, r) => n + r.dropped.length, 0),
    added: all.filter((b) => b.status === "new").length,
  };
}

// Right after generation: enforce the id protocol and strip the markers.
// Returns the text the pipeline continues with, plus the per-role account.
// With no id in the output at all the protocol was not followed: the text
// is returned as it came (the later diff still reports it), changes = null.
export function reconcileExperience(output: string, roles: MasterRole[]): { experience: string; changes: BulletChanges | null } {
  if (roles.length === 0 || !output.trim()) return { experience: output, changes: null };
  const byId = new Map<string, MasterBullet>();
  for (const r of roles) for (const b of r.bullets) byId.set(b.id.toUpperCase(), b);
  const lines = output.split("\n");
  if (!lines.some((l) => idLine(l) !== null)) return { experience: output, changes: null };

  const out: string[] = [];
  const perRole = new Map<number, RoleChanges & { seen: string[] }>();
  const roleOf = (n: number) => {
    let r = perRole.get(n);
    if (!r) {
      r = { role: roles.find((x) => x.index === n)?.header ?? `Role ${n}`, bullets: [], dropped: [], reordered: false, seen: [] };
      perRole.set(n, r);
    }
    return r;
  };
  const used = new Set<string>();
  let currentRole = 0; // the role the last header line or id belonged to
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(raw); continue; }
    if (OUTPUT_HEADER.test(line)) {
      currentRole += 1;
      out.push(raw);
      continue;
    }
    const m = idLine(line);
    const isBullet = BULLET.test(line) || m !== null;
    if (!isBullet) { out.push(raw); continue; }
    let master: MasterBullet | null = m ? byId.get(m.id.toUpperCase()) ?? null : null;
    let text = unwrapWholeBold((m ? m.text : line.replace(BULLET, "")).replace(STRAY_ID_RE, " ").trim());
    if (!master) {
      // No usable id: the closest master bullet in the current role, else anywhere.
      const pool = roles.find((r) => r.index === currentRole)?.bullets ?? [];
      master = closest(text, pool, 0.6) ?? closest(text, roles.flatMap((r) => r.bullets), 0.6);
    }
    if (!master || used.has(master.id)) continue; // unmatched, or an id used twice: dropped
    used.add(master.id);
    const r = roleOf(master.role);
    const sub = substitutions(master.text, text);
    let status: BulletStatus = sub.changed === 0 ? "kept" : "edited";
    if (sub.changed > MAX_SUBSTITUTIONS) {
      text = master.text;
      status = "reverted";
    }
    r.bullets.push({ id: master.id, status, master: master.text, output: text, from: status === "reverted" ? [] : sub.from, to: status === "reverted" ? [] : sub.to });
    r.seen.push(master.id);
    out.push(`• ${text}`);
  }
  for (const role of roles) {
    const r = roleOf(role.index);
    r.dropped = role.bullets.filter((b) => !used.has(b.id)).map((b) => ({ id: b.id, text: b.text }));
    const idx = r.seen.map((id) => role.bullets.findIndex((b) => b.id === id));
    r.reordered = idx.some((v, i) => i > 0 && v < idx[i - 1]);
  }
  const ordered = roles.map((role) => {
    const r = perRole.get(role.index)!;
    const { seen: _seen, ...rest } = r;
    void _seen;
    return rest;
  });
  return { experience: out.join("\n"), changes: summarise(ordered) };
}

// The finished experience text against the master, by closest bullet — the
// "Changes vs master CV" view. Works with or without the id protocol, and
// after every later pass (claims rewrite, one-page trim) has run.
export function diffAgainstMaster(finalExperience: string, roles: MasterRole[]): BulletChanges | null {
  if (roles.length === 0 || !finalExperience.trim()) return null;
  const used = new Set<string>();
  const perRole = new Map<number, RoleChanges & { seen: string[] }>();
  const roleOf = (n: number) => {
    let r = perRole.get(n);
    if (!r) { r = { role: roles.find((x) => x.index === n)?.header ?? `Role ${n}`, bullets: [], dropped: [], reordered: false, seen: [] }; perRole.set(n, r); }
    return r;
  };
  let currentRole = 0;
  for (const raw of finalExperience.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (OUTPUT_HEADER.test(line)) { currentRole += 1; continue; }
    if (!BULLET.test(line)) continue;
    const text = line.replace(BULLET, "").trim();
    const pool = roles.find((r) => r.index === currentRole)?.bullets.filter((b) => !used.has(b.id)) ?? [];
    const master = closest(text, pool, 0.5) ?? closest(text, roles.flatMap((r) => r.bullets).filter((b) => !used.has(b.id)), 0.5);
    if (!master) {
      roleOf(currentRole || 1).bullets.push({ id: null, status: "new", master: "", output: text, from: [], to: tokens(text) });
      continue;
    }
    used.add(master.id);
    const sub = substitutions(master.text, text);
    const r = roleOf(master.role);
    r.bullets.push({ id: master.id, status: sub.changed === 0 ? "kept" : "edited", master: master.text, output: text, from: sub.from, to: sub.to });
    r.seen.push(master.id);
  }
  for (const role of roles) {
    const r = roleOf(role.index);
    r.dropped = role.bullets.filter((b) => !used.has(b.id)).map((b) => ({ id: b.id, text: b.text }));
    const idx = r.seen.map((id) => role.bullets.findIndex((b) => b.id === id));
    r.reordered = idx.some((v, i) => i > 0 && v < idx[i - 1]);
  }
  const ordered = [...perRole.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => { const { seen: _seen, ...rest } = r; void _seen; return rest; });
  return summarise(ordered);
}

// Project bullets against the master's own bullets for that project.
export function diffProjects(
  projects: unknown,
  meta: { name?: string; originalBullets?: string[] }[] | undefined
): RoleChanges[] {
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return [];
  const out: RoleChanges[] = [];
  for (const [key, list] of Object.entries(projects as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const m = meta?.[Number(key)];
    const masters: MasterBullet[] = (m?.originalBullets ?? []).map((t, i) => ({ id: `P${Number(key) + 1}.${i + 1}`, role: Number(key) + 1, index: i + 1, text: t }));
    const used = new Set<string>();
    const bullets: BulletChange[] = [];
    for (const b of list) {
      if (typeof b !== "string" || !b.trim()) continue;
      const master = closest(b, masters.filter((x) => !used.has(x.id)), 0.5);
      if (!master) { bullets.push({ id: null, status: "new", master: "", output: b, from: [], to: tokens(b) }); continue; }
      used.add(master.id);
      const sub = substitutions(master.text, b);
      bullets.push({ id: master.id, status: sub.changed === 0 ? "kept" : "edited", master: master.text, output: b, from: sub.from, to: sub.to });
    }
    out.push({ role: m?.name?.trim() || `Project ${Number(key) + 1}`, bullets, dropped: masters.filter((x) => !used.has(x.id)).map((x) => ({ id: x.id, text: x.text })), reordered: false });
  }
  return out;
}

// ── Role headers ─────────────────────────────────────────────────────────────
// Rule 8 in code: every role header in the output is the master CV's own
// ("Title | Employer | Dates", verbatim). The prompts say so, and the model
// still retitled one role "Full-Stack & AI Engineer (Industrial Placement)"
// on one run and "Research Assistant, AI & Full-Stack Development" on the
// next (30 Sep audit). Each output header is matched to one master role —
// by a shared employer or title part, then by the same dates, then by token
// overlap, then by position when the counts agree — and replaced by that
// role's header. An output role that matches nothing keeps its header only
// while bullets survive under it (reported as unmatched); with none it goes.
//
// The replacement is the master's CONTENT in the output's own shape,
// "Title | Employer | Dates" (canonicalHeader): the master CV writes its
// headers as it likes ("Full Stack Engineer — Brane Group<tab>Jul 2022 –
// Sep 2024" on the owner's, 30 Sep), and the preview, the .docx and the PDF
// only read a pipe-separated line as a job header. Measured over the
// owner's 174 stored runs before this shape rule, 350 "restorations" were
// pipes-versus-dashes and every one would have broken the header.

export type HeaderLock = { locked: { output: string; master: string }[]; unmatched: string[]; droppedEmpty: string[] };

// "Full Stack Engineer — Brane Group  Jul 2022 – Sep 2024" → "Full Stack
// Engineer | Brane Group | Jul 2022 – Sep 2024"; a header already in that
// shape comes back as it is (whitespace collapsed).
export function canonicalHeader(header: string): string {
  const h = header.replace(/\s+/g, " ").trim();
  const d = ROLE_HEADER.exec(h);
  // The dates regex anchors on the first year; a month name before it
  // ("Jul 2022 – Sep 2024") belongs to the dates, not the employer.
  let start = d ? d.index : 0;
  if (d) {
    const before = /(?:^|\s)((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?)\s+$/i.exec(h.slice(0, d.index));
    if (before) start = d.index - before[1].length - 1;
  }
  const dates = d ? h.slice(start, d.index + d[0].length).trim() : "";
  const rest = (d ? `${h.slice(0, start)} ${h.slice(d.index + d[0].length)}` : h).replace(/\s+/g, " ").replace(/^[\s|·,—–-]+|[\s|·,—–-]+$/g, "").trim();
  let parts = rest.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) parts = rest.split(/\s+[—–]\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  return [...parts, dates].filter(Boolean).join(" | ");
}
const foldHeader = (h: string) => canonicalHeader(h).toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");

const HEADER_PART_SEP = /\s*(?:\||—|–|\s-\s)\s*/;
const headerParts = (h: string) => h.split(HEADER_PART_SEP).map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter((p) => p.length >= 3);
const headerDates = (h: string) => {
  const m = ROLE_HEADER.exec(h);
  return m ? m[0].toLowerCase().replace(/\s+/g, "").replace(/[–—]/g, "-") : null;
};

export function lockRoleHeaders(output: string, roles: MasterRole[]): { experience: string; report: HeaderLock } {
  const report: HeaderLock = { locked: [], unmatched: [], droppedEmpty: [] };
  if (roles.length === 0 || !output.trim()) return { experience: output, report };
  const lines = output.split("\n");
  const headerIdx = lines.map((l, i) => (OUTPUT_HEADER.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  if (headerIdx.length === 0) return { experience: output, report };
  const bulletsUnder = (k: number) => {
    const end = k + 1 < headerIdx.length ? headerIdx[k + 1] : lines.length;
    return lines.slice(headerIdx[k] + 1, end).filter((l) => BULLET.test(l.trim())).length;
  };
  const used = new Set<number>();
  const free = () => roles.filter((r) => !used.has(r.index));
  const pick = (header: string): MasterRole | null => {
    const parts = headerParts(header);
    const byPart = free().find((r) => headerParts(r.header).some((p) => parts.includes(p)));
    if (byPart) return byPart;
    const dates = headerDates(header);
    const byDates = dates ? free().find((r) => headerDates(r.header) === dates) : undefined;
    if (byDates) return byDates;
    let best: MasterRole | null = null, bestScore = 0;
    for (const r of free()) {
      const s = overlap(header, r.header);
      if (s > bestScore) { best = r; bestScore = s; }
    }
    return best && bestScore >= 0.5 ? best : null;
  };
  // Two passes: every header that names its role is matched first, and only
  // then, when the counts agree, is a header that names nothing matched by
  // position — an invented first role must never take the first master's
  // header away from the real one below it.
  const picks: (MasterRole | null)[] = headerIdx.map((idx) => {
    const m = pick(lines[idx].trim());
    if (m) used.add(m.index);
    return m;
  });
  if (headerIdx.length === roles.length) {
    headerIdx.forEach((_, k) => {
      if (picks[k]) return;
      const r = free().find((x) => x.index === k + 1);
      if (r) { picks[k] = r; used.add(r.index); }
    });
  }
  const remove = new Set<number>();
  headerIdx.forEach((idx, k) => {
    const header = lines[idx].trim();
    const master = picks[k];
    if (!master) {
      if (bulletsUnder(k) === 0) {
        remove.add(idx);
        report.droppedEmpty.push(header);
      } else report.unmatched.push(header);
      return;
    }
    const canonical = canonicalHeader(master.header);
    if (foldHeader(header) !== foldHeader(canonical)) {
      report.locked.push({ output: header, master: canonical });
      lines[idx] = canonical;
    }
  });
  if (remove.size === 0) return { experience: lines.join("\n"), report };
  const kept: string[] = [];
  lines.forEach((l, i) => {
    if (remove.has(i)) return;
    // The blank line after a removed header, and a second blank left before it.
    if (!l.trim() && (remove.has(i - 1) || (remove.has(i + 1) && kept.length && !kept[kept.length - 1].trim()))) return;
    kept.push(l);
  });
  return { experience: kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, ""), report };
}

// ── Reverse-chronological roles ──────────────────────────────────────────────
// Nothing ordered the roles: the model wrote them as it liked, and a Jun
// 2026 – Present role printed last on 30 Sep. The page-fit code already
// assumes text order is recency ("oldest roles give way first"), so the
// text is sorted once, right after the headers are locked: a current role
// first, then by end month, then by start month; a role whose header has no
// readable dates keeps its place after the dated ones. Any lines before the
// first header stay at the top.
const MONTH_IDX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DATE_TOKEN = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+|(\d{1,2})\/)?((?:19|20)\d{2})\b|\b(present|current|now|ongoing)\b/gi;
// [start, end] as month indexes; a current role ends at +Infinity; null when
// the header carries no year.
export function headerSpan(header: string): [number, number] | null {
  const d = ROLE_HEADER.exec(header);
  if (!d) return null;
  const tail = header.slice(Math.max(0, d.index - 12));
  const points: number[] = [];
  for (const m of tail.matchAll(DATE_TOKEN)) {
    if (m[4]) points.push(Number.POSITIVE_INFINITY);
    else if (m[3]) points.push(Number(m[3]) * 12 + (m[1] ? MONTH_IDX[m[1].toLowerCase()] : m[2] ? Math.min(11, Math.max(0, Number(m[2]) - 1)) : 0));
  }
  if (points.length === 0) return null;
  const finite = points.filter((p) => Number.isFinite(p));
  const start = finite.length ? Math.min(...finite) : points[0];
  const end = points.includes(Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : Math.max(...finite);
  return [start, end];
}

export type ChronologyReport = { moved: boolean; order: string[] };
export function sortRolesByDate(experience: string): { experience: string; report: ChronologyReport } {
  const lines = experience.split("\n");
  const headerIdx = lines.map((l, i) => (OUTPUT_HEADER.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  if (headerIdx.length < 2) return { experience, report: { moved: false, order: headerIdx.map((i) => lines[i].trim()) } };
  const preamble = lines.slice(0, headerIdx[0]);
  const blocks = headerIdx.map((idx, k) => {
    const end = k + 1 < headerIdx.length ? headerIdx[k + 1] : lines.length;
    const block = lines.slice(idx, end);
    while (block.length > 1 && !block[block.length - 1].trim()) block.pop();
    return { header: lines[idx].trim(), block, span: headerSpan(lines[idx]), k };
  });
  const sorted = [...blocks].sort((a, b) => {
    if (!a.span && !b.span) return a.k - b.k;
    if (!a.span) return 1;
    if (!b.span) return -1;
    if (a.span[1] !== b.span[1]) return b.span[1] - a.span[1];
    if (a.span[0] !== b.span[0]) return b.span[0] - a.span[0];
    return a.k - b.k;
  });
  const moved = sorted.some((b, i) => b.k !== i);
  const out = [...preamble, ...sorted.flatMap((b, i) => (i === 0 ? b.block : ["", ...b.block]))];
  return { experience: moved ? out.join("\n") : experience, report: { moved, order: sorted.map((b) => b.header) } };
}
