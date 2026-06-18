-- =========================================================
-- Capital Craft — consolidated schema (v1)
-- 4 tables, 5 enums, 2 updated_at triggers.
-- =========================================================

-- ────────── Enums ──────────

create type business_type as enum (
  'proprietorship', 'pvt_ltd', 'partnership', 'llp',
  'admin'   -- internal only; never shown in frontend dropdown
);

create type onboarding_status as enum (
  'draft', 'under_review', 'approved', 'on_hold', 'rejected'
);

create type epc_doc_category as enum (
  'pan_business', 'gstin', 'extra_doc',
  'stakeholder_pan', 'stakeholder_aadhaar',
  'cancelled_cheque',
  'office_exterior', 'office_interior', 'office_selfie'
);

create type loan_status as enum (
  'draft', 'submitted', 'under_review', 'on_hold',
  'approved', 'rejected', 'sent_to_nbfc', 'disbursed'
);

create type loan_doc_category as enum (
  'borrower_pan', 'borrower_aadhaar', 'borrower_photo',
  'bank_statement', 'income_proof', 'electricity_bill',
  'property_doc', 'quotation', 'other'
);


-- ────────── Table 1: epc_business ──────────
-- The onboarded EPC entity. Stakeholders + references embedded as JSONB.

create table epc_business (
  id                  uuid primary key default gen_random_uuid(),
  status              onboarding_status not null default 'draft',
  current_step        smallint not null default 1,

  -- Step 1: Personal / primary contact
  contact_name        text,
  contact_mobile      text unique,            -- resume key + login key
  contact_designation text,

  -- Step 2: Business
  business_type       business_type,
  pan_number          text,                   -- validated AAAAA9999A

  -- Step 4: Bank (OCR-filled, editable)
  bank_account_number text,
  bank_ifsc           text,
  bank_branch         text,
  bank_account_holder text,
  cheque_ocr_raw      jsonb,

  -- Step 3: Stakeholders (embedded JSONB)
  stakeholders        jsonb not null default '[]'::jsonb,

  -- Step 6: References (embedded JSONB)
  business_references jsonb not null default '[]'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  submitted_at        timestamptz
);


-- ────────── Table 2: epc_documents ──────────
-- All documents uploaded during EPC onboarding.

create table epc_documents (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references epc_business(id) on delete cascade,
  stakeholder_id      uuid,                   -- soft ref into stakeholders[].id (no FK)
  category            epc_doc_category not null,
  storage_path        text not null,
  file_name           text,
  mime_type           text,
  original_size_bytes bigint,
  stored_size_bytes   bigint,
  metadata            jsonb,                  -- { lat, lng, captured_at } for photos
  created_at          timestamptz not null default now()
);

-- "Only one" constraints (Aadhaar deliberately omitted → 1 or many allowed)
create unique index uniq_business_pan_doc on epc_documents(business_id)
  where category = 'pan_business';
create unique index uniq_gstin_doc on epc_documents(business_id)
  where category = 'gstin';
create unique index uniq_cheque_doc on epc_documents(business_id)
  where category = 'cancelled_cheque';
create unique index uniq_stakeholder_pan on epc_documents(business_id, stakeholder_id)
  where category = 'stakeholder_pan';

create index idx_epc_docs_business    on epc_documents(business_id);
create index idx_epc_docs_stakeholder on epc_documents(stakeholder_id);


-- ────────── Table 3: epc_applications ──────────
-- Loan applications. Source of truth for Ops/admin and NBFC handoff.

create table epc_applications (
  id                 uuid primary key default gen_random_uuid(),

  -- Origin
  epc_business_id    uuid not null references epc_business(id) on delete restrict,
  created_by         text not null default 'epc',     -- 'epc' | 'admin'
  status             loan_status not null default 'draft',

  -- Borrower (consumer) — denormalized for v1
  borrower_name      text,
  borrower_mobile    text,
  borrower_email     text,
  borrower_pan       text,
  borrower_dob       date,
  borrower_address   text,
  borrower_pincode   text,
  borrower_city      text,
  borrower_state     text,

  -- Loan / solar system
  loan_amount        numeric(12,2),
  tenure_months      smallint,
  system_capacity_kw numeric(6,2),
  system_cost        numeric(12,2),
  down_payment       numeric(12,2),
  install_address    text,

  -- Credit context (lender-driven, optional)
  monthly_income     numeric(12,2),
  employment_type    text,

  -- Flexible bucket for lender-specific fields
  extra              jsonb not null default '{}'::jsonb,

  -- Admin review
  assigned_to        text,
  review_notes       text,
  reviewed_by        text,
  reviewed_at        timestamptz,
  status_history     jsonb not null default '[]'::jsonb,

  -- NBFC handoff
  nbfc_name          text,
  nbfc_submitted_at  timestamptz,
  nbfc_decision      text,
  nbfc_decision_at   timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  submitted_at       timestamptz
);

create index idx_loan_business on epc_applications(epc_business_id);
create index idx_loan_status   on epc_applications(status);
create index idx_loan_created  on epc_applications(created_at desc);


-- ────────── Table 4: user_application_docs ──────────
-- Documents uploaded for a loan application (borrower KYC, proofs, etc.)

create table user_application_docs (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null references epc_applications(id) on delete cascade,
  category            loan_doc_category not null,
  storage_path        text not null,
  file_name           text,
  mime_type           text,
  original_size_bytes bigint,
  stored_size_bytes   bigint,
  uploaded_by         text,                   -- 'epc' | 'admin'
  metadata            jsonb,
  created_at          timestamptz not null default now()
);

create index idx_userdocs_application on user_application_docs(application_id);
create index idx_userdocs_category    on user_application_docs(application_id, category);


-- ────────── Triggers ──────────

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_epc_business_updated
  before update on epc_business
  for each row execute function set_updated_at();

create trigger trg_epc_applications_updated
  before update on epc_applications
  for each row execute function set_updated_at();
