-- =========================================================
-- 0039 — Comments are permanent: block edits at the DB (audit-style)
--
-- Product decision: once an admin adds a comment it can never be edited.
-- The Edit/Delete controls are removed from the UI; this migration also
-- forbids UPDATE at the database so a comment's text can never change,
-- via any client or the API.
--
-- HOW: replace the single "for all" policy on epc_comments with explicit
-- per-command policies for SELECT / INSERT / DELETE. With no UPDATE
-- policy present, RLS denies every UPDATE (nothing legitimately updates
-- a comment, so this is safe).
--
-- DELETE stays permitted for admins because the EPC-deletion flow
-- (/api/admin/delete-epc) removes an EPC's comments explicitly as part
-- of destroying the whole profile, and epc_comments also CASCADES from
-- epc_business. There is no per-comment delete anywhere in the UI, so a
-- single note can't be removed on its own — it only dies with the EPC.
--
-- The set_updated_at BEFORE-UPDATE trigger (0018) simply never fires now.
--
-- Rollback:
--   drop policy if exists "admin_select_epc_comments" on epc_comments;
--   drop policy if exists "admin_insert_epc_comments" on epc_comments;
--   drop policy if exists "admin_delete_epc_comments" on epc_comments;
--   create policy "admin_all_epc_comments" on epc_comments for all
--     using ((auth.jwt() ->> 'business_type') = 'admin');
-- =========================================================

drop policy if exists "admin_all_epc_comments" on epc_comments;

create policy "admin_select_epc_comments" on epc_comments for select
  using ((auth.jwt() ->> 'business_type') = 'admin');

create policy "admin_insert_epc_comments" on epc_comments for insert
  with check ((auth.jwt() ->> 'business_type') = 'admin');

create policy "admin_delete_epc_comments" on epc_comments for delete
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- No UPDATE policy → all UPDATEs on epc_comments are denied.
