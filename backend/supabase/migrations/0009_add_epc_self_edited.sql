-- =========================================================
-- 0009 — Add EPC self-edit lock columns to epc_business.
--
-- epc_self_edited     boolean   — flips TRUE on the EPC's
--                                 one-time self-edit submit.
-- epc_self_edited_at  timestamptz — when the flip happened.
--
-- Once TRUE, the EPC is permanently blocked from further writes
-- (enforced by triggers added in migration 0010). Admins remain
-- unrestricted.
--
-- Safety: additive. Default FALSE. Idempotent.
-- =========================================================

alter table epc_business
  add column if not exists epc_self_edited boolean not null default false;
alter table epc_business
  add column if not exists epc_self_edited_at timestamptz;
