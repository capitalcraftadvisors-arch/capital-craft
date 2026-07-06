-- =========================================================
-- 0024 — Loan application Step 3 (Loan Requirements)
--
-- Additive columns on epc_applications for:
--   - Proforma invoice + electricity bill uploads and OCR results
--   - Project size + costs + loan-amount requested
--   - Electricity connection details (DISCOM, CA number, bill amount)
--   - Bill ownership boolean + co-applicant fields
--
-- Reconciled with migration 0022 — install_pincode / install_state /
-- install_city / install_district already exist there and are REUSED
-- by Step 3 for the Installation Address block. No duplicate columns.
--
-- All nullable / no backfill. Existing rows stay NULL until their
-- application reaches Step 3.
--
-- Note on numbering: the Step 3 spec requested "MIGRATION 0025" but
-- the previous migration was 0023, so this file is 0024 to keep the
-- sequence tight. Behaviour unchanged.
--
-- Rollback: see block at the bottom.
-- =========================================================


-- ── Document uploads ─────────────────────────────────────────
alter table epc_applications
  add column if not exists proforma_invoice_path text,
  add column if not exists proforma_uploaded_at  timestamptz,
  add column if not exists ebill_path            text,
  add column if not exists ebill_uploaded_at     timestamptz;


-- ── Project + loan ───────────────────────────────────────────
-- project_size stored as numeric with a separate unit ('kw' or 'mw')
-- so we don't lose precision on decimals when the admin picks MW.
alter table epc_applications
  add column if not exists project_size          numeric(12,4),
  add column if not exists project_size_unit     text
    check (project_size_unit is null or project_size_unit in ('kw','mw')),
  add column if not exists total_project_cost    numeric(14,2),
  add column if not exists loan_amount_required  numeric(14,2);


-- ── Electricity connection ───────────────────────────────────
alter table epc_applications
  add column if not exists monthly_bill_amount   numeric(12,2),
  add column if not exists discom_name           text,
  add column if not exists ca_number             text;


-- ── Installation address (extends 0022's install_pincode/state/city) ──
-- ebill_address_line captures the free-form street/line pulled from
-- the electricity bill. Pincode / state / city continue to live in
-- install_pincode / install_state / install_city from 0022.
alter table epc_applications
  add column if not exists ebill_address_line    text,
  add column if not exists ebill_name            text;


-- ── Bill ownership + co-applicant ────────────────────────────
-- bill_on_applicant_name: TRUE when the bill is in the applicant's
-- name (no co-applicant needed), FALSE when a co-applicant is added.
-- NULL means the admin hasn't answered yet.
alter table epc_applications
  add column if not exists bill_on_applicant_name boolean;

alter table epc_applications
  add column if not exists coapp_pan         text,
  add column if not exists coapp_name        text,
  add column if not exists coapp_father_name text,
  add column if not exists coapp_dob         text,
  add column if not exists coapp_relation    text,
  add column if not exists coapp_mobile      text,
  add column if not exists coapp_email       text,
  add column if not exists coapp_pan_path    text;


-- ── Progress timestamp ───────────────────────────────────────
alter table epc_applications
  add column if not exists step3_completed_at timestamptz;


-- =========================================================
-- Rollback (destructive):
--   alter table epc_applications drop column if exists step3_completed_at;
--   alter table epc_applications drop column if exists coapp_pan_path;
--   alter table epc_applications drop column if exists coapp_email;
--   alter table epc_applications drop column if exists coapp_mobile;
--   alter table epc_applications drop column if exists coapp_relation;
--   alter table epc_applications drop column if exists coapp_dob;
--   alter table epc_applications drop column if exists coapp_father_name;
--   alter table epc_applications drop column if exists coapp_name;
--   alter table epc_applications drop column if exists coapp_pan;
--   alter table epc_applications drop column if exists bill_on_applicant_name;
--   alter table epc_applications drop column if exists ebill_name;
--   alter table epc_applications drop column if exists ebill_address_line;
--   alter table epc_applications drop column if exists ca_number;
--   alter table epc_applications drop column if exists discom_name;
--   alter table epc_applications drop column if exists monthly_bill_amount;
--   alter table epc_applications drop column if exists loan_amount_required;
--   alter table epc_applications drop column if exists total_project_cost;
--   alter table epc_applications drop column if exists project_size_unit;
--   alter table epc_applications drop column if exists project_size;
--   alter table epc_applications drop column if exists ebill_uploaded_at;
--   alter table epc_applications drop column if exists ebill_path;
--   alter table epc_applications drop column if exists proforma_uploaded_at;
--   alter table epc_applications drop column if exists proforma_invoice_path;
-- =========================================================
