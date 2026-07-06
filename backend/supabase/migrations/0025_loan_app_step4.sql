-- =========================================================
-- 0025 — Loan application Step 4 (Personal Details)
--
-- Additive columns on epc_applications for:
--   - Employment info (type, profession, org, income)
--   - Bank statement upload (method + doc path + timestamp)
--   - Retrieved bank information (holder, name, account no, IFSC, etc.)
--
-- All nullable / no backfill.
--
-- Note on numbering: the Step 4 spec requested "MIGRATION 0026" but
-- previous migration was 0024, so this file is 0025 to keep the
-- sequence tight. Same convention we've been using for the loan-app
-- migrations.
--
-- PRIVACY NOTE: bank_account_no stores the FULL account number
-- (per spec — not masked). Callers should apply access controls at
-- the RLS / admin-only-route layer. Existing admin-only RLS on
-- epc_applications from 0002 covers this.
--
-- Rollback: see block at the bottom.
-- =========================================================


-- ── Employment info ──────────────────────────────────────────
alter table epc_applications
  add column if not exists employment_type    text
    check (employment_type is null or employment_type in ('salaried','self_employed')),
  add column if not exists profession         text,
  add column if not exists profession_other   text,
  add column if not exists organization_name  text,
  add column if not exists annual_income      numeric(14,2);


-- ── Bank statement upload ────────────────────────────────────
-- Method captures HOW the statement was sourced. For now the UI
-- offers two options; the enum is text so future methods (Account
-- Aggregator, netbanking-login) can slot in without a migration.
alter table epc_applications
  add column if not exists bank_statement_method  text
    check (bank_statement_method is null or bank_statement_method in ('manual_epdf','scanned_pdf')),
  add column if not exists bank_statement_path         text,
  add column if not exists bank_statement_uploaded_at  timestamptz;


-- ── Retrieved bank information ───────────────────────────────
-- These are OCR-prefilled and admin-editable. Full account number is
-- persisted per Step 4 spec (see PRIVACY NOTE above).
alter table epc_applications
  add column if not exists bank_account_holder text,
  add column if not exists bank_name           text,
  add column if not exists bank_account_no     text,
  add column if not exists bank_ifsc           text,
  add column if not exists bank_account_type   text,
  add column if not exists bank_mobile         text,
  add column if not exists bank_email          text;


-- ── Progress timestamp ───────────────────────────────────────
alter table epc_applications
  add column if not exists step4_completed_at timestamptz;


-- =========================================================
-- Rollback (destructive):
--   alter table epc_applications drop column if exists step4_completed_at;
--   alter table epc_applications drop column if exists bank_email;
--   alter table epc_applications drop column if exists bank_mobile;
--   alter table epc_applications drop column if exists bank_account_type;
--   alter table epc_applications drop column if exists bank_ifsc;
--   alter table epc_applications drop column if exists bank_account_no;
--   alter table epc_applications drop column if exists bank_name;
--   alter table epc_applications drop column if exists bank_account_holder;
--   alter table epc_applications drop column if exists bank_statement_uploaded_at;
--   alter table epc_applications drop column if exists bank_statement_path;
--   alter table epc_applications drop column if exists bank_statement_method;
--   alter table epc_applications drop column if exists annual_income;
--   alter table epc_applications drop column if exists organization_name;
--   alter table epc_applications drop column if exists profession_other;
--   alter table epc_applications drop column if exists profession;
--   alter table epc_applications drop column if exists employment_type;
-- =========================================================
