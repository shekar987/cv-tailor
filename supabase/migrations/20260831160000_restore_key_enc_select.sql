-- URGENT — apply this before anything else: key saving is broken in every
-- environment (production included) from the moment 20260831140000 ran,
-- until this runs.
--
-- Withdraws one piece of 20260831140000: the column-level SELECT revoke on
-- user_api_keys.key_enc breaks the app's key-save path. PostgREST's upsert
-- (resolution=merge-duplicates) emits
--   ON CONFLICT (user_id, provider) DO UPDATE SET key_enc = excluded.key_enc, ...
-- and Postgres requires SELECT privilege on every column read via excluded.*
-- — so /api/keys fails with 42501 ("permission denied for table
-- user_api_keys"). Caught by the post-apply smoke run; root-caused by
-- replaying the exact upsert against PostgREST.
--
-- The block's value was marginal anyway: RLS already scopes reads to the
-- caller's own row, so all it hid was the user's own AES-GCM ciphertext —
-- of a key they themselves submitted in plaintext. The real defenses are
-- RLS, the server-side KEY_ENCRYPTION_SECRET, and the app never selecting
-- the column. The anon revoke from 20260831140000 stays.

grant select (key_enc) on public.user_api_keys to authenticated;
