-- 0133 — Partner Portal v2: a per-EPC switch (23/11/2026). Until now the new
-- portal (leads, projects, dashboard, payments, invoices, …) was the demo EPC's
-- only (is_demo). Now CC switches it on per EPC on the admin EPC profile
-- (Subscription card → "New partner portal"); the demo EPC keeps it.
-- First EPC: SARVATRA ENERGY (Deepak Yadav), with its filed loans made projects
-- (the user, 23/11).
--
--   epc_subscriptions.portal_v2   the switch (CC writes, the EPC reads — 0128)
--   epc_portal_v2(business)       demo or switched on
-- The two database places that asked "is this the demo EPC?" now ask this:
-- epc_customer_taken (the duplicate customer stop) and epc_followup_digest
-- (the daily follow-up email).
--
-- rollback: alter table epc_subscriptions drop column if exists portal_v2;
--           drop function if exists epc_portal_v2(uuid); (and put back 0127 / 0131's functions)

alter table public.epc_subscriptions add column if not exists portal_v2 boolean not null default false;

create or replace function epc_portal_v2(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select b.is_demo from epc_business b where b.id = p_business), false)
      or coalesce((select s.portal_v2 from epc_subscriptions s where s.business_id = p_business), false)
$$;
revoke all on function epc_portal_v2(uuid) from public;
grant execute on function epc_portal_v2(uuid) to authenticated;

-- 0127's duplicate customer check: `v2` (and `demo`, the name the portal used
-- before) = the caller has the new portal.
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
    'v2',     coalesce((select epc_portal_v2(me.id) from me), false),
    'demo',   coalesce((select epc_portal_v2(me.id) from me), false)
  );
$$;
revoke all on function epc_customer_taken(text, text) from public;
grant execute on function epc_customer_taken(text, text) to authenticated;

-- 0131's daily follow-up digest, for every EPC with the new portal.
create or replace function epc_followup_digest(p_key text)
returns table (recipient_name text, email text, company_name text, leads jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(p_key, '') = '' or not exists (
    select 1 from cron_keys k
     where k.name = 'followups'
       and k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'invalid_key' using errcode = '42501';
  end if;

  return query
  with due as (
    select l.business_id, l.owner_member_id, l.name, l.mobile, l.follow_up_at,
           (l.follow_up_at < v_today) as overdue
      from epc_leads l
      join epc_business b on b.id = l.business_id
     where epc_portal_v2(b.id)   -- EPCs with the new portal (0133)
       and l.status not in ('won', 'lost')
       and l.follow_up_at is not null
       and l.follow_up_at <= v_today
  ),
  who as (
    -- staff: the leads they own
    select d.business_id, m.name as person, btrim(m.email) as mail, d.name, d.mobile, d.follow_up_at, d.overdue
      from due d
      join epc_members m on m.id = d.owner_member_id and m.business_id = d.business_id
     where m.active and m.member_role <> 'SITE' and nullif(btrim(m.email), '') is not null
    union all
    -- the owner: the leads with no owner member
    select d.business_id, b.contact_name, btrim(b.contact_email), d.name, d.mobile, d.follow_up_at, d.overdue
      from due d
      join epc_business b on b.id = d.business_id
     where d.owner_member_id is null and nullif(btrim(b.contact_email), '') is not null
  )
  select min(w.person)::text,
         min(w.mail)::text,
         coalesce(nullif(btrim(min(o.display_name)), ''), nullif(btrim(min(b.trade_name)), ''),
                  nullif(btrim(min(b.legal_name)), ''), min(b.contact_name))::text,
         jsonb_agg(jsonb_build_object('name', w.name, 'mobile', w.mobile, 'follow_up_at', w.follow_up_at, 'overdue', w.overdue)
                   order by w.follow_up_at, w.name)
    from who w
    join epc_business b on b.id = w.business_id
    left join epc_org_profile o on o.business_id = w.business_id
   group by w.business_id, lower(w.mail);
end $$;
revoke all on function epc_followup_digest(text) from public, authenticated;
grant execute on function epc_followup_digest(text) to anon;

-- SARVATRA ENERGY gets the new portal, and its filed loans become projects.
-- A no-op where that EPC doesn't exist (test DB).
do $$
declare v_biz uuid := '8b74ea26-1fc5-443c-a8a2-b2d60d7f3d5d';
begin
  if exists (select 1 from public.epc_business where id = v_biz) then
    insert into public.epc_subscriptions (business_id, portal_v2, updated_at) values (v_biz, true, now())
      on conflict (business_id) do update set portal_v2 = true, updated_at = now();
    perform epc_projects_from_loans(v_biz);
  end if;
end $$;
