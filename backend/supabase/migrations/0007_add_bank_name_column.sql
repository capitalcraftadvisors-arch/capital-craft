-- =========================================================
-- 0007 — Add bank_name column to epc_business.
--
-- Why: cheque OCR now extracts the bank name (derived from the
-- IFSC prefix, with a text-scan fallback). Storing it as a
-- first-class column keeps queries simple and matches the
-- existing pattern (bank_account_number, bank_ifsc, bank_branch).
--
-- Safety: additive only. Existing rows get bank_name = NULL.
-- IF NOT EXISTS makes the migration idempotent.
-- =========================================================

alter table epc_business add column if not exists bank_name text;
