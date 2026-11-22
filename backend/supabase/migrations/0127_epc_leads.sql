-- 0127 — EPC leads + follow-ups, and the duplicate customer check (Partner Portal
-- v2, phase 1; 22/11/2026). Additive: one new table and one function; nothing
-- existing changes. CC's own leads (loan_leads, customer_leads) stay as they are.
--
-- epc_leads — an EPC's own prospects: who, where, how big, the next follow-up
-- date and the lead owner (a staff member; null = the owner). Same roles as loans
-- (0120): Owner / Admin all of the company, Sales only the leads they own, Viewer
-- reads. created_by_member is stamped by stamp_epc_member (0120); a lead Sales
-- adds is always theirs.
--
-- epc_customer_taken(mobile, pan) — has ANOTHER EPC ever filed a loan for this
-- customer (submitted, any time, demo files never count)? Security definer,
-- answers only yes / no (never the other EPC), like epc_pan_gst_taken (0124).
-- `demo` = whether the caller is the demo EPC (is_demo, 0081): the portal blocks
-- only there until phase 1 goes to every EPC.
--
-- rollback: drop function if exists epc_customer_taken(text, text);
--           drop table if exists epc_leads;

create table if not exists public.epc_leads (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.epc_business(id) on delete cascade,
  name              text not null,
  mobile            text,
  city              text,
  kw                numeric(10,2),
  project_cost      numeric(14,2),
  status            text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost')),
  follow_up_at      date,
  notes             text,
  owner_member_id   uuid references public.epc_members(id) on delete set null,
  created_by_member uuid references public.epc_members(id) on delete set null,
  application_id    uuid references public.epc_applications(id) on delete set null, -- the loan applied for from this lead
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists epc_leads_business_idx on public.epc_leads (business_id, created_at desc);

-- Who did it (0120's stamp) + a lead Sales adds is theirs (Owner / Admin pick its owner; none = the owner).
drop trigger if exists trg_stamp_epc_member on public.epc_leads;
create trigger trg_stamp_epc_member before insert on public.epc_leads for each row execute function stamp_epc_member();

create or replace function epc_leads_defaults() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.owner_member_id is null and epc_member_role() = 'SALES' then new.owner_member_id := epc_member_id(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_epc_leads_defaults on public.epc_leads;
create trigger trg_epc_leads_defaults before insert or update on public.epc_leads for each row execute function epc_leads_defaults();

alter table public.epc_leads enable row level security;

drop policy if exists epc_leads_read on public.epc_leads;
create policy epc_leads_read on public.epc_leads for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER')
              or ((select epc_member_role()) = 'SALES' and owner_member_id = (select epc_member_id()))));
drop policy if exists epc_leads_insert on public.epc_leads;
create policy epc_leads_insert on public.epc_leads for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and ((select epc_member_role()) in ('OWNER', 'ADMIN')
                   or ((select epc_member_role()) = 'SALES' and owner_member_id = (select epc_member_id()))));
drop policy if exists epc_leads_update on public.epc_leads;
create policy epc_leads_update on public.epc_leads for update to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) in ('OWNER', 'ADMIN')
              or ((select epc_member_role()) = 'SALES' and owner_member_id = (select epc_member_id()))))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and ((select epc_member_role()) in ('OWNER', 'ADMIN')
                   or ((select epc_member_role()) = 'SALES' and owner_member_id = (select epc_member_id()))));
drop policy if exists epc_leads_delete on public.epc_leads;
create policy epc_leads_delete on public.epc_leads for delete to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) in ('OWNER', 'ADMIN')
              or ((select epc_member_role()) = 'SALES' and owner_member_id = (select epc_member_id()))));
drop policy if exists epc_leads_admin_read on public.epc_leads;
create policy epc_leads_admin_read on public.epc_leads for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');

create or replace function epc_customer_taken(p_mobile text, p_pan text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select nullif(auth.jwt() ->> 'business_id', '')::uuid as id),
       q  as (select nullif(right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10), '') as mobile,
                     nullif(upper(btrim(coalesce(p_pan, ''))), '') as pan),
       other as (select a.borrower_mobile, upper(btrim(a.borrower_pan)) as pan
                   from epc_applications a, me
                  where a.epc_business_id is distinct from me.id and a.submitted_at is not null and not a.is_demo)
  select jsonb_build_object(
    'mobile', exists (select 1 from other, q where q.mobile is not null and other.borrower_mobile = q.mobile),
    'pan',    exists (select 1 from other, q where q.pan is not null and other.pan = q.pan),
    'demo',   coalesce((select b.is_demo from epc_business b, me where b.id = me.id), false)
  );
$$;

revoke all on function epc_customer_taken(text, text) from public;
grant execute on function epc_customer_taken(text, text) to authenticated;
