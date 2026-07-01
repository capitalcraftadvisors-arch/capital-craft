-- =========================================================
-- 0013 — Group 1: trade_name column
--
-- Populated by extract-gst-legalname (already deployed;
-- already returns trade_name). Editable in Step 2 and in
-- the admin EPC detail page. Nullable — legacy rows keep
-- NULL; never retroactively required.
--
-- Rollback:
--    alter table epc_business drop column if exists trade_name;
-- =========================================================

alter table epc_business
  add column if not exists trade_name text;
