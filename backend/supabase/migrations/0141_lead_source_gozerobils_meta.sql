-- 0141 — Sustera Ventures' Leads: Meta / Cold call / Reference (25/11/2026). Additive.
--
-- Sustera Ventures is the company behind gozerobils.com. On its Partner Portal
-- Leads page (v2):
--   Meta       — the gozerobils.com enquiries (gozerobils_leads, 0123 / 0132), read
--                only: CC works them in its gozerobils page (status, follow-ups, calls).
--   Cold call / Reference — its own leads (epc_leads, 0127) by where they came from;
--                a reference names whose reference it is.
-- The company is recognised by its quotation template — the gozerobils builder
-- ('bundled:sarvatra', 0099) — as the portal does for its Customer applications.
--
-- rollback:
--   drop policy if exists gozerobils_leads_company_read on gozerobils_leads;
--   drop function if exists gozerobils_company();
--   alter table epc_leads drop column if exists source, drop column if exists referred_by;

alter table public.epc_leads
  add column if not exists source      text check (source in ('cold_call', 'reference')),
  add column if not exists referred_by text;

-- Is the caller's company the gozerobils one?
create or replace function gozerobils_company() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from epc_quotation_templates t
                  where t.epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
                    and t.storage_path = 'bundled:sarvatra')
$$;
revoke all on function gozerobils_company() from public;
grant execute on function gozerobils_company() to authenticated;

-- Its staff read the website's enquiries (not Site staff); nothing else changes (CC writes).
drop policy if exists gozerobils_leads_company_read on gozerobils_leads;
create policy gozerobils_leads_company_read on gozerobils_leads
  for select to authenticated
  using ((select gozerobils_company()) and (select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER', 'SALES'));
