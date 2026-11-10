// Migration 20261110120000 (Chunk 21) on a real Postgres, in process (PGlite): the
// notes-history trigger, its RLS, the company rules' RLS and shape checks, the deadline
// columns, a second run, and the down block. Nothing live is touched.
//
// The tables created before the migrations convention are stubbed with the columns the
// migration reads; auth.uid() reads a setting, as Supabase's reads the JWT.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION = readFileSync(new URL("../supabase/migrations/20261110120000_safe_notes_cooldowns_deadlines.sql", import.meta.url), "utf8");
// The note RPC itself (migration 20261104120000), so an append is tested through the real SQL.
const APPEND_RPC = (() => {
  const sql = readFileSync(new URL("../supabase/migrations/20261104120000_action_centre.sql", import.meta.url), "utf8");
  const start = sql.indexOf("create or replace function public.append_application_note");
  const end = sql.indexOf("$func$;", start) + "$func$;".length;
  return sql.slice(start, end);
})();
// The "Down" block, uncommented.
const DOWN = MIGRATION.split(/^-- Down/m)[1]
  .split("\n")
  .filter((l) => l.startsWith("--   "))
  .map((l) => l.slice(5))
  .join("\n");

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const ROW_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ROW_B = "bbbbbbbb-0000-4000-8000-000000000001";

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
const history = async (id: string) =>
  (await db.query<{ old_notes: string }>("select old_notes from public.notes_history where application_id = $1 order by changed_at, id", [id])).rows.map((r) => r.old_notes);

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
      notes text,
      updated_at timestamptz not null default now()
    );
    create trigger applications_set_updated_at before update on public.applications for each row execute function public.set_updated_at();
    alter table public.applications enable row level security;
    create policy a_all on public.applications for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
    grant select, insert, update, delete on public.applications to authenticated;
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.applications (id, user_id, company_name, notes) values
      ('${ROW_A}', '${A}', 'Northwind Apps', 'Applied on 5 Jul.'),
      ('${ROW_B}', '${B}', 'Contoso', 'B notes.');
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

test("a notes replace keeps the old text in notes_history", async () => {
  await asUser(A, "update public.applications set notes = $1 where id = $2", ["Rebuilt by hand.", ROW_A]);
  assert.deepEqual(await history(ROW_A), ["Applied on 5 Jul."]);
});

test("an append through the RPC is recorded too, and needs no read of the old text", async () => {
  const appended = await asUser<{ notes: string }>(A, "select public.append_application_note($1, $2, 2000) as notes", [ROW_A, "10 Nov 2026 09:15 Screening call booked"]);
  assert.equal(appended.rows[0].notes, "10 Nov 2026 09:15 Screening call booked\nRebuilt by hand.");
  assert.deepEqual(await history(ROW_A), ["Applied on 5 Jul.", "Rebuilt by hand."]);
});

test("each version says whether the change took text away: a replace that cut it did, an append didn't", async () => {
  const lost = (await db.query<{ old_notes: string; lost_text: boolean }>("select old_notes, lost_text from public.notes_history where application_id = $1 order by changed_at, id", [ROW_A])).rows;
  assert.deepEqual(lost.map((r) => [r.old_notes, r.lost_text]), [["Applied on 5 Jul.", true], ["Rebuilt by hand.", false]]);
});

test("nothing is recorded when the notes did not change or were empty", async () => {
  const before = (await history(ROW_A)).length;
  await asUser(A, "update public.applications set status = 'screening' where id = $1", [ROW_A]);
  await asUser(A, "update public.applications set notes = notes where id = $1", [ROW_A]);
  assert.equal((await history(ROW_A)).length, before);
  const empty = (await asUser<{ id: string }>(A, "insert into public.applications (user_id, company_name) values ($1, 'Fabrikam') returning id", [A])).rows[0].id;
  await asUser(A, "update public.applications set notes = 'First note.' where id = $1", [empty]);
  assert.deepEqual(await history(empty), []);
});

test("history is the owner's to read and nobody's to write", async () => {
  const mine = await asUser<{ n: number }>(A, "select count(*)::int as n from public.notes_history");
  assert.ok(mine.rows[0].n >= 2);
  const theirs = await asUser<{ n: number }>(B, "select count(*)::int as n from public.notes_history where application_id = $1", [ROW_A]);
  assert.equal(theirs.rows[0].n, 0);
  assert.ok(await refuses(() => asUser(A, "insert into public.notes_history (application_id, user_id, old_notes) values ($1, $2, 'forged')", [ROW_A, A])));
  assert.ok(await refuses(() => asUser(A, "update public.notes_history set old_notes = 'changed'")));
  assert.ok(await refuses(() => asUser(A, "delete from public.notes_history")));
  assert.ok(await refuses(() => asUser(A, "select public.record_notes_history()")));
});

test("a rule is the owner's own, switched off rather than deleted, and shaped by its type", async () => {
  const insert = "insert into public.company_rules (user_id, company_key, company_name, rule_type, value, anchor_date, source_text) values ($1, $2, $3, $4, $5, $6, $7) returning id";
  const id = (await asUser<{ id: string }>(A, insert, [A, "northwind apps", "Northwind Apps", "reapply_after_days", "365", "2026-07-05", "wait at least one year"])).rows[0].id;
  assert.ok(await refuses(() => asUser(A, insert, [B, "contoso", "Contoso", "reapply_after_days", "90", null, "90 days"])), "a rule for someone else");
  assert.ok(await refuses(() => asUser(A, insert, [A, "x", "X", "reapply_after_days", "a year", null, ""])), "days must be a number");
  assert.ok(await refuses(() => asUser(A, insert, [A, "x", "X", "no_reapply_until", "next September", null, ""])), "until must be a date");
  assert.ok(await refuses(() => asUser(A, insert, [A, "x", "X", "wait_forever", "1", null, ""])), "an unknown type");
  assert.equal((await asUser<{ n: number }>(B, "select count(*)::int as n from public.company_rules")).rows[0].n, 0);
  await asUser(A, "update public.company_rules set dismissed_at = now() where id = $1", [id]);
  assert.ok(await refuses(() => asUser(A, "delete from public.company_rules where id = $1", [id])));
  assert.equal((await db.query<{ n: number }>("select count(*)::int as n from public.company_rules")).rows[0].n, 1);
});

test("applications gain the applied-from address and the next deadline, indexed", async () => {
  await asUser(A, "update public.applications set applied_from_email = 'second@example.com', next_deadline = now() + interval '30 hours', deadline_note = 'Complete the online assessment' where id = $1", [ROW_A]);
  assert.ok(await refuses(() => asUser(A, "update public.applications set deadline_note = $1 where id = $2", ["x".repeat(301), ROW_A])));
  const index = await db.query<{ n: number }>("select count(*)::int as n from pg_indexes where indexname = 'applications_user_next_deadline_idx'");
  assert.equal(index.rows[0].n, 1);
});

test("the down block reverses it", async () => {
  await db.exec(DOWN);
  const tables = await db.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_name in ('notes_history', 'company_rules')");
  assert.equal(tables.rows[0].n, 0);
  const cols = await db.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_name = 'applications' and column_name in ('applied_from_email', 'next_deadline', 'deadline_note')");
  assert.equal(cols.rows[0].n, 0);
  // And notes still save without the trigger.
  await db.query("update public.applications set notes = 'After the down.' where id = $1", [ROW_A]);
});
