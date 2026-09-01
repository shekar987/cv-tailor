# Database expectations

What the code assumes about the live Supabase project, verified against it on
2026-08-30 through the data API. Only the `applications` table has checked-in
SQL (`migrations/`); everything else was created by hand in the SQL editor
before migrations were tracked, so this file is the record of what must exist.
When you add a column or function: write the migration, apply it, and update
this file.

## Tables

| Table | Columns the code touches | Constraints the code relies on | Read/written by |
|---|---|---|---|
| `profiles` | `id`, `tailor_count`, `tailor_count_reset_at`, `claude_tailors_used`, `is_unlimited`, `anthropic_api_key`, `section_order` | PK `id` → `auth.users`; RLS `id = auth.uid()`; table-level UPDATE revoked from `authenticated`, re-granted on `anthropic_api_key` and `section_order` | `api/section-order`, `app/page.tsx` (reads `is_unlimited`), the two counter RPCs |
| `master_cvs` | `user_id`, `text`, `updated_at` | **unique `user_id`** (the `onConflict: 'user_id'` upsert needs it); RLS `auth.uid() = user_id` | `lib/cvStore.ts` |
| `cv_profiles` | `user_id`, `data` (jsonb), `updated_at` | **unique `user_id`**; RLS | `lib/cvStore.ts` |
| `user_api_keys` | `user_id`, `provider`, `key_enc`, `key_hint`, `updated_at` | **PK/unique `(user_id, provider)`** (`onConflict: "user_id,provider"`); `provider` CHECK in (`gemini`,`openrouter`); `key_enc` is never *selected* by the app, but a column-level SELECT revoke was tried (`20260831140000`) and withdrawn (`20260831160000`) — it broke the key-save upsert, which reads `excluded.key_enc`. RLS scoping to the caller's own row is the real guard | `api/keys`, `settings/page.tsx`, `api/tailor` |
| `applications` | see `migrations/20260826120000_create_applications.sql` + `20260829120000_applications_tailored_cv.sql` | partial unique `(user_id, tailor_session_id) WHERE tailor_session_id IS NOT NULL`; CHECKs on `status`/`source`; `set_updated_at` trigger; RLS on all four verbs | `api/applications`, `api/applications/export` |
| `user_feedback` | `user_id`, `email`, `message` | RLS insert-only for `authenticated` | `api/feedback` |
| `user_projects`, `user_skills` | — | — | **Nothing.** The routes that used them were removed (no callers). Droppable. |

## Functions (all SECURITY DEFINER)

| Function | Arguments | Returns | Notes |
|---|---|---|---|
| `handle_new_user()` | trigger on `auth.users` INSERT | — | Creates the `profiles` row, so the counters always have a row to lock |
| `check_and_increment_tailor_count` | `uid uuid, daily_limit int, window_seconds int` | `{ allowed bool, reason text, reset_at timestamptz }` | `reason` ∈ `ok`, `limit_reached`, `profile_not_found`, `forbidden` (caller's `auth.uid()` ≠ `uid`) |
| `check_and_increment_claude_lifetime` | `uid uuid, lifetime_limit int` | `{ allowed bool, reason text }` | `reason` ∈ `unlimited`, `ok`, `claude_limit_reached`, `profile_not_found`, `forbidden` |
| `get_encrypted_key` | `p_user_id uuid, p_provider text` | `text` (ciphertext) or `null` | Returns null unless `auth.uid()` matches |
| `set_updated_at()` | trigger | — | From the applications migration (`$func$`-delimited) |
| `refund_tailor_count` | `uid uuid` | `void` | `migrations/20260830120000_quota_refunds.sql`; decrements `tailor_count` (floor 0) for the caller's own row |
| `refund_claude_lifetime` | `uid uuid` | `void` | Same migration; decrements `claude_tailors_used` (floor 0) |

Both counters increment **before** the pipeline runs; `/api/tailor` calls the
refund functions if the pipeline then throws, so a provider 429 or outage no
longer costs the user a slot. Until that migration is applied the refund
call fails quietly (logged) and behaviour is as before.

## Baseline migration

`migrations/00000000000000_baseline.sql` holds the complete pre-migration
schema, generated 2026-08-31 from the live catalogs (read-only, via the
Supabase MCP connector — the same queries as `supabase/introspect.sql`).
It exists to rebuild a FRESH project; never run it against the live one.
The live project's tracked migration history holds only three entries
(`guard_rate_limit_rpcs_to_calling_user`, `add_section_order_to_profiles`,
`add_user_projects_and_user_skills`); their effects are embodied in the
baseline's function bodies and tables.

## Advisor findings (2026-08-31)

`get_advisors` (security + performance) against the live project, after the
Stage 2 schema landed. Everything fixable in SQL is in
`migrations/20260831140000_advisor_hardening.sql` (applied 2026-08-31):

- The four SECURITY DEFINER functions were executable by `anon` via
  `/rest/v1/rpc/*` (harmless in effect — all carry internal `auth.uid()`
  guards — but needless surface). The migration revokes `public`/`anon` and
  keeps `authenticated` on the three the app calls; `handle_new_user` is
  trigger-only and loses all callers.
- `set_updated_at` had no pinned `search_path` (every other function does).
- Every RLS policy re-evaluated `auth.uid()` per row (`auth_rls_initplan`);
  rewritten as `(select auth.uid())`.
- `user_feedback.user_id` was an unindexed FK; covered.
- `user_api_keys.key_enc` was NOT column-blocked despite the docs (see the
  table above); now it is, and `anon` loses the table entirely.

Needs the dashboard, not SQL: **leaked-password protection is disabled** —
Authentication → Providers → Email → "Prevent use of leaked passwords".

Post-apply state (2026-08-31, verified live): `20260830120000` and
`20260831140000` are both applied — refund functions present and callable by
`authenticated`, all policies on the `(select auth.uid())` form, `anon`
locked out of the four original RPCs, `set_updated_at` pinned, FK indexed,
every performance WARN cleared.

The post-apply advisor + smoke runs produced two follow-ups, both applied
2026-08-31 (verified — `grants-smoke.mjs` 15/15):

- `20260831160000_restore_key_enc_select.sql` — the key_enc column revoke
  from the hardening migration had broken PostgREST's key-save upsert
  everywhere (it reads `excluded.key_enc`, which needs SELECT → 42501).
  The column-block experiment is withdrawn; the anon revoke stays.
- `20260831150000_refunds_anon_revoke.sql` — the refund functions were still
  anon-executable: Supabase default privileges grant EXECUTE to `anon`
  explicitly, so quota_refunds' `revoke … from public` alone wasn't enough
  (harmless in effect — their `auth.uid()` guard no-ops — but needless
  surface; see the CLAUDE.md gotcha).

End state verified live: key save/list/delete work, key_enc reads are
RLS-scoped to the caller's own row, `authenticated` can call the counter and
refund RPCs, `anon` is refused on all of them, and tracker CRUD passes under
the rewritten policies.

## Verifying against the live project

The SQL editor runs as superuser and bypasses RLS, so it can't prove
isolation. Use PostgREST with the secret key from `.env.local` (never from
`src/`):

- Column exists: `GET /rest/v1/<table>?select=<column>&limit=0` → 200; `42703` means missing, `PGRST205` means the table is missing.
- Function exists: `POST /rest/v1/rpc/<fn>` **with the real argument names** (an empty body never matches a function that has parameters — you get `PGRST202`, which looks like "missing"). A zero UUID is safe for the counters.
- Isolation: create a throwaway user through `/auth/v1/admin/users`, sign in with the password grant, and check that account B cannot read/update/delete account A's rows and cannot insert with A's `user_id`.

A script doing all of the above lives outside the repo (session scratchpad);
its shape is described in CLAUDE.md under "Testing the API without a browser".
