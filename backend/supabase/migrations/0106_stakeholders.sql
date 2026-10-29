-- 0106 — Stakeholders (/admin/stakeholders, main admin only).
--
--   team_profiles     the CC team member's profile (designation, joining date,
--                     address, emergency contact …) beside their admin login row
--   partners          lenders + insurance partners, each with its details;
--                     lender_key links a portal lender (creditfair / aerem / solfin)
--   stakeholder_docs  documents of a team member OR a partner (Aadhaar, offer
--                     letter, lender policy, agreement …) — `category` is the
--                     document's label; files live in GCS like every other doc
--
-- All three are the main admin's only (same rule as the team's login passwords).

create or replace function is_main_admin()
returns boolean language sql stable as $$
  select (auth.jwt() ->> 'business_type') = 'admin'
     and coalesce(auth.jwt() ->> 'hierarchy_role', '') in ('MAIN_ADMIN', '')
$$;

create table if not exists team_profiles (
  business_id uuid primary key references epc_business(id) on delete cascade,
  details     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists partners (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('lender', 'insurance')),
  name       text not null,
  lender_key text unique,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stakeholder_docs (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid references epc_business(id) on delete cascade,
  partner_id          uuid references partners(id) on delete cascade,
  category            text not null,
  storage_path        text not null,
  file_name           text,
  mime_type           text,
  original_size_bytes bigint,
  stored_size_bytes   bigint,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  check ((team_id is null) <> (partner_id is null))
);
create index if not exists stakeholder_docs_team_idx    on stakeholder_docs (team_id);
create index if not exists stakeholder_docs_partner_idx on stakeholder_docs (partner_id);

alter table team_profiles    enable row level security;
alter table partners         enable row level security;
alter table stakeholder_docs enable row level security;

drop policy if exists main_admin_all on team_profiles;
create policy main_admin_all on team_profiles for all using (is_main_admin()) with check (is_main_admin());
drop policy if exists main_admin_all on partners;
create policy main_admin_all on partners for all using (is_main_admin()) with check (is_main_admin());
drop policy if exists main_admin_all on stakeholder_docs;
create policy main_admin_all on stakeholder_docs for all using (is_main_admin()) with check (is_main_admin());

-- The partners the portal already works with.
insert into partners (kind, name, lender_key) values
  ('lender', 'Credit Fair', 'creditfair'),
  ('lender', 'Aerem', 'aerem'),
  ('lender', 'Solfin', 'solfin')
on conflict (lender_key) do nothing;
insert into partners (kind, name)
select 'insurance', 'SBI General Insurance'
where not exists (select 1 from partners where kind = 'insurance' and name = 'SBI General Insurance');
