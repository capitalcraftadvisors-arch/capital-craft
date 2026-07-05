-- =========================================================
-- 0020 — DB-layer guard against deleting an admin account.
--
-- Companion to migration 0019's prevent_admin_demotion_trg
-- (which blocks UPDATE that flips business_type off 'admin').
-- This trigger closes the second hole: a DELETE that would
-- wipe the admin row entirely.
--
-- Layers of defense against losing admin access (in order):
--   1. UI: DeleteEpcModal / View page hide the button when
--      biz.business_type = 'admin'.
--   2. API: /api/admin/delete-epc rejects with 403 when the
--      target row's business_type = 'admin', BEFORE issuing
--      any DELETE.
--   3. API SQL guard: the DELETE itself carries a
--      "AND business_type != 'admin'" WHERE clause, so even
--      if step 2 is bypassed the query affects 0 rows.
--   4. DB trigger (THIS FILE): last-line block that raises
--      an exception regardless of caller. Covers Supabase
--      Studio, direct psql, service-role scripts, everything.
--
-- Rollback:
--   drop trigger if exists trg_prevent_admin_delete on epc_business;
--   drop function if exists prevent_admin_delete();
-- =========================================================

create or replace function prevent_admin_delete() returns trigger as $$
begin
  if old.business_type = 'admin' then
    raise exception 'cannot delete admin row (id=%)', old.id
      using errcode = '42501';
  end if;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_admin_delete on epc_business;
create trigger trg_prevent_admin_delete
  before delete on epc_business
  for each row execute function prevent_admin_delete();
