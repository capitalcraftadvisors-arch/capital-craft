-- =========================================================
-- 0046 — insurance_applications: the new insurance track.
--
-- Parallel to epc_applications (loans) but gated ONLY by service_type — no
-- lender approval. One row per insurance application, owned by an EPC.
--
-- Documents are stored as *_path columns (same approach the loan flow uses
-- for Aadhaar / e-bill / bank statement) so no new docs table / enum is
-- needed; the OCR routes upload to GCS under insurance/{id}/… and write the
-- path back here.
--
-- ID: INS-<mobile-last-5>-<5-digit sequence>, frozen at creation. Reuses
-- epc_display_last5() from 0016; its own sequence insurance_display_seq.
--
-- RLS: EPC sees its own rows (business_id), admin sees all. A BEFORE INSERT
-- gate mirrors the loan gate (0017): a non-admin caller can only create an
-- insurance application when their EPC's service_type is 'insurance'|'both'.
--
-- Rollback:
--   drop trigger if exists trg_enforce_insurance_gate on insurance_applications;
--   drop function if exists enforce_insurance_gate();
--   drop trigger if exists trg_insurance_display_id on insurance_applications;
--   drop trigger if exists trg_insurance_updated on insurance_applications;
--   drop function if exists insurance_assign_display_id();
--   drop function if exists insurance_format_display_id(text, bigint);
--   drop table if exists insurance_applications;
--   drop sequence if exists insurance_display_seq;
-- =========================================================

create sequence if not exists insurance_display_seq start with 1;

create table if not exists insurance_applications (
  id                    uuid primary key default gen_random_uuid(),
  epc_business_id       uuid not null references epc_business(id) on delete cascade,
  insurance_display_id  text unique,
  status                text not null default 'draft',
  current_step          smallint not null default 1,
  created_by            text,                  -- 'epc' | 'admin'

  -- Step 1 — PAN + Aadhaar (mandatory), GST (optional)
  pan_number            text,
  pan_path              text,
  aadhaar_name          text,
  aadhaar_dob           text,
  aadhaar_gender        text,
  aadhaar_number        text,
  aadhaar_number_masked text,
  aadhaar_care_of       text,
  aadhaar_address       text,
  aadhaar_front_path    text,
  aadhaar_back_path     text,
  aadhaar_face_path     text,
  gst_path              text,

  -- Step 2 — plant photo + address + invoice
  plant_photo_path      text,
  plant_photo_gps       jsonb,
  plant_address         text,
  invoice_path          text,
  invoice_amount        numeric,               -- OCR-detected
  invoice_confirmed_amount numeric,            -- EPC-confirmed (cheque-style reconfirm)
  invoice_ocr_raw       text,

  step1_completed_at    timestamptz,
  step2_completed_at    timestamptz,
  submitted_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_insurance_business on insurance_applications(epc_business_id);

alter table insurance_applications
  drop constraint if exists insurance_applications_status_check;
alter table insurance_applications
  add constraint insurance_applications_status_check
  check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected'));

-- ── INS-<last5>-<seq5> ───────────────────────────────────
create or replace function insurance_format_display_id(mobile text, seq bigint) returns text as $$
  select 'INS-' || epc_display_last5(mobile) || '-' || lpad(seq::text, 5, '0');
$$ language sql immutable;

create or replace function insurance_assign_display_id() returns trigger as $$
declare m text;
begin
  if new.insurance_display_id is null then
    select contact_mobile into m from epc_business where id = new.epc_business_id;
    new.insurance_display_id := insurance_format_display_id(m, nextval('insurance_display_seq'));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_insurance_display_id on insurance_applications;
create trigger trg_insurance_display_id
  before insert on insurance_applications
  for each row execute function insurance_assign_display_id();

drop trigger if exists trg_insurance_updated on insurance_applications;
create trigger trg_insurance_updated
  before update on insurance_applications
  for each row execute function set_updated_at();

-- ── RLS ──────────────────────────────────────────────────
alter table insurance_applications enable row level security;

create policy "own_insurance" on insurance_applications for all
  using (epc_business_id = (auth.jwt() ->> 'business_id')::uuid);

create policy "admin_all_insurance" on insurance_applications for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- ── Server gate — insurance requires service_type in (insurance, both) ──
create or replace function enforce_insurance_gate() returns trigger as $$
declare
  caller_type text;
  svc         text;
begin
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type = 'admin' then return new; end if;   -- admin bypasses
  if caller_type is null then return new; end if;     -- service role

  select service_type into svc from epc_business where id = new.epc_business_id;
  if svc is null or svc not in ('insurance', 'both') then
    raise exception 'insurance_not_enabled' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_enforce_insurance_gate on insurance_applications;
create trigger trg_enforce_insurance_gate
  before insert on insurance_applications
  for each row execute function enforce_insurance_gate();
