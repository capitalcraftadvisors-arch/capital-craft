-- 0136 — EPC logins: no readable password copies, and Capital Craft can reset a
-- staff login (Stakeholders → EPCs, 24/11).
--
-- The user's choice (24/11): nobody can read a password, the Capital Craft team
-- included. When an EPC asks for its password, the main admin resets it and
-- the new one goes to the EPC by email or WhatsApp.
--
--   verify_login_password  (0115) without the readable copy
--   set_login_password     (0110) without the readable copy
--   set_own_password       (0110) without the readable copy
--   epc_login_password     dropped (it read the copy back)
--   login_credentials.password_copy   dropped (8 copies on 24/11)
--   set_member_password    (0128) + the Capital Craft main admin may set any EPC staff password
--
-- rollback: re-run 0110 + 0115 + 0128 (the copies themselves are gone for good).

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
    update login_credentials set failed_count = 0, locked_until = null where business_id = p_business_id;
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
  insert into login_credentials (business_id, password_hash, failed_count, locked_until, updated_at, updated_by, must_change)
  values (p_business_id, crypt(p_password, gen_salt('bf', 10)), 0, null, v_at, caller_id, target_type is distinct from 'admin')
  on conflict (business_id) do update
    set password_hash = excluded.password_hash, failed_count = 0, locked_until = null,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by, must_change = excluded.must_change;
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
    set password_hash = crypt(p_password, gen_salt('bf', 10)), must_change = false, failed_count = 0, locked_until = null
    where business_id = p_business_id;
  return 'ok';
end $$;
revoke execute on function set_own_password(uuid, text) from public, anon, authenticated;
grant execute on function set_own_password(uuid, text) to service_role;

drop function if exists epc_login_password(uuid);
alter table login_credentials drop column if exists password_copy;

-- An EPC's owner / admin (as before), or the Capital Craft main admin, sets a staff password.
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
  insert into member_credentials (member_id, password_hash, failed_count, locked_until, must_change, updated_at)
  values (p_member_id, crypt(p_password, gen_salt('bf', 10)), 0, null, true, v_at)
  on conflict (member_id) do update
    set password_hash = excluded.password_hash, failed_count = 0, locked_until = null, must_change = true, updated_at = v_at;
  return v_at;
end $$;
