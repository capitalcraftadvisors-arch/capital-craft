-- =========================================================
-- 0035 — PM Surya Ghar: total installed capacity under the scheme
--
-- A new free-text field captured right after the "Are you registered
-- with PM Surya Ghar Yojana?" question, shown only when the answer is
-- "yes". Free text (e.g. "500 KW") so EPCs can phrase units their way.
--
-- Reflects EVERYWHERE: additive + nullable, so every existing EPC reads
-- null until an admin fills it in Edit Profile; new EPCs are asked during
-- onboarding. The EPC client is unaffected.
--
-- Rollback:
--   alter table epc_business drop column if exists pm_surya_ghar_capacity;
-- =========================================================

alter table epc_business
  add column if not exists pm_surya_ghar_capacity text;
