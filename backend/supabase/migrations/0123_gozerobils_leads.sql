-- 0123 — gozerobils leads: enquiries from the gozerobils.com solar form.
--
-- gozerobils.com sends each form enquiry to POST /api/gozerobils/leads with a
-- secret key. The row lands here and shows in the admin console's
-- "gozerobils Leads" window. Kept apart from customer_leads / loan_leads: these
-- are rooftop-solar enquiries, not loan or insurance leads.
--
-- The key itself is never stored: gozerobils_api_keys holds only its SHA-256
-- hash, and gozerobils_save_lead() checks it before writing. The same enquiry
-- sent again (same submission_id) updates its row; status and notes belong to
-- the team and are never changed by the API.
--
-- rollback: drop function if exists gozerobils_save_lead(text, jsonb);
--           drop table if exists gozerobils_leads;
--           drop table if exists gozerobils_api_keys;

create table if not exists gozerobils_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submission_id text not null unique,          -- the form's own id for one enquiry
  name          text,
  mobile        text not null,                 -- 10 digits
  pincode       text,
  city          text,
  state         text,
  monthly_bill  text,                          -- the form's bill range
  looking_for   text,
  timeline      text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  landing_page  text,
  status        text not null default 'new'
                check (status in ('new','contacted','converted','closed')),
  notes         text
);

create index if not exists gozerobils_leads_created_idx on gozerobils_leads (created_at desc);

alter table gozerobils_leads enable row level security;

-- Rows are written only by gozerobils_save_lead() below (no insert policy).
drop policy if exists gozerobils_leads_admin_read on gozerobils_leads;
create policy gozerobils_leads_admin_read on gozerobils_leads
  for select to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin');

drop policy if exists gozerobils_leads_admin_update on gozerobils_leads;
create policy gozerobils_leads_admin_update on gozerobils_leads
  for update to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin')
  with check (auth.jwt() ->> 'business_type' = 'admin');

-- The API keys allowed to write leads — hashes only, readable by no one.
create table if not exists gozerobils_api_keys (
  id         uuid primary key default gen_random_uuid(),
  key_hash   text not null unique,             -- hex SHA-256 of the key
  label      text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table gozerobils_api_keys enable row level security;
revoke all on gozerobils_api_keys from anon, authenticated;

-- Save (insert or update) one enquiry. Answers {ok, id, created} or {ok:false, error}.
create or replace function gozerobils_save_lead(p_key text, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub    text := left(btrim(coalesce(p_lead ->> 'submission_id', '')), 80);
  v_mobile text := right(regexp_replace(coalesce(p_lead ->> 'mobile', ''), '[^0-9]', '', 'g'), 10);
  v_id     uuid;
  v_new    boolean;
begin
  if coalesce(p_key, '') = '' or not exists (
    select 1 from gozerobils_api_keys
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
      and revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_key');
  end if;
  if v_sub = '' then
    return jsonb_build_object('ok', false, 'error', 'submission_id_required');
  end if;
  if v_mobile !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_mobile');
  end if;

  insert into gozerobils_leads (
    submission_id, name, mobile, pincode, city, state,
    monthly_bill, looking_for, timeline,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page
  ) values (
    v_sub,
    nullif(left(btrim(p_lead ->> 'name'), 120), ''),
    v_mobile,
    nullif(left(btrim(p_lead ->> 'pincode'), 10), ''),
    nullif(left(btrim(p_lead ->> 'city'), 80), ''),
    nullif(left(btrim(p_lead ->> 'state'), 80), ''),
    nullif(left(btrim(p_lead ->> 'monthly_bill'), 80), ''),
    nullif(left(btrim(p_lead ->> 'looking_for'), 80), ''),
    nullif(left(btrim(p_lead ->> 'timeline'), 80), ''),
    nullif(left(btrim(p_lead ->> 'utm_source'), 200), ''),
    nullif(left(btrim(p_lead ->> 'utm_medium'), 200), ''),
    nullif(left(btrim(p_lead ->> 'utm_campaign'), 200), ''),
    nullif(left(btrim(p_lead ->> 'utm_content'), 200), ''),
    nullif(left(btrim(p_lead ->> 'utm_term'), 200), ''),
    nullif(left(btrim(p_lead ->> 'landing_page'), 500), '')
  )
  on conflict (submission_id) do update set
    name         = excluded.name,
    mobile       = excluded.mobile,
    pincode      = excluded.pincode,
    city         = excluded.city,
    state        = excluded.state,
    monthly_bill = excluded.monthly_bill,
    looking_for  = excluded.looking_for,
    timeline     = excluded.timeline,
    utm_source   = coalesce(excluded.utm_source,   gozerobils_leads.utm_source),
    utm_medium   = coalesce(excluded.utm_medium,   gozerobils_leads.utm_medium),
    utm_campaign = coalesce(excluded.utm_campaign, gozerobils_leads.utm_campaign),
    utm_content  = coalesce(excluded.utm_content,  gozerobils_leads.utm_content),
    utm_term     = coalesce(excluded.utm_term,     gozerobils_leads.utm_term),
    landing_page = coalesce(excluded.landing_page, gozerobils_leads.landing_page),
    updated_at   = now()
  returning id, (xmax = 0) into v_id, v_new;

  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

revoke all on function gozerobils_save_lead(text, jsonb) from public;
grant execute on function gozerobils_save_lead(text, jsonb) to anon, authenticated;
