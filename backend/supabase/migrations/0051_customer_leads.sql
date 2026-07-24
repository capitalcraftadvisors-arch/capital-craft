-- Non-EPC customer leads — captured from the marketing site's public lead form.
--
-- A customer with NO EPC enters their mobile number, picks Loan or Insurance,
-- and fills a short set of basic details. That creates a lightweight LEAD here
-- (source = 'non_epc'); the admin team then follows up and builds the full
-- profile. Deliberately a separate table so raw leads never mix with real EPC
-- loan/insurance applications (which require an epc_business_id).
--
-- rollback: drop table if exists customer_leads;

create table if not exists customer_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  lead_type     text not null check (lead_type in ('loan','insurance')),
  name          text,
  mobile        text not null,
  city          text,
  pincode       text,
  pan           text,
  aadhaar       text,
  project_cost  numeric,          -- loan
  loan_amount   numeric,          -- loan
  plant_value   numeric,          -- insurance
  gstin         text,             -- insurance (commercial)
  status        text not null default 'new'
                check (status in ('new','contacted','converted','closed')),
  source        text not null default 'non_epc',
  notes         text
);

create index if not exists customer_leads_created_idx on customer_leads (created_at desc);

alter table customer_leads enable row level security;

-- The lead form is public — anyone can submit a lead (INSERT only, no read).
drop policy if exists customer_leads_public_insert on customer_leads;
create policy customer_leads_public_insert on customer_leads
  for insert to anon, authenticated with check (true);

-- Only admins can read leads.
drop policy if exists customer_leads_admin_read on customer_leads;
create policy customer_leads_admin_read on customer_leads
  for select to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin');

-- Only admins can update a lead's status / notes.
drop policy if exists customer_leads_admin_update on customer_leads;
create policy customer_leads_admin_update on customer_leads
  for update to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin')
  with check (auth.jwt() ->> 'business_type' = 'admin');
