// Migration 20261112120000 (Chunk 22) on a real Postgres, in process (PGlite): the date
// applied rule (an undated row only while Ready to submit; any writer that moves it on
// gets today), the cover letter column, the idempotency table's RLS and checks, a second
// run, and the down block. Also the "same line twice" rule through the real append SQL.
// Nothing live is touched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { isRecentDuplicate, stampNoteLine } from "../src/lib/notesWrite.ts";
import { dayKey } from "../src/lib/planTime.ts";

const MIGRATION = readFileSync(new URL("../supabase/migrations/20261112120000_fast_tracker_api.sql", import.meta.url), "utf8");
const APPEND_RPC = (() => {
  const sql = readFileSync(new URL("../supabase/migrations/20261104120000_action_centre.sql", import.meta.url), "utf8");
  const start = sql.indexOf("create or replace function public.append_application_note");
  const end = sql.indexOf("$func$;", start) + "$func$;".length;
  return sql.slice(start, end);
})();
const DOWN = MIGRATION.split(/^-- Down/m)[1]
  .split("\n")
  .filter((l) => l.startsWith("--   "))
  .map((l) => l.slice(5))
  .join("\n");

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const HASH = "a".repeat(64);

let db: PGlite;

async function asUser<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role authenticated; select set_config('request.uid', '${uid}', false);`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
async function refuses(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
const londonToday = () => dayKey(Date.now(), "Europe/London");
const dateOf = async (id: string) =>
  (await db.query<{ d: string | null }>("select to_char(date_applied, 'YYYY-MM-DD') as d from public.applications where id = $1", [id])).rows[0].d;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create role anon; create role authenticated;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create or replace function public.set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at = clock_timestamp(); return new; end; $f$;
    create table public.applications (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      company_name text not null, role text not null default 'Engineer',
      status text not null default 'applied',
      date_applied date not null,
      notes text,
      sent_cv jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create trigger applications_set_updated_at before update on public.applications for each row execute function public.set_updated_at();
    alter table public.applications enable row level security;
    create policy a_all on public.applications for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
    grant select, insert, update, delete on public.applications to authenticated;
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.applications (user_id, company_name, date_applied) values ('${A}', 'Existing Ltd', '2026-11-01');
  `);
  await db.exec(APPEND_RPC);
  await db.exec(MIGRATION);
});

after(async () => {
  await db?.close();
});

test("the migration runs a second time without error", async () => {
  await db.exec(MIGRATION);
});

test("a Ready to submit row is saved with no date applied, in either spelling", async () => {
  for (const status of ["saved", "Ready to submit"]) {
    const id = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name, status) values ($1, 'Sage', $2) returning id", [A, status])).rows[0].id;
    assert.equal(await dateOf(id), null, status);
  }
});

test("a sent row that arrives with no date is dated today in London, on insert and on update", async () => {
  const inserted = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name, status) values ($1, 'Acme', 'applied') returning id", [A])).rows[0].id;
  assert.equal(await dateOf(inserted), londonToday());
  for (const next of ["applied", "Interview", "offer", "accepted"]) {
    const id = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name, status) values ($1, 'Parked', 'saved') returning id", [A])).rows[0].id;
    await asUser(A, "update public.applications set status = $1 where id = $2", [next, id]);
    assert.equal(await dateOf(id), londonToday(), next);
  }
});

test("a parked row closed before it was sent stays undated; reopened to Applied it is dated", async () => {
  for (const ending of ["withdrawn", "Rejected", "ghosted"]) {
    const id = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name, status) values ($1, 'Closed unsent', 'saved') returning id", [A])).rows[0].id;
    await asUser(A, "update public.applications set status = $1 where id = $2", [ending, id]);
    assert.equal(await dateOf(id), null, ending);
    await asUser(A, "update public.applications set status = 'applied' where id = $1", [id]);
    assert.equal(await dateOf(id), londonToday(), `${ending} then applied`);
  }
});

test("a sent row's date is never left empty, and a given date is kept", async () => {
  const id = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name, status, date_applied) values ($1, 'Kept', 'applied', '2026-10-03') returning id", [A])).rows[0].id;
  assert.equal(await dateOf(id), "2026-10-03");
  await asUser(A, "update public.applications set date_applied = null where id = $1", [id]);
  assert.equal(await dateOf(id), londonToday(), "a direct clear on a sent row is dated, never null");
  // Moving a sent row back to Ready to submit keeps the date it has.
  await asUser(A, "update public.applications set status = 'saved', date_applied = '2026-10-03' where id = $1", [id]);
  assert.equal(await dateOf(id), "2026-10-03");
});

test("the check holds the rule even with the trigger off", async () => {
  await db.exec("alter table public.applications disable trigger applications_date_when_sent");
  try {
    assert.ok(await refuses(() => db.query("insert into public.applications (user_id, company_name, status) values ($1, 'NoDate', 'applied')", [A])));
    await db.query("insert into public.applications (user_id, company_name, status) values ($1, 'NoDateSaved', 'saved')", [A]);
  } finally {
    await db.exec("alter table public.applications enable trigger applications_date_when_sent");
  }
});

test("the cover letter column exists beside sent_cv", async () => {
  const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'applications' and column_name in ('sent_cv', 'sent_cover_letter') order by 1")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["sent_cover_letter", "sent_cv"]);
});

test("idempotency rows are the owner's alone, one per key", async () => {
  await asUser(A, "insert into public.api_idempotency (user_id, key, method, path, request_hash) values ($1, 'k-1', 'POST', '/api/applications', $2)", [A, HASH]);
  assert.ok(await refuses(() => asUser(A, "insert into public.api_idempotency (user_id, key, method, path, request_hash) values ($1, 'k-1', 'PUT', '/api/applications', $2)", [A, HASH])), "the same key twice is a conflict");
  // Another user may use the same key: keys are per user.
  await asUser(B, "insert into public.api_idempotency (user_id, key, method, path, request_hash) values ($1, 'k-1', 'POST', '/api/applications', $2)", [B, HASH]);
  assert.equal((await asUser<{ n: number }>(B, "select count(*)::int as n from public.api_idempotency")).rows[0].n, 1);
  assert.ok(await refuses(() => asUser(B, "insert into public.api_idempotency (user_id, key, method, path, request_hash) values ($1, 'forged', 'POST', '/x', $2)", [A, HASH])), "no row for another user");
  await asUser(B, "update public.api_idempotency set status_code = 200 where user_id = $1", [A]);
  await asUser(B, "delete from public.api_idempotency where user_id = $1", [A]);
  const a = (await db.query<{ status_code: number | null }>("select status_code from public.api_idempotency where user_id = $1 and key = 'k-1'", [A])).rows;
  assert.deepEqual(a, [{ status_code: null }], "B's update and delete reached nothing of A's");
  await asUser(A, "update public.api_idempotency set status_code = 201, response = '{\"ok\":true}' where key = 'k-1'");
  await asUser(A, "delete from public.api_idempotency where key = 'k-1'");
  assert.equal((await asUser<{ n: number }>(A, "select count(*)::int as n from public.api_idempotency")).rows[0].n, 0);
});

test("idempotency rows hold their shape", async () => {
  const bad = [
    ["", "POST", "/a", HASH],
    ["k", "GET", "/a", HASH],
    ["k", "POST", "/a", "not-a-hash"],
    ["k".repeat(256), "POST", "/a", HASH],
  ];
  for (const [key, method, path, hash] of bad) {
    assert.ok(await refuses(() => asUser(A, "insert into public.api_idempotency (user_id, key, method, path, request_hash) values ($1, $2, $3, $4, $5)", [A, key, method, path, hash])), `${method} ${key.slice(0, 5)} ${hash.slice(0, 5)}`);
  }
  assert.ok(await refuses(() => asUser(A, "insert into public.api_idempotency (user_id, key, method, path, request_hash, response) values ($1, 'big', 'POST', '/a', $2, $3)", [A, HASH, JSON.stringify({ x: "y".repeat(70_000) })])));
});

test("anon reaches no idempotency row", async () => {
  await db.exec("set role anon;");
  try {
    assert.ok(await refuses(() => db.query("select * from public.api_idempotency")));
  } finally {
    await db.exec("reset role;");
  }
});

test("the same line appended twice within ten minutes is on the row once", async () => {
  const id = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name, notes, date_applied) values ($1, 'Twice', 'Applied 4 Nov.', '2026-11-04') returning id", [A])).rows[0].id;
  // The route's appendNote: read the notes, skip a recent duplicate, else append through the RPC.
  const append = async (line: string, now: number) => {
    const notes = (await asUser<{ notes: string | null }>(A, "select notes from public.applications where id = $1", [id])).rows[0].notes;
    if (isRecentDuplicate(notes, line, now)) return "skipped";
    await asUser(A, "select public.append_application_note($1, $2, 10000)", [id, stampNoteLine(line, now)]);
    return "appended";
  };
  const t0 = Date.parse("2026-11-11T08:00:00Z");
  assert.equal(await append("T+7 follow-up sent", t0), "appended");
  assert.equal(await append("T+7 follow-up sent", t0 + 45_000), "skipped", "the timed-out script's second run");
  assert.equal(await append("Screening call booked", t0 + 60_000), "appended");
  assert.equal(await append("T+7 follow-up sent", t0 + 5 * 60_000), "skipped", "still a repeat with another line on top");
  const notes = (await db.query<{ notes: string }>("select notes from public.applications where id = $1", [id])).rows[0].notes;
  assert.equal(notes.split("\n").filter((l) => l.endsWith("T+7 follow-up sent")).length, 1);
  assert.equal(await append("T+7 follow-up sent", t0 + 11 * 60_000), "appended", "after ten minutes it is news again");
});

test("the down block puts the date requirement back after dating every undated row", async () => {
  await db.exec(DOWN);
  const undated = (await db.query<{ n: number }>("select count(*)::int as n from public.applications where date_applied is null")).rows[0].n;
  assert.equal(undated, 0);
  assert.ok(await refuses(() => db.query("insert into public.applications (user_id, company_name, status) values ($1, 'After down', 'saved')", [A])));
  const tables = (await db.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_name = 'api_idempotency'")).rows[0].n;
  assert.equal(tables, 0);
  // And up again, as the owner would after a mistaken down.
  await db.exec(MIGRATION);
});
