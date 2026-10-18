-- 0096 — "Pri portal": a private owner console.
--
-- owner_accounts lists the owner login(s). It has RLS on and NO policies, so no
-- browser (not even the main admin) can read or change it. Only an owner sees
-- the Pri portal, creates / uses Claude connector links (the `auth` edge
-- function checks this table), and only the owner can set the owner's own
-- login password. Every admin-side list of team members reads
-- team_accounts(), which leaves owner accounts out.

create table if not exists owner_accounts (
  business_id uuid primary key references epc_business(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table owner_accounts enable row level security;
revoke all on owner_accounts from anon, authenticated;

-- set_login_password (0094) + owner protection: an owner's password can be set
-- only by that owner.
create or replace function set_login_password(p_business_id uuid, p_password text)
returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  caller_type text := nullif(auth.jwt() ->> 'business_type', '');
  caller_role text := coalesce(auth.jwt() ->> 'hierarchy_role', '');
  caller_id   uuid := nullif(auth.jwt() ->> 'business_id', '')::uuid;
  target_type text;
  v_at timestamptz := now();
begin
  if caller_type is distinct from 'admin' then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if caller_role not in ('MAIN_ADMIN', '') then
    raise exception 'main_admin_only' using errcode = '42501';
  end if;
  if exists (select 1 from owner_accounts where business_id = p_business_id) and caller_id is distinct from p_business_id then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select business_type into target_type from epc_business where id = p_business_id;
  if not found then raise exception 'account_not_found'; end if;
  -- Strong only (the portal generates them): 12+ chars with upper, lower, digit, symbol.
  if p_password is null or length(p_password) < 12
     or p_password !~ '[A-Z]' or p_password !~ '[a-z]' or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' then
    raise exception 'password_not_strong';
  end if;
  insert into login_credentials (business_id, password_hash, failed_count, locked_until, updated_at, updated_by)
  values (p_business_id, crypt(p_password, gen_salt('bf', 10)), 0, null, v_at, caller_id)
  on conflict (business_id) do update
    set password_hash = excluded.password_hash, failed_count = 0, locked_until = null,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return v_at;
end $$;

-- The CC team — owner accounts left out. Every admin-side list of team members
-- (Team page, Task Manager, Assigned to, Analytics, "Created by" names) reads
-- this, so the boss and the team never see an owner account.
drop function if exists team_accounts();
create function team_accounts()
returns table (id uuid, contact_name text, contact_mobile text, contact_email text, role text, parent_user_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if nullif(auth.jwt() ->> 'business_type', '') is distinct from 'admin' then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return query
    select b.id, b.contact_name, b.contact_mobile, b.contact_email, b.role, b.parent_user_id
    from epc_business b
    where b.business_type = 'admin'
      and not exists (select 1 from owner_accounts o where o.business_id = b.id)
    order by b.contact_name;
end $$;
revoke execute on function team_accounts() from public, anon;
grant execute on function team_accounts() to authenticated;
