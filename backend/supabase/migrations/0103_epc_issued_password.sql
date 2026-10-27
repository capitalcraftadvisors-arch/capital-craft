-- 0103 — EPC login passwords: an easy-to-remember issued password
-- ("<name>@<last 4 mobile digits>$", made by the portal) that the EPC must
-- change at first login. Existing passwords are untouched (must_change stays
-- false), so current partners keep logging in as before. Still bcrypt only.
--
--   set_login_password   (0096) now also takes the EPC format (8+ chars with a
--                        letter, a digit and a symbol); an EPC's issued
--                        password is marked must_change
--   verify_login_password (0094) the right password on a must_change account
--                        answers 'change' (the `auth` function then gives no
--                        session, only a pass to set their own password)
--   set_own_password     service role only (the `auth` function): the EPC's
--                        own password; clears must_change
-- 5 wrong passwords still lock the account for 15 minutes.

alter table login_credentials add column if not exists must_change boolean not null default false;

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

revoke execute on function verify_login_password(uuid, text) from public, anon, authenticated;
revoke execute on function set_own_password(uuid, text) from public, anon, authenticated;
grant execute on function verify_login_password(uuid, text) to service_role;
grant execute on function set_own_password(uuid, text) to service_role;
