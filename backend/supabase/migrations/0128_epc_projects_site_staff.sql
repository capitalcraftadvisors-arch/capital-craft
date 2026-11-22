-- 0128 — Projects, Site staff, and the WhatsApp subscription (Partner Portal v2,
-- phase 1; 22/11/2026). Additive: two new tables, a new staff role and a few
-- functions; loans, insurance and quotations are untouched.
--
-- epc_projects — a confirmed job: the customer, size, payment mode (cash /
-- loan / part loan), the stage it is at (+ when it got there and every move, in
-- `history`) and its site photos (`photos`, paths in the private bucket); its
-- cost lives in epc_project_finance (no Site staff access). Stages:
--   quote_won → site_survey → loan_in_process (loan / part loan only) →
--   material_dispatched → installation_done (needs 2 photos) →
--   net_metering_applied → commissioned → closed
-- Made by hand or from a lead (lead_id); application_id = its loan, if any.
--
-- SITE — a staff role for the installation team: it sees ONLY the projects given
-- to it (site_member_id) and may change only their stage, photos and notes; no
-- loans, insurance, quotations or leads (the 0120 / 0127 rules don't list it).
--
-- epc_subscriptions — the paid features CC switches on per EPC (WhatsApp for now).
-- CC writes; the EPC reads its own row.
--
-- rollback: drop function if exists epc_project_add_photo(uuid, text);
--           drop function if exists epc_project_remove_photo(uuid, text);
--           drop table if exists epc_projects; drop table if exists epc_subscriptions;
--           (and put back 0119's member_role check / set_member_password)

-- ── Site staff role ─────────────────────────────────────────────────────────
alter table public.epc_members drop constraint if exists epc_members_member_role_check;
alter table public.epc_members add constraint epc_members_member_role_check
  check (member_role in ('ADMIN', 'SALES', 'VIEWER', 'SITE'));

-- 0119's set_member_password, with SITE among the logins an admin may reset.
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
     or not (r = 'OWNER' or (r = 'ADMIN' and m.member_role in ('SALES', 'VIEWER', 'SITE'))) then
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

-- ── Projects ────────────────────────────────────────────────────────────────
create table if not exists public.epc_projects (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.epc_business(id) on delete cascade,
  lead_id           uuid references public.epc_leads(id) on delete set null,
  application_id    uuid references public.epc_applications(id) on delete set null,
  customer_name     text not null,
  mobile            text,
  city              text,
  kw                numeric(10,2),
  payment_mode      text not null default 'cash' check (payment_mode in ('cash', 'loan', 'part_loan')),
  insurance_application_id uuid references public.insurance_applications(id) on delete set null, -- a cash job's policy (a loan's: on the loan, 0112)
  stage             text not null default 'quote_won' check (stage in ('quote_won', 'site_survey', 'loan_in_process',
                      'material_dispatched', 'installation_done', 'net_metering_applied', 'commissioned', 'closed')),
  stage_at          timestamptz not null default now(),
  history           jsonb not null default '[]'::jsonb,  -- [{stage, at, by}] every move, oldest first
  photos            jsonb not null default '[]'::jsonb,  -- [{path, at}] site photos
  site_member_id    uuid references public.epc_members(id) on delete set null,
  notes             text,
  created_by_member uuid references public.epc_members(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists epc_projects_business_idx on public.epc_projects (business_id, created_at desc);

drop trigger if exists trg_stamp_epc_member on public.epc_projects;
create trigger trg_stamp_epc_member before insert on public.epc_projects for each row execute function stamp_epc_member();

-- A stage move is stamped (stage_at + history); the loan stage is for loan cases
-- only; Installation done and later need 2 site photos; Site staff change only the
-- stage, photos and notes.
create or replace function epc_projects_rules() returns trigger
language plpgsql set search_path = public as $$
declare
  ord text[] := array['quote_won', 'site_survey', 'loan_in_process', 'material_dispatched',
                      'installation_done', 'net_metering_applied', 'commissioned', 'closed'];
begin
  if tg_op = 'UPDATE' and epc_member_role() = 'SITE'
     and (new.business_id, new.lead_id, new.application_id, new.customer_name, new.mobile, new.city, new.kw,
          new.payment_mode, new.insurance_application_id, new.site_member_id, new.created_by_member)
         is distinct from
         (old.business_id, old.lead_id, old.application_id, old.customer_name, old.mobile, old.city, old.kw,
          old.payment_mode, old.insurance_application_id, old.site_member_id, old.created_by_member) then
    raise exception 'site_staff_limit' using errcode = '42501';
  end if;
  if new.stage = 'loan_in_process' and new.payment_mode = 'cash' then
    raise exception 'loan_stage_cash';
  end if;
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if array_position(ord, new.stage) >= array_position(ord, 'installation_done')
       and jsonb_array_length(new.photos) < 2 then
      raise exception 'two_photos_needed';
    end if;
    new.stage_at := now();
    new.history := coalesce(case when tg_op = 'UPDATE' then old.history end, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('stage', new.stage, 'at', now(), 'by', epc_member_id()));
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_epc_projects_rules on public.epc_projects;
create trigger trg_epc_projects_rules before insert or update on public.epc_projects for each row execute function epc_projects_rules();

alter table public.epc_projects enable row level security;

drop policy if exists epc_projects_read on public.epc_projects;
create policy epc_projects_read on public.epc_projects for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER')
              or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))
              or ((select epc_member_role()) = 'SITE' and site_member_id = (select epc_member_id()))));
drop policy if exists epc_projects_insert on public.epc_projects;
create policy epc_projects_insert on public.epc_projects for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));
drop policy if exists epc_projects_update on public.epc_projects;
create policy epc_projects_update on public.epc_projects for update to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) in ('OWNER', 'ADMIN')
              or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))
              or ((select epc_member_role()) = 'SITE' and site_member_id = (select epc_member_id()))))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists epc_projects_delete on public.epc_projects;
create policy epc_projects_delete on public.epc_projects for delete to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'));
drop policy if exists epc_projects_admin_read on public.epc_projects;
create policy epc_projects_admin_read on public.epc_projects for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- The money of a project — kept apart so Site staff never read it (the rules
-- below don't list SITE): the project cost and when the next customer payment is due.
create table if not exists public.epc_project_finance (
  project_id     uuid primary key references public.epc_projects(id) on delete cascade,
  business_id    uuid not null references public.epc_business(id) on delete cascade,
  project_cost   numeric(14,2),
  payment_due_on date,
  updated_at     timestamptz not null default now()
);
alter table public.epc_project_finance enable row level security;
-- (the project subqueries read epc_projects under its own rules: Sales see only theirs)
drop policy if exists epc_project_finance_read on public.epc_project_finance;
create policy epc_project_finance_read on public.epc_project_finance for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER', 'SALES')
         and project_id in (select id from public.epc_projects));
drop policy if exists epc_project_finance_write on public.epc_project_finance;
create policy epc_project_finance_write on public.epc_project_finance for all to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
         and project_id in (select id from public.epc_projects))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and project_id in (select id from public.epc_projects));
drop policy if exists epc_project_finance_admin_read on public.epc_project_finance;
create policy epc_project_finance_admin_read on public.epc_project_finance for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- Site photos, appended / removed in one statement (no lost photo when two land
-- together). Invoker rights: the rules above decide who may.
create or replace function epc_project_add_photo(p_project uuid, p_path text) returns jsonb
language sql security invoker set search_path = public as $$
  update epc_projects set photos = photos || jsonb_build_array(jsonb_build_object('path', p_path, 'at', now()))
   where id = p_project returning photos;
$$;
create or replace function epc_project_remove_photo(p_project uuid, p_path text) returns jsonb
language sql security invoker set search_path = public as $$
  update epc_projects set photos = coalesce((select jsonb_agg(x) from jsonb_array_elements(photos) x where x ->> 'path' <> p_path), '[]'::jsonb)
   where id = p_project returning photos;
$$;
grant execute on function epc_project_add_photo(uuid, text) to authenticated;
grant execute on function epc_project_remove_photo(uuid, text) to authenticated;

-- ── Paid features ───────────────────────────────────────────────────────────
create table if not exists public.epc_subscriptions (
  business_id uuid primary key references public.epc_business(id) on delete cascade,
  whatsapp    boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.epc_subscriptions enable row level security;
drop policy if exists epc_subscriptions_read on public.epc_subscriptions;
create policy epc_subscriptions_read on public.epc_subscriptions for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) is not null);
drop policy if exists epc_subscriptions_admin on public.epc_subscriptions;
create policy epc_subscriptions_admin on public.epc_subscriptions for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');
