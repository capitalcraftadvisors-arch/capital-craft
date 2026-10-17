-- 0093 — "Other Insurance": general (non-solar) insurance files, MAIN ADMIN only.
--
-- No EPC. A file is: customer name, any number of KYC documents, the policy
-- document, the validity period, plus optional sum insured / insurance company.
-- KYC docs are a jsonb list [{ path, name, mime }] of GCS objects under
-- other-insurance/<id>/. Managers / RMs (MANAGER, OPERATIONS_USER) and EPCs
-- can't read or write it; a legacy admin JWT with no hierarchy_role counts as
-- the main admin (as 0067 / 0092).

create sequence if not exists other_insurance_seq;

create table if not exists other_insurance (
  id                 uuid primary key default gen_random_uuid(),
  display_id         text unique default ('OI-' || lpad(nextval('other_insurance_seq')::text, 4, '0')),
  customer_name      text,
  sum_insured        numeric,
  insurance_company  text,
  policy_path        text,
  policy_from_date   date,
  policy_to_date     date,
  kyc_docs           jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  created_by_user_id uuid
);

alter table other_insurance enable row level security;

drop policy if exists main_admin_all_other_insurance on other_insurance;
create policy main_admin_all_other_insurance on other_insurance for all
  using (auth.jwt() ->> 'business_type' = 'admin' and coalesce(auth.jwt() ->> 'hierarchy_role', '') in ('MAIN_ADMIN', ''))
  with check (auth.jwt() ->> 'business_type' = 'admin' and coalesce(auth.jwt() ->> 'hierarchy_role', '') in ('MAIN_ADMIN', ''));

grant select, insert, update, delete on other_insurance to authenticated;
grant usage on sequence other_insurance_seq to authenticated;
