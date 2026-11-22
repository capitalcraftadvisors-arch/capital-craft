-- 0131 — Daily follow-up reminder by email (Partner Portal v2; 22/11/2026).
-- Additive: one new table and one function; nothing existing changes.
--
-- Every morning Cloud Scheduler calls POST /api/cron/followups with a secret key
-- (x-cron-key). The route asks epc_followup_digest() who to remind and sends one
-- email per person with the open leads (not Won / Lost, epc_leads 0127) whose
-- follow-up date is today (India) or earlier:
--   · each active staff member with an email — the leads they own (owner_member_id)
--     (Site staff never see leads (0128), so they are left out)
--   · the company owner (epc_business.contact_email) — the leads with no owner member
--
-- cron_keys — the keys allowed to run a scheduled job, hashes only (hex SHA-256),
-- readable by no one (RLS on, no policies). The key itself is never stored; the
-- 'followups' row is put in by hand at deploy (steps in the route's header).
--
-- rollback: drop function if exists epc_followup_digest(text);
--           drop table if exists cron_keys;

create table if not exists public.cron_keys (
  name       text primary key,                 -- the job: 'followups'
  key_hash   text not null,                    -- hex SHA-256 of the key
  created_at timestamptz not null default now()
);
alter table public.cron_keys enable row level security; -- no policies: definer functions only
revoke all on public.cron_keys from anon, authenticated;

-- One row per person to remind: recipient_name, email, company_name and
-- leads [{name, mobile, follow_up_at, overdue}], oldest follow-up first.
-- A wrong / missing key raises 'invalid_key'.
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
     where b.is_demo   -- Partner Portal v2 goes to the demo EPC first: drop this line to remind every EPC
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

-- Only the cron route calls it (anon, with the key); revoked from authenticated
-- too, which Supabase grants on every new function by default.
revoke all on function epc_followup_digest(text) from public, authenticated;
grant execute on function epc_followup_digest(text) to anon;
