-- =========================================================
-- Capital Craft — Storage bucket "epc-docs" + RLS
-- Private bucket; files served via 1-hour signed URLs.
-- =========================================================

-- Create the bucket if it doesn't exist (private, 50 MiB cap)
insert into storage.buckets (id, name, public, file_size_limit)
values ('epc-docs', 'epc-docs', false, 52428800)
on conflict (id) do nothing;

-- Any authenticated user can upload / read / delete in this bucket.
-- (Path-level scoping is done in the application layer; admin sees all via the
--  RLS on the doc tables.)

create policy "auth_upload" on storage.objects for insert
  with check (bucket_id = 'epc-docs' and auth.role() = 'authenticated');

create policy "auth_select" on storage.objects for select
  using (bucket_id = 'epc-docs' and auth.role() = 'authenticated');

create policy "auth_delete" on storage.objects for delete
  using (bucket_id = 'epc-docs' and auth.role() = 'authenticated');
