-- 0142 — Stakeholders → EPCs shows each Partner Portal login's password (user, 26/11).
--
-- Reverses 0136's "nobody can read a password" for EPC logins: a readable copy
-- of the password is kept for EPC owners (login_credentials) and their staff
-- (member_credentials), and only the Capital Craft main admin can read it back.
-- Capital Craft team logins never keep a copy.
--
-- A copy is kept when the password is issued / reset, when the EPC sets its
-- own, and on every right login — so a password stored before this (a hash
-- only) shows from that login's next right login.
--
--   login_credentials.password_copy, member_credentials.password_copy
--   verify_login_password / set_login_password / set_own_password   (0136) + the copy
--   verify_member_password / set_own_member_password (0119), set_member_password (0136) + the copy
--   login_password_status (0094) + member ids + the copy (main admin only)
--
-- rollback: re-run 0136 (drops login_credentials.password_copy) and
--   alter table member_credentials drop column password_copy; then 0094's login_password_status.

alter table login_credentials add column if not exists password_copy text;
alter table member_credentials add column if not exists password_copy text;

-- An EPC login (not a Capital Craft team account) keeps a readable copy.
create or replace function login_keeps_copy(p_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from epc_business b where b.id = p_business_id and b.business_type is distinct from 'admin');
$$;
revoke execute on function login_keeps_copy(uuid) from public, anon, authenticated;

create or replace function verify_login_password(p_business_id uuid, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c login_credentials%rowtype;
begin
  select * into c from login_credentials where business_id = p_business_id for update;
  if not found then return 'none'; end if;
  if c.locked_until is not null and c.locked_until > now() then return 'locked'; end if;
  if p_password is null or p_password = '' then return 'required'; end if;
  if crypt(p_password, c.password_hash) = c.password_hash then
    update login_credentials
      set failed_count = 0, locked_until = null,
          password_copy = case when login_keeps_copy(p_business_id) then p_password end
      where business_id = p_business_id;
    return case when c.must_change then 'change' else 'ok' end;
  end if;
  update login_credentials
    set failed_count = case when c.failed_count + 1 >= 5 then 0 else c.failed_count + 1 end,
        locked_until = case when c.failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
    where business_id = p_business_id;
  return 'bad';
end $$;
revoke execute on function verify_login_password(uuid, text) from public, anon, authenticated;
grant execute on function verify_login_password(uuid, text) to service_role;

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
  -- 8+ chars with a letter, a digit and a symbol (the EPC format; team passwords are longer).
  if p_password is null or length(p_password) < 8
     or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' then
    raise exception 'password_not_strong';
  end if;
  insert into login_credentials (business_id, password_hash, failed_count, locked_until, updated_at, updated_by, must_change, password_copy)
  values (p_business_id, crypt(p_password, gen_salt('bf', 10)), 0, null, v_at, caller_id, target_type is distinct from 'admin',
          case when target_type is distinct from 'admin' then p_password end)
  on conflict (business_id) do update
    set password_hash = excluded.password_hash, failed_count = 0, locked_until = null,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by, must_change = excluded.must_change,
        password_copy = excluded.password_copy;
  return v_at;
end $$;

-- 'ok' | 'none' (no issued password) | 'weak' (under 8 chars / no letter / no digit) | 'same' (= the issued one)
create or replace function set_own_password(p_business_id uuid, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c login_credentials%rowtype;
begin
  select * into c from login_credentials where business_id = p_business_id for update;
  if not found then return 'none'; end if;
  if p_password is null or length(p_password) < 8 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or p_password ~ '\s' then
    return 'weak';
  end if;
  if crypt(p_password, c.password_hash) = c.password_hash then return 'same'; end if;
  update login_credentials
    set password_hash = crypt(p_password, gen_salt('bf', 10)), must_change = false, failed_count = 0, locked_until = null,
        password_copy = case when login_keeps_copy(p_business_id) then p_password end
    where business_id = p_business_id;
  return 'ok';
end $$;
revoke execute on function set_own_password(uuid, text) from public, anon, authenticated;
grant execute on function set_own_password(uuid, text) to service_role;

-- An EPC's owner / admin, or the Capital Craft main admin, sets a staff password.
create or replace function set_member_password(p_member_id uuid, p_password text)
returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text := epc_member_role();
  m epc_members%rowtype;
  v_at timestamptz := now();
  cc_main boolean := r = 'CC' and coalesce(auth.jwt() ->> 'hierarchy_role', '') in ('MAIN_ADMIN', '');
begin
  select * into m from epc_members where id = p_member_id;
  if not found then raise exception 'member_not_found'; end if;
  if not cc_main and (m.business_id is distinct from nullif(auth.jwt() ->> 'business_id', '')::uuid
     or not (r = 'OWNER' or (r = 'ADMIN' and m.member_role in ('SALES', 'VIEWER', 'SITE')))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_password is null or length(p_password) < 8 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or p_password ~ '\s' then
    raise exception 'password_not_strong';
  end if;
  insert into member_credentials (member_id, password_hash, failed_count, locked_until, must_change, updated_at, password_copy)
  values (p_member_id, crypt(p_password, gen_salt('bf', 10)), 0, null, true, v_at, p_password)
  on conflict (member_id) do update
    set password_hash = excluded.password_hash, failed_count = 0, locked_until = null, must_change = true, updated_at = v_at,
        password_copy = excluded.password_copy;
  return v_at;
end $$;

-- 'required' (no password yet / none sent) | 'bad' | 'locked' | 'change' (right, must change) | 'ok'
create or replace function verify_member_password(p_member_id uuid, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c member_credentials%rowtype;
begin
  select * into c from member_credentials where member_id = p_member_id for update;
  if not found then return 'required'; end if;
  if c.locked_until is not null and c.locked_until > now() then return 'locked'; end if;
  if p_password is null or p_password = '' then return 'required'; end if;
  if crypt(p_password, c.password_hash) = c.password_hash then
    update member_credentials set failed_count = 0, locked_until = null, password_copy = p_password where member_id = p_member_id;
    return case when c.must_change then 'change' else 'ok' end;
  end if;
  update member_credentials
    set failed_count = case when c.failed_count + 1 >= 5 then 0 else c.failed_count + 1 end,
        locked_until = case when c.failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
    where member_id = p_member_id;
  return 'bad';
end $$;

-- 'ok' | 'none' | 'weak' | 'same' — the member's own password in place of the one it was given.
create or replace function set_own_member_password(p_member_id uuid, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c member_credentials%rowtype;
begin
  select * into c from member_credentials where member_id = p_member_id for update;
  if not found then return 'none'; end if;
  if p_password is null or length(p_password) < 8 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or p_password ~ '\s' then
    return 'weak';
  end if;
  if crypt(p_password, c.password_hash) = c.password_hash then return 'same'; end if;
  update member_credentials
    set password_hash = crypt(p_password, gen_salt('bf', 10)), must_change = false, failed_count = 0, locked_until = null, updated_at = now(),
        password_copy = p_password
    where member_id = p_member_id;
  return 'ok';
end $$;

revoke execute on function verify_member_password(uuid, text) from public, anon, authenticated;
revoke execute on function set_own_member_password(uuid, text) from public, anon, authenticated;
grant execute on function verify_member_password(uuid, text) to service_role;
grant execute on function set_own_member_password(uuid, text) to service_role;
revoke execute on function set_member_password(uuid, text) from public, anon;
grant execute on function set_member_password(uuid, text) to authenticated;

-- Admins: when each login's password was set — accounts by business id, EPC staff by member id.
-- The readable copy comes back for the Capital Craft main admin only (null for everyone else).
drop function if exists login_password_status(uuid[]);
create function login_password_status(p_business_ids uuid[])
returns table (business_id uuid, updated_at timestamptz, password text)
language plpgsql security definer set search_path = public as $$
declare
  main boolean := coalesce(auth.jwt() ->> 'hierarchy_role', '') in ('MAIN_ADMIN', '');
begin
  if nullif(auth.jwt() ->> 'business_type', '') is distinct from 'admin' then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return query
    select c.business_id, c.updated_at, case when main then c.password_copy end
      from login_credentials c where c.business_id = any(p_business_ids)
    union all
    select m.member_id, m.updated_at, case when main then m.password_copy end
      from member_credentials m where m.member_id = any(p_business_ids);
end $$;
revoke execute on function login_password_status(uuid[]) from public, anon;
grant execute on function login_password_status(uuid[]) to authenticated;
