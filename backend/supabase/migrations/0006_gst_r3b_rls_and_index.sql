-- =========================================================
-- 0006 — GST R3B: RLS lockdown + uniqueness on 'present' file.
--
-- Two changes:
--
-- 1) Replace the `own_docs` SELECT/INSERT/UPDATE/DELETE policy
--    on epc_documents so it EXCLUDES rows with category = 'gst_r3b'.
--    EPCs will no longer be able to see, insert, update, or delete
--    GSTR-3B rows tied to their business_id — even via a direct
--    PostgREST query with their own JWT. Only the `admin_all_docs`
--    policy still grants access, and that only fires when the JWT
--    has business_type = 'admin'. This is the database-layer half
--    of the defense-in-depth (the other two halves are the upload
--    route and the document-GET route, in the frontend code).
--
-- 2) Enforce "max 1 'present' GSTR-3B file per business" with a
--    unique partial index. Previous-period files (up to 12) have
--    no DB-side cap — the app counts them.
--
-- Rollback (if ever needed):
--    drop index if exists uniq_gst_r3b_present_per_biz;
--    drop policy if exists "own_docs" on epc_documents;
--    create policy "own_docs" on epc_documents for all
--      using (business_id = (auth.jwt() ->> 'business_id')::uuid);
-- =========================================================

-- ── (1) RLS update ──────────────────────────────────────────
-- PG doesn't have ALTER POLICY (until 15+ with limited syntax),
-- so drop and recreate. The admin_all_docs policy is untouched
-- and continues to grant full access when business_type = 'admin'.

drop policy if exists "own_docs" on epc_documents;

create policy "own_docs" on epc_documents for all
  using (
    business_id = (auth.jwt() ->> 'business_id')::uuid
    and category <> 'gst_r3b'
  );

-- ── (2) Unique partial index: max 1 'present' per business ──
-- Only rows that are both category = 'gst_r3b' AND have
-- metadata.period_type = 'present' participate in this index.
-- All other rows (other categories, or 'previous' GST R3B files)
-- are ignored by the index.

create unique index if not exists uniq_gst_r3b_present_per_biz
  on epc_documents (business_id)
  where category = 'gst_r3b'
    and (metadata ->> 'period_type') = 'present';
