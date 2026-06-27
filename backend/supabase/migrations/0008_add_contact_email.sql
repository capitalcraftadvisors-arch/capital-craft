-- =========================================================
-- 0008 — Add contact_email column to epc_business.
--
-- Required by the new Step 1 (Personal details) form: email is
-- a required field on the EPC-facing onboarding wizard. The
-- user cannot proceed past Step 1 without a valid email.
--
-- Safety: additive only. Existing rows get contact_email = NULL,
-- which is fine — validation lives in the form, not at the DB
-- layer (matches the pattern used by pan_number, bank fields,
-- etc.). IF NOT EXISTS makes the migration idempotent.
-- =========================================================

alter table epc_business add column if not exists contact_email text;
