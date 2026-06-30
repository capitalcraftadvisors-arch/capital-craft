-- =========================================================
-- 0012 — Batch A:
--   (1) epc_business.legal_name (text, nullable)
--   (2) epc_lender_status (new table, admin-only)
--   (3) epc_business.pm_surya_ghar (yes/no/other)
--       epc_business.pm_surya_ghar_other (free text when 'other')
--
-- All additive. Legacy EPCs onboarded before this migration
-- stay NULL on the new columns and have no lender rows.
-- Required-ness on the new fields is enforced ONLY in the
-- onboarding form for status='draft' (new flow). Self-edit
-- and legacy EPCs are never retroactively blocked.
--
-- Rollback:
--    drop trigger if exists trg_lender_status_updated on epc_lender_status;
--    drop table if exists epc_lender_status;
--    alter table epc_business drop column if exists legal_name;
--    alter table epc_business drop column if exists pm_surya_ghar;
--    alter table epc_business drop column if exists pm_surya_ghar_other;
-- =========================================================

-- ── (1) legal_name column ───────────────────────────────────
-- Populated from extract-gst-legalname OCR when the EPC uploads
-- a GST registration document in Step 2. Editable by admin
-- (admin EPC detail) and EPC (Step 2 form).
alter table epc_business
  add column if not exists legal_name text;


-- ── (2) lender status table ─────────────────────────────────
-- Per-EPC per-lender state for CreditFair / Aerem / Solfin.
-- Rows are LAZY — created on first toggle. Missing row => both false.
-- RLS: ADMIN-ONLY. EPCs cannot SELECT, INSERT, UPDATE or DELETE.
create table if not exists epc_lender_status (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references epc_business(id) on delete cascade,
  lender      text not null check (lender in ('creditfair', 'aerem', 'solfin')),
  docs_given  boolean not null default false,
  approved    boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (business_id, lender)
);

create index if not exists idx_lender_status_business
  on epc_lender_status (business_id);

alter table epc_lender_status enable row level security;

create policy "admin_all_lender_status" on epc_lender_status for all
  using ((auth.jwt() ->> 'business_type') = 'admin');
-- NO EPC policy — invisible to EPCs.

drop trigger if exists trg_lender_status_updated on epc_lender_status;
create trigger trg_lender_status_updated
  before update on epc_lender_status
  for each row execute function set_updated_at();


-- ── (3) PM Surya Ghar Yojana registration ───────────────────
-- Two fields. pm_surya_ghar holds the choice (yes/no/other).
-- pm_surya_ghar_other holds the free-text entity name when the
-- EPC picked 'other'. Both nullable so legacy EPCs (and EPCs
-- in self-edit) are not retroactively required to provide them.
alter table epc_business
  add column if not exists pm_surya_ghar text
    check (pm_surya_ghar in ('yes', 'no', 'other'));
alter table epc_business
  add column if not exists pm_surya_ghar_other text;
