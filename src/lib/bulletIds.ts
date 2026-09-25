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
const OUTPUT_HEADER = /^[^•\-*\s].*\|.*\|/;

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
  if (!lines.some((l) => BULLET_ID_RE.test(l))) return { experience: output, changes: null };

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
    const isBullet = BULLET.test(line) || BULLET_ID_RE.test(line);
    if (!isBullet) { out.push(raw); continue; }
    const m = BULLET_ID_RE.exec(line);
    let master: MasterBullet | null = m ? byId.get(m[1].toUpperCase()) ?? null : null;
    let text = (m ? line.slice(m[0].length) : line.replace(BULLET, "")).trim();
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
