// Chunk 23 done-when (1): an append on a row with long notes keeps every old line. Run on
// a real Postgres, in process (PGlite), through the real SQL of append_application_note
// (migration 20261104120000) — the one function behind append_note on PUT, PATCH, /log
// and POST /api/applications/bulk's append_line — with the cap the route passes
// (MAX_NOTES_CHARS). And the server-side line the PUT writes itself when an ending clears a
// follow-up (lib/tracker appendNoteLine), on the same long notes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { MAX_NOTES_CHARS } from "../src/lib/limits.ts";
import { stampNoteLine } from "../src/lib/notesWrite.ts";
import { appendNoteLine } from "../src/lib/tracker.ts";

const APPEND_RPC = (() => {
  const sql = readFileSync(new URL("../supabase/migrations/20261104120000_action_centre.sql", import.meta.url), "utf8");
  const start = sql.indexOf("create or replace function public.append_application_note");
  const end = sql.indexOf("$func$;", start) + "$func$;".length;
  return sql.slice(start, end);
})();

const USER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const ROW = "aaaaaaaa-0000-4000-8000-000000000001";

// About 9,000 characters: 85 dated lines a sweep and the user wrote over two months,
// each one different, some with characters a careless join would mangle.
const OLD_LINES = Array.from({ length: 85 }, (_, i) => {
  const day = String((i % 28) + 1).padStart(2, "0");
  return `${day} Oct 2026 09:${String(i % 60).padStart(2, "0")} Line ${i + 1}: follow-up sent to the recruiter — "next week", O'Brien said; 50% chance\\maybe`;
});
const LONG_NOTES = OLD_LINES.join("\n");

let db: PGlite;

async function asUser<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role authenticated; select set_config('request.uid', '${uid}', false);`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
const append = async (uid: string, line: string, max = MAX_NOTES_CHARS) =>
  (await asUser<{ notes: string | null }>(uid, "select public.append_application_note($1, $2, $3) as notes", [ROW, line, max])).rows[0].notes;
const stored = async () => (await db.query<{ notes: string | null }>("select notes from public.applications where id = $1", [ROW])).rows[0].notes;

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
    create table public.applications (
      id uuid primary key, user_id uuid not null references auth.users(id),
      company_name text not null, notes text, updated_at timestamptz not null default now()
    );
    alter table public.applications enable row level security;
    create policy a_all on public.applications for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
    grant select, insert, update, delete on public.applications to authenticated;
    insert into auth.users values ('${USER}'), ('${OTHER}');
  `);
  await db.query("insert into public.applications (id, user_id, company_name, notes) values ($1, $2, 'Elwood Robotics', $3)", [ROW, USER, LONG_NOTES]);
  await db.exec(APPEND_RPC);
});

after(async () => {
  await db.close();
});

test("the notes are long: about 9,000 characters over 85 lines", async () => {
  assert.ok(LONG_NOTES.length > 8_500 && LONG_NOTES.length < MAX_NOTES_CHARS, `${LONG_NOTES.length}`);
});

test("an append on long notes keeps every old line, in order, under the new one", async () => {
  const line = stampNoteLine("Follow-up sent", Date.parse("2026-11-12T09:30:00Z"));
  const notes = await append(USER, line);
  assert.equal(notes, `${line}\n${LONG_NOTES}`);
  assert.equal(await stored(), notes);
  const lines = (notes ?? "").split("\n");
  assert.equal(lines.length, OLD_LINES.length + 1);
  assert.deepEqual(lines.slice(1), OLD_LINES, "every old line, character for character, in its place");
});

test("appends keep landing on top until the cap, then refuse rather than cut a single line", async () => {
  const before = await stored();
  let landed = 0;
  for (let i = 0; i < 100; i++) {
    const notes = await append(USER, `12 Nov 2026 10:${String(i % 60).padStart(2, "0")} Extra line ${i}`);
    if (notes === null) break;
    landed++;
  }
  const full = (await stored()) ?? "";
  assert.ok(landed > 0 && landed < 100, `${landed} appends landed before the cap`);
  assert.ok(full.length <= MAX_NOTES_CHARS, `${full.length}`);
  assert.ok(full.endsWith(before ?? "\u0000"), "everything that was there is still there, at the end");
  // The refused append changed nothing.
  assert.equal(await append(USER, "One line too many"), null);
  assert.equal(await stored(), full);
});

test("another user's append reaches nothing", async () => {
  const mine = await stored();
  assert.equal(await append(OTHER, "Not my row"), null);
  assert.equal(await stored(), mine);
});

test("the line the server writes itself on an ending keeps every old line too", () => {
  const notes = appendNoteLine(LONG_NOTES, "Follow-up 2026-11-09 cleared when marked Rejected on 2026-11-12.");
  assert.ok(notes.includes(LONG_NOTES), "the old notes whole");
  assert.equal(notes.split("\n").filter((l) => OLD_LINES.includes(l)).length, OLD_LINES.length);
});
