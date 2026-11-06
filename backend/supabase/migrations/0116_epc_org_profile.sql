-- 0116 — EPC organization profile: what the partner adds to its own profile in
-- the portal (beside the details it gave CC at onboarding, which stay on
-- epc_business). First field: the company logo — shown on the partner portal
-- and, later, on its quotations.
--
-- Its own table (not epc_business columns), so the EPC can change its logo even
-- after the self-edit lock (0010) closes epc_business to it.
--   logo_path  GCS object (logos/<business_id>/<ms>.png); a new upload = a new path

create table if not exists public.epc_org_profile (
  business_id uuid primary key references public.epc_business(id) on delete cascade,
  logo_path   text,
  updated_at  timestamptz not null default now()
);

alter table public.epc_org_profile enable row level security;

drop policy if exists epc_org_profile_own on public.epc_org_profile;
create policy epc_org_profile_own on public.epc_org_profile
  for all to public
  using (business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid)
  with check (business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid);

drop policy if exists epc_org_profile_admin on public.epc_org_profile;
create policy epc_org_profile_admin on public.epc_org_profile
  for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');
