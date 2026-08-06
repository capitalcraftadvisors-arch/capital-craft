-- =========================================================
-- 0062 — Loan leads (admin-created early-stage loan leads)
--
-- DISTINCT from customer_leads (non-EPC marketing leads, migration 0051).
-- These are created by an admin via a 2-step onboarding wizard and, when
-- the admin marks one "ready for loan application", converted into an
-- epc_applications DRAFT (the lead then disappears from the Lead dashboard).
--
-- Lifecycle: draft (mid-onboarding) → under_review (submitted, shown in the
-- dashboard) → converted (hidden; a loan application now exists).
--
-- Rollback:
--   drop table if exists loan_leads;
--   drop function if exists set_loan_lead_display_id();
--   drop sequence if exists loan_lead_seq;
-- =========================================================

create table if not exists loan_leads (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  lead_display_id   text unique,
  -- Step 1
  name              text,
  mobile            text,
  address           text,
  dob               date,
  -- Step 2
  loan_amount       numeric(14,2),
  project_size      numeric(12,4),
  project_size_unit text default 'kw' check (project_size_unit in ('kw','mw')),
  email             text,
  epc_business_id   uuid references epc_business(id) on delete set null,
  epc_name_custom   text,
  -- lifecycle
  status            text not null default 'draft'
                    check (status in ('draft','under_review','converted')),
  current_step      smallint not null default 1,
  converted_application_id uuid references epc_applications(id) on delete set null,
  converted_at      timestamptz,
  reviewed_at       timestamptz,
  created_by        text not null default 'admin'
);

-- ── Display id: LEAD-##### via a sequence + BEFORE INSERT trigger ───
create sequence if not exists loan_lead_seq start with 1;

create or replace function set_loan_lead_display_id() returns trigger as $$
begin
  if new.lead_display_id is null then
    new.lead_display_id := 'LEAD-' || lpad(nextval('loan_lead_seq')::text, 5, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_loan_lead_display_id on loan_leads;
create trigger trg_loan_lead_display_id
  before insert on loan_leads
  for each row execute function set_loan_lead_display_id();

-- ── RLS: admin-only for every operation ────────────────────────────
alter table loan_leads enable row level security;

drop policy if exists loan_leads_admin_all on loan_leads;
create policy loan_leads_admin_all on loan_leads
  for all to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin')
  with check (auth.jwt() ->> 'business_type' = 'admin');

create index if not exists loan_leads_created_idx on loan_leads (created_at desc);
create index if not exists loan_leads_status_idx  on loan_leads (status);
