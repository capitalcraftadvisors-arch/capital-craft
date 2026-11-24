-- 0135 — login security (audit 24/11):
--
-- 1. Only the Capital Craft team can make an account a team (admin) account.
--    A partner may edit its own epc_business row (own_business_write), and
--    nothing stopped it from setting business_type = 'admin' — its next login
--    token would then be an admin token. Now only a caller whose own token is
--    an admin, or the server itself (service role / direct database), can set
--    business_type to 'admin' or change it away from 'admin'.
--
-- 2. Every login token must carry an expiry. Tokens made before the auth
--    function set one (they never expire) are refused by the API from now on,
--    so everyone logs in again once. Done with PostgREST's pre-request check,
--    which runs before every API request.
--
-- rollback: alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
--           drop function if exists check_request();
--           drop trigger if exists trg_guard_admin_type on epc_business;
--           drop function if exists guard_admin_type();

-- ── 1. business_type 'admin' is set by the team or the server only ──
create or replace function guard_admin_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text := auth.jwt() ->> 'role';
begin
  -- The server (service role) and direct database work have no API caller to check.
  if v_role is null or v_role = 'service_role' then return new; end if;
  if coalesce(auth.jwt() ->> 'business_type', '') = 'admin' then return new; end if;
  if (tg_op = 'INSERT' and new.business_type = 'admin')
     or (tg_op = 'UPDATE' and new.business_type is distinct from old.business_type
         and (new.business_type = 'admin' or old.business_type = 'admin')) then
    raise exception 'only the Capital Craft team can change a team account'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_admin_type on epc_business;
create trigger trg_guard_admin_type
  before insert or update of business_type on epc_business
  for each row execute function guard_admin_type();

-- ── 2. A login token without an expiry is refused ──
-- Runs before every API request. The anon key and the Claude connector's
-- tokens carry an expiry already; only old never-expiring logins stop here.
create or replace function check_request()
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if v_claims ->> 'role' = 'authenticated' and v_claims ->> 'exp' is null then
    raise sqlstate 'PT401' using message = 'Your login has expired. Log in again.';
  end if;
end $$;

-- Every API role runs it (anon, authenticated, the connector's mcp_reader, …).
grant execute on function check_request() to public;

alter role authenticator set pgrst.db_pre_request = 'public.check_request';
notify pgrst, 'reload config';
