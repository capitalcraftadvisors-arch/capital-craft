-- =========================================================
-- 0038 — 'rejected' tick per lender on epc_lender_status
--
-- Adds a third per-lender marker beside docs_given / approved. Rejected
-- is a STATUS MARKER only — it triggers no automatic action. The
-- has_lender_approval unlock logic (0017) reads ONLY `approved`, so it
-- is completely unaffected by this column.
--
-- Mutual exclusivity: a lender cannot be both approved and rejected.
-- The app writes both fields together (ticking one unticks the other);
-- the CHECK below is a DB-level safety net. Existing rows have
-- rejected=false so (approved AND rejected) is always false — the
-- constraint is satisfied without any backfill.
--
-- Rollback:
--   alter table epc_lender_status drop constraint if exists lender_not_both;
--   alter table epc_lender_status drop column if exists rejected_at;
--   alter table epc_lender_status drop column if exists rejected;
-- =========================================================

alter table epc_lender_status
  add column if not exists rejected    boolean not null default false,
  add column if not exists rejected_at timestamptz;

alter table epc_lender_status
  drop constraint if exists lender_not_both;
alter table epc_lender_status
  add constraint lender_not_both check (not (approved and rejected));
