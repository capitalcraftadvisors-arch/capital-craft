-- 0110 — CC keeps a readable copy of each EPC's login password: the one CC
-- issues and, after the first login, the one the EPC sets. Only the main admin
-- can read it back (epc_login_password); team passwords are never kept.
-- login_credentials stays locked (RLS on, no policies, no anon/authenticated).
--
--   set_login_password  (0103) + keeps the copy for an EPC (clears it for a team account)
--   set_own_password    (0103) + keeps the EPC's own password
--   epc_login_password  main admin: the EPC's current password (null if not kept)

alter table login_credentials add column if not exists password_copy text;

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
        password_copy = case when exists (select 1 from epc_business b where b.id = p_business_id and b.business_type is distinct from 'admin')
                             then p_password end
    where business_id = p_business_id;
  return 'ok';
end $$;

create or replace function epc_login_password(p_business_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if nullif(auth.jwt() ->> 'business_type', '') is distinct from 'admin'
     or coalesce(auth.jwt() ->> 'hierarchy_role', '') not in ('MAIN_ADMIN', '') then
    raise exception 'main_admin_only' using errcode = '42501';
  end if;
  return (select c.password_copy from login_credentials c join epc_business b on b.id = c.business_id
          where c.business_id = p_business_id and b.business_type is distinct from 'admin');
end $$;

revoke execute on function set_own_password(uuid, text) from public, anon, authenticated;
grant execute on function set_own_password(uuid, text) to service_role;
revoke execute on function epc_login_password(uuid) from public, anon;
grant execute on function epc_login_password(uuid) to authenticated;
