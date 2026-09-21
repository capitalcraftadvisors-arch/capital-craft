-- 0081 — hidden demo tenant flag.
--
-- Rows flagged is_demo=true are shown on the EPC's OWN portal (/dashboard) but
-- hidden from every admin/team surface, so a demo EPC (e.g. "Pri Solars") can
-- be rehearsed without disturbing live work. To remove the demo later, delete
-- the flagged rows (and the demo epc_business); the columns can stay.
--
-- Additive + invisible to existing data: default false, and the inherit trigger
-- resolves to false for every real EPC's applications.

alter table public.epc_business           add column if not exists is_demo boolean not null default false;
alter table public.epc_applications        add column if not exists is_demo boolean not null default false;
alter table public.insurance_applications  add column if not exists is_demo boolean not null default false;

create index if not exists idx_epc_business_is_demo          on public.epc_business(is_demo)          where is_demo;
create index if not exists idx_epc_applications_is_demo       on public.epc_applications(is_demo)       where is_demo;
create index if not exists idx_insurance_applications_is_demo on public.insurance_applications(is_demo) where is_demo;

-- Any application created BY a demo EPC inherits the flag automatically, so a
-- demo login that uses the real chatbot / apply flow stays hidden too.
create or replace function public.inherit_is_demo() returns trigger
language plpgsql as $$
begin
  if not coalesce(new.is_demo, false) then
    new.is_demo := coalesce((select is_demo from public.epc_business where id = new.epc_business_id), false);
  end if;
  return new;
end $$;

drop trigger if exists trg_inherit_is_demo on public.epc_applications;
create trigger trg_inherit_is_demo before insert on public.epc_applications
  for each row execute function public.inherit_is_demo();

drop trigger if exists trg_inherit_is_demo on public.insurance_applications;
create trigger trg_inherit_is_demo before insert on public.insurance_applications
  for each row execute function public.inherit_is_demo();

-- Hide demo rows from EVERYONE except the demo EPC itself. A RESTRICTIVE SELECT
-- policy AND-combines with the existing permissive policies, so the admin/team
-- console (business_type='admin') and every other EPC stop seeing demo rows at
-- the DB layer — no per-query filtering, no surface can leak. The demo EPC still
-- sees its own rows via the "own row" branch. (service_role / direct postgres
-- bypass RLS, so seed + maintenance scripts are unaffected.)
drop policy if exists hide_demo_business on public.epc_business;
create policy hide_demo_business on public.epc_business
  as restrictive for select to public
  using (is_demo = false OR id = (NULLIF(auth.jwt() ->> 'business_id', ''))::uuid);

drop policy if exists hide_demo_applications on public.epc_applications;
create policy hide_demo_applications on public.epc_applications
  as restrictive for select to public
  using (is_demo = false OR epc_business_id = (NULLIF(auth.jwt() ->> 'business_id', ''))::uuid);

drop policy if exists hide_demo_insurance on public.insurance_applications;
create policy hide_demo_insurance on public.insurance_applications
  as restrictive for select to public
  using (is_demo = false OR epc_business_id = (NULLIF(auth.jwt() ->> 'business_id', ''))::uuid);
