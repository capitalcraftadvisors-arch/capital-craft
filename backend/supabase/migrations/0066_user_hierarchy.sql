-- =========================================================
-- 0066 — User hierarchy foundation.
--
-- Adds a scalable role/permission hierarchy ON TOP of the existing accounts
-- model without forking it. Admins already live in epc_business
-- (business_type='admin'); this gives those admin rows a role, a reporting
-- manager, and a configurable set of allowed modules — so "Main Admin" and
-- operational users (Manish, Malvika, and any future staff) are all ordinary
-- admin-type rows distinguished by role + allowed_modules, NOT hardcoded.
--
-- It also introduces real user-reference attribution (created_by_user_id /
-- assigned_to_user_id / last_updated_by_user_id) across the five operational
-- modules, and a cross-module user_activity_log — the foundation the future
-- morning-work dashboard will build on. No existing business logic changes.
--
-- Rollback sketch (dev only):
--   drop table if exists user_activity_log;
--   drop trigger if exists trg_guard_hierarchy_columns on epc_business;
--   drop function if exists guard_hierarchy_columns();
--   alter table epc_business drop column if exists role,
--     drop column if exists parent_user_id, drop column if exists allowed_modules;
--   -- (attribution columns can be left; they are additive + nullable)
-- =========================================================

-- ── 1. Hierarchy columns on the shared accounts table ────────────────────
-- role: only meaningful for business_type='admin' rows.
--   MAIN_ADMIN      → the central administrator (all six modules incl Analytics)
--   OPERATIONS_USER → staff working the five operational modules (no Analytics)
-- allowed_modules: the AUTHORITATIVE per-user module permission set. Seeded per
--   role but per-user editable by a MAIN_ADMIN, so future users/roles are just
--   data. Module keys match the admin console tab keys:
--     'epcs' | 'apps' | 'loanleads' | 'insurance' | 'leads' | 'analytics'
-- parent_user_id: reporting manager → supports arbitrarily deep org trees.
alter table epc_business add column if not exists role            text;
alter table epc_business add column if not exists parent_user_id  uuid references epc_business(id) on delete set null;
alter table epc_business add column if not exists allowed_modules text[];
alter table epc_business add column if not exists last_login_at   timestamptz;   -- stamped by the auth function on each login

comment on column epc_business.role is 'Admin-row role: MAIN_ADMIN | OPERATIONS_USER (null for non-admin/EPC rows)';
comment on column epc_business.allowed_modules is 'Authoritative module permission set for admin-type users (tab keys)';
comment on column epc_business.parent_user_id is 'Reporting manager (scalable org hierarchy)';

-- ── 2. Promote existing admin rows to MAIN_ADMIN with full access ─────────
update epc_business
set role = 'MAIN_ADMIN',
    allowed_modules = array['epcs','apps','loanleads','insurance','leads','analytics']
where business_type = 'admin'
  and role is null;

-- ── 3. Seed the two operational users (idempotent by unique contact_mobile).
-- Login identifiers are NOT hardcoded in any frontend/app code — they live
-- only here as account rows, and login works through the existing mobile flow.
-- parent = the oldest MAIN_ADMIN (no specific person hardcoded).
insert into epc_business (contact_name, contact_mobile, contact_designation, business_type, status, role, allowed_modules, parent_user_id)
values
  ('Manish',  '8769145691', 'Operations', 'admin', 'approved', 'OPERATIONS_USER',
     array['epcs','apps','loanleads','insurance','leads'],
     (select id from epc_business where business_type='admin' and role='MAIN_ADMIN' order by created_at asc limit 1)),
  ('Malvika', '7300085864', 'Operations', 'admin', 'approved', 'OPERATIONS_USER',
     array['epcs','apps','loanleads','insurance','leads'],
     (select id from epc_business where business_type='admin' and role='MAIN_ADMIN' order by created_at asc limit 1))
on conflict (contact_mobile) do update
set contact_name       = excluded.contact_name,
    contact_designation = excluded.contact_designation,
    business_type      = 'admin',
    status             = 'approved',
    role               = excluded.role,
    allowed_modules    = excluded.allowed_modules,
    parent_user_id     = excluded.parent_user_id;

-- ── 4. Guard trigger: nobody can escalate their OWN hierarchy columns ──────
-- The existing own_business RLS policy (0002) is "for all", so a user can
-- update their own epc_business row. This trigger blocks changes to the
-- sensitive hierarchy columns unless the actor is a MAIN_ADMIN (or a backend/
-- service call with no request JWT, e.g. migrations). Ordinary column edits
-- are unaffected (the guard only fires when a guarded column actually changes).
create or replace function guard_hierarchy_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role            is distinct from old.role
     or new.allowed_modules is distinct from old.allowed_modules
     or new.parent_user_id  is distinct from old.parent_user_id then
    -- Backend / migrations (no request JWT) may always manage hierarchy.
    if auth.jwt() is null then
      return new;
    end if;
    -- Otherwise only a MAIN_ADMIN may.
    if coalesce(auth.jwt() ->> 'business_type', '') = 'admin'
       and (select b.role from epc_business b
            where b.id = nullif(auth.jwt() ->> 'business_id', '')::uuid) = 'MAIN_ADMIN' then
      return new;
    end if;
    raise exception 'hierarchy columns (role/allowed_modules/parent_user_id) are managed by a Main Admin only';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_hierarchy_columns on epc_business;
create trigger trg_guard_hierarchy_columns
  before update on epc_business
  for each row execute function guard_hierarchy_columns();

-- ── 5. Real user-reference attribution across the operational modules ─────
-- All nullable + additive. Legacy rows stay NULL (shown as "—"/System — never
-- guessed). created_by is NEVER overwritten on reassignment; assigned_to and
-- last_updated_by are the mutable ownership fields.
do $$
declare t text;
begin
  foreach t in array array['epc_business','epc_applications','loan_leads','customer_leads','insurance_applications'] loop
    execute format('alter table %I add column if not exists created_by_user_id      uuid references epc_business(id) on delete set null', t);
    execute format('alter table %I add column if not exists assigned_to_user_id     uuid references epc_business(id) on delete set null', t);
    execute format('alter table %I add column if not exists last_updated_by_user_id uuid references epc_business(id) on delete set null', t);
    execute format('create index if not exists idx_%1$s_created_by  on %1$I (created_by_user_id)',  t);
    execute format('create index if not exists idx_%1$s_assigned_to on %1$I (assigned_to_user_id)', t);
  end loop;
end $$;

-- ── 6. Cross-module activity log (foundation for team visibility) ─────────
-- Separate from admin_edit_log (EPC-keyed) and loan_activity_log (loan-keyed):
-- this one is keyed by USER + module + record, capturing hierarchy/workflow
-- events (created / assigned / reassigned / status_change / …) uniformly so
-- the Team view and future morning dashboard can read one place.
create table if not exists user_activity_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references epc_business(id) on delete set null,  -- who performed the action
  subject_user_id uuid references epc_business(id) on delete set null,  -- whose work (e.g. new assignee)
  module          text not null,   -- 'epcs' | 'apps' | 'loanleads' | 'leads' | 'insurance'
  record_id       uuid,            -- affected record (nullable)
  action          text not null,   -- 'created' | 'assigned' | 'reassigned' | 'status_change' | 'updated' | ...
  previous_value  text,
  new_value       text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_user_activity_actor   on user_activity_log (actor_user_id, created_at desc);
create index if not exists idx_user_activity_subject on user_activity_log (subject_user_id, created_at desc);
create index if not exists idx_user_activity_record  on user_activity_log (module, record_id);

alter table user_activity_log enable row level security;

-- Admin-only (invisible to EPCs). Any admin-type user may read team activity;
-- writes happen through the app under an admin JWT.
create policy "admin_select_user_activity" on user_activity_log for select
  using ((auth.jwt() ->> 'business_type') = 'admin');
create policy "admin_insert_user_activity" on user_activity_log for insert
  with check ((auth.jwt() ->> 'business_type') = 'admin');
-- No UPDATE/DELETE policy → activity is append-only (permanent).
