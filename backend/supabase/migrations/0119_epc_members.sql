-- 0119 — EPC staff logins ("Users & roles" in the partner portal). An EPC is a
-- company: its owner (the KYC contact, who keeps logging in as before) can give
-- its workforce their own logins, each with a role and the modules it may use.
--
--   epc_members         one row per staff login (mobile + role + modules + active)
--                         ADMIN  — everything, incl. Settings and Users (but not other admins)
--                         SALES  — creates and works on its OWN loans / insurance / quotations only
--                         VIEWER — reads everything, changes nothing
--                       The owner has no row: a token with no member_id claim is the owner.
--   member_credentials  their passwords — a bcrypt hash only (no readable copy: the
--                       EPC's own team handles them, CC never sees them); RLS on, no policies.
--   epc_member_role()   the caller's role read LIVE ('OWNER' | 'ADMIN' | 'SALES' | 'VIEWER',
--                       'CC' for a Capital Craft admin, null for a switched-off member), so a
--                       role change or deactivation applies at once; used by the 0120 policies.
--   set_member_password (owner / admin) · verify_member_password · set_own_member_password (auth fn)
--
-- A staff mobile can't also be an EPC's login mobile (and the reverse): the
-- auth function finds a login by mobile in one place or the other.

create table if not exists public.epc_members (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.epc_business(id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  mobile            text not null unique check (mobile ~ '^[6-9][0-9]{9}$'),
  email             text,
  member_role       text not null check (member_role in ('ADMIN', 'SALES', 'VIEWER')),
  modules           text[] not null default array['loans', 'insurance', 'quotes'],
  active            boolean not null default true,
  last_login_at     timestamptz,
  created_by_member uuid references public.epc_members(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists epc_members_business on public.epc_members (business_id);

create table if not exists public.member_credentials (
  member_id     uuid primary key references public.epc_members(id) on delete cascade,
  password_hash text not null,
  failed_count  integer not null default 0,
  locked_until  timestamptz,
  must_change   boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.member_credentials enable row level security; -- no policies: definer functions only

alter table public.epc_login_events add column if not exists member_id uuid references public.epc_members(id) on delete set null;

-- ── Who is calling ──────────────────────────────────────────────────────────
create or replace function epc_member_id() returns uuid
language sql stable set search_path = public as $$
  select nullif(auth.jwt() ->> 'member_id', '')::uuid
$$;

create or replace function epc_member_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when nullif(auth.jwt() ->> 'business_type', '') = 'admin' then 'CC'
    when nullif(auth.jwt() ->> 'member_id', '') is null then 'OWNER'
    else (select m.member_role from epc_members m
           where m.id = nullif(auth.jwt() ->> 'member_id', '')::uuid
             and m.business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
             and m.active)
  end
$$;

-- The caller may use a module ('loans' | 'insurance' | 'quotes'): the owner and CC always.
create or replace function epc_has_module(p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when nullif(auth.jwt() ->> 'business_type', '') = 'admin' then true
    when nullif(auth.jwt() ->> 'member_id', '') is null then true
    else exists (select 1 from epc_members m
                  where m.id = nullif(auth.jwt() ->> 'member_id', '')::uuid
                    and m.business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
                    and m.active and p_module = any (m.modules))
  end
$$;

-- ── Guards ──────────────────────────────────────────────────────────────────
-- A staff mobile is never an EPC login mobile (either way round).
create or replace function epc_members_mobile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from epc_business b where b.contact_mobile = new.mobile) then
    raise exception 'mobile_in_use' using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_epc_members_mobile on public.epc_members;
create trigger trg_epc_members_mobile before insert or update of mobile on public.epc_members
  for each row execute function epc_members_mobile_guard();

create or replace function epc_business_mobile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.contact_mobile is not null and exists (select 1 from epc_members m where m.mobile = new.contact_mobile) then
    raise exception 'mobile_in_use' using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_epc_business_member_mobile on public.epc_business;
create trigger trg_epc_business_member_mobile before insert or update of contact_mobile on public.epc_business
  for each row execute function epc_business_mobile_guard();

-- Nobody changes their own role, modules or switches themselves off; an ADMIN
-- manages only SALES / VIEWER members (it can't make or change another ADMIN).
create or replace function epc_members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r text := epc_member_role();
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by_member := epc_member_id();
  end if;
  if r = 'CC' or r = 'OWNER' then return new; end if;
  if tg_op = 'UPDATE' and old.id = epc_member_id()
     and (new.member_role is distinct from old.member_role or new.modules is distinct from old.modules or new.active is distinct from old.active) then
    raise exception 'cannot_change_own_access' using errcode = '42501';
  end if;
  if r = 'ADMIN' and (
       (tg_op = 'INSERT' and new.member_role = 'ADMIN')
    or (tg_op = 'UPDATE' and old.id <> epc_member_id() and (old.member_role = 'ADMIN' or new.member_role = 'ADMIN'))) then
    raise exception 'admin_only_by_owner' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_epc_members_guard on public.epc_members;
create trigger trg_epc_members_guard before insert or update on public.epc_members
  for each row execute function epc_members_guard();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.epc_members enable row level security;

drop policy if exists epc_members_read on public.epc_members;
create policy epc_members_read on public.epc_members for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) is not null);

drop policy if exists epc_members_insert on public.epc_members;
create policy epc_members_insert on public.epc_members for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'));

drop policy if exists epc_members_update on public.epc_members;
create policy epc_members_update on public.epc_members for update to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);

drop policy if exists epc_members_delete on public.epc_members;
create policy epc_members_delete on public.epc_members for delete to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) = 'OWNER' or ((select epc_member_role()) = 'ADMIN' and member_role <> 'ADMIN')));

drop policy if exists epc_members_admin on public.epc_members;
create policy epc_members_admin on public.epc_members for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');

-- ── Passwords ───────────────────────────────────────────────────────────────
-- The owner (or an admin, for SALES / VIEWER) sets a member's password; the
-- member must change it at first login. 8+ characters with a letter and a digit.
create or replace function set_member_password(p_member_id uuid, p_password text)
returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text := epc_member_role();
  m epc_members%rowtype;
  v_at timestamptz := now();
begin
  select * into m from epc_members where id = p_member_id;
  if not found then raise exception 'member_not_found'; end if;
  if m.business_id is distinct from nullif(auth.jwt() ->> 'business_id', '')::uuid
     or not (r = 'OWNER' or (r = 'ADMIN' and m.member_role in ('SALES', 'VIEWER'))) then
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
    update member_credentials set failed_count = 0, locked_until = null where member_id = p_member_id;
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
    set password_hash = crypt(p_password, gen_salt('bf', 10)), must_change = false, failed_count = 0, locked_until = null, updated_at = now()
    where member_id = p_member_id;
  return 'ok';
end $$;

revoke execute on function verify_member_password(uuid, text) from public, anon, authenticated;
revoke execute on function set_own_member_password(uuid, text) from public, anon, authenticated;
grant execute on function verify_member_password(uuid, text) to service_role;
grant execute on function set_own_member_password(uuid, text) to service_role;
revoke execute on function set_member_password(uuid, text) from public, anon;
grant execute on function set_member_password(uuid, text) to authenticated;
