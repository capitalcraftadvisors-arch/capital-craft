-- =========================================================
-- 0053 — EPC admin info: split team size + numeric turnover (Lakhs)
--
-- Additive only. The old free-text columns are kept UNTOUCHED for
-- history — no parsing, no backfill:
--   team_size        (text)  — legacy combined value, shown as a hint
--   turnover_last_fy (text)  — legacy freeform value, shown as a hint
--
-- New structured columns the admin fills going forward:
--   team_technical      integer        — No. of Members (Technical)
--   team_non_technical  integer        — No. of Members (Non-Technical)
--   turnover_lakhs      numeric(14,2)  — Total turnover, in ₹ Lakhs
--
-- All nullable; no impact on existing rows or the EPC's own views
-- (epc_admin_info has NO EPC RLS policy — invisible to EPCs).
--
-- Rollback:
--   alter table epc_admin_info drop column if exists team_technical;
--   alter table epc_admin_info drop column if exists team_non_technical;
--   alter table epc_admin_info drop column if exists turnover_lakhs;
-- =========================================================

alter table epc_admin_info
  add column if not exists team_technical      integer,
  add column if not exists team_non_technical  integer,
  add column if not exists turnover_lakhs       numeric(14,2);
