-- =========================================================
-- 0031 — Residential / Commercial plant-use question (Step 1)
--
-- Asked on BOTH loan-application entry flows (admin Step 1 and the
-- EPC-facing apply Page 1). Nullable so existing applications stay
-- valid; new submissions require it via route validation.
--
-- Rollback:
--   alter table epc_applications drop column if exists plant_use_type;
-- =========================================================

alter table epc_applications
  add column if not exists plant_use_type text
    check (plant_use_type is null or plant_use_type in ('residential', 'commercial'));
