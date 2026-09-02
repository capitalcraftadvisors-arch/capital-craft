-- =========================================================
-- 0075 — Move the OCR raw-text audit blob off epc_applications
--
-- WHY (egress): epc_applications.ocr_raw_text holds the FULL raw text of every
-- document OCR'd for an application (Aadhaar front/back, PAN, e-bill,
-- quotation, bank statement, Gemini JSON). It is audit/debug-only — no screen
-- reads it — yet every single-row page load that does select("*") on
-- epc_applications (view, approval, intake, disbursement, ZIP/email routes)
-- downloads it and discards it. On the Free plan that was a material share of
-- the 5 GB/month egress quota.
--
-- WHAT: keep the data, move it to its own table. select("*") on
-- epc_applications then naturally stops carrying the blob — ZERO app-code
-- changes, nothing lost, OCR extraction untouched. append_ocr_raw keeps its
-- exact signature so the four extract-* routes keep working as-is.
--
-- Rollback (restores the column + old function; data is copied back):
--   alter table epc_applications add column if not exists ocr_raw_text jsonb not null default '{}'::jsonb;
--   update epc_applications a set ocr_raw_text = o.ocr_raw_text from loan_app_ocr_raw o where o.application_id = a.id;
--   create or replace function append_ocr_raw(app_id uuid, key_name text, raw_text text) returns void as $$
--   begin update epc_applications set ocr_raw_text = coalesce(ocr_raw_text,'{}'::jsonb) || jsonb_build_object(key_name, raw_text) where id = app_id; end;
--   $$ language plpgsql;
--   drop table if exists loan_app_ocr_raw;
-- =========================================================

-- ── 1. Side table (one row per application) ──────────────────
create table if not exists loan_app_ocr_raw (
  application_id uuid primary key references epc_applications(id) on delete cascade,
  ocr_raw_text   jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

-- Admin-only reads (audit data). Writes happen only through the SECURITY
-- DEFINER function below, so the EPC-facing apply flow — which also calls the
-- extract-* routes — keeps working without a policy of its own.
alter table loan_app_ocr_raw enable row level security;
drop policy if exists loan_app_ocr_raw_admin_read on loan_app_ocr_raw;
create policy loan_app_ocr_raw_admin_read on loan_app_ocr_raw
  for select to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin');

-- ── 2. Copy existing audit data across (non-empty only) ──────
insert into loan_app_ocr_raw (application_id, ocr_raw_text)
select id, ocr_raw_text
  from epc_applications
 where ocr_raw_text is not null and ocr_raw_text <> '{}'::jsonb
on conflict (application_id) do update
  set ocr_raw_text = excluded.ocr_raw_text, updated_at = now();

-- ── 3. Repoint the atomic merge helper (same signature) ──────
create or replace function append_ocr_raw(
  app_id      uuid,
  key_name    text,
  raw_text    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into loan_app_ocr_raw (application_id, ocr_raw_text, updated_at)
  values (app_id, jsonb_build_object(key_name, raw_text), now())
  on conflict (application_id) do update
    set ocr_raw_text = coalesce(loan_app_ocr_raw.ocr_raw_text, '{}'::jsonb)
                       || jsonb_build_object(key_name, raw_text),
        updated_at   = now();
end;
$$;

-- ── 4. Drop the blob from the hot table ──────────────────────
alter table epc_applications drop column if exists ocr_raw_text;
