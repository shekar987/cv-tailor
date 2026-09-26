-- The CV a user actually sent for an application (tracker, lib/sentCv.ts):
-- for applications made outside Jobhuntz — another site's form, an agency,
-- an email — the user uploads the file they sent on /applications, and it is
-- kept privately so they can see and download it again later.
--
-- 1. applications.sent_cv jsonb — the file's record and the text read from it:
--      { version: 1, path, fileName, size, kind, uploadedAt, text, textNote? }
--    NULL = no file. Written only by /api/applications/cv (never through the
--    tracker PUT whitelist); the existing RLS (auth.uid() = user_id, all four
--    verbs) covers the column.
--
-- 2. A private Storage bucket, application-cvs: 5 MB per file, PDF / Word
--    (.docx) / plain text only, no public URLs. Objects live under
--    <user id>/<application id>/<timestamp>-<name>; the policies below let a
--    signed-in user read, add and remove objects in their own folder only,
--    and give anon nothing. The route never upserts or moves an object, so
--    there is no update policy. Downloads go through the route, which also
--    checks the row and the path prefix itself.
--
-- The code degrades until this is applied: the tracker's reads retry without
-- the column (42703) and the upload route answers 503 naming this file.
-- Safe to re-run.

alter table public.applications add column if not exists sent_cv jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-cvs',
  'application-cvs',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "application_cvs_select_own" on storage.objects;
create policy "application_cvs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'application-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "application_cvs_insert_own" on storage.objects;
create policy "application_cvs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'application-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "application_cvs_delete_own" on storage.objects;
create policy "application_cvs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
