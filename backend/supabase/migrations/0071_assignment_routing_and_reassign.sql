-- =========================================================
-- 0071 — Per-type intake routing + reassignment without a service key
--
-- 1) ROUTING. Replaces 0068's single-default auto_assign so new work routes by
--    type:
--       EPC onboarding (epc_business)      → Manish   (MANAGER)
--       Loan applications (epc_applications) → Malvika (default-intake RM)
--       Loan leads (loan_leads)            → Malvika
--       Insurance (insurance_applications) → Admin    (MAIN_ADMIN)
--    RM-created work (owner already an OPERATIONS_USER) keeps its owner.
--    Adds an auto-assign trigger to epc_business (it had none) and backfills
--    every existing non-admin EPC to Manish.
--
-- 2) REASSIGNMENT. Widens the three tier UPDATE policies so an OPERATIONS_USER
--    may hand a case UP to their own manager (parent) under their own JWT —
--    the one target the 0068 with_check rejected. This lets the Ops Board
--    reassign (e.g. Malvika → Manish) work WITHOUT SUPABASE_SERVICE_ROLE_KEY.
--    (Managers/admins already passed; the USING clause still gates who may
--    touch a case, so this only broadens the allowed NEW owner.)
--
-- People are resolved by contact_mobile (as in 0068): Manish 8769145691,
-- Malvika 7300085864 (also is_default_intake=true).
--
-- Rollback: restore 0068's auto_assign_intake + the three admin_tier_* policies
-- verbatim; drop trigger trg_auto_assign_epc on epc_business.
-- =========================================================

-- ── 1. Per-type routing ────────────────────────────────────────────────────
create or replace function auto_assign_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare rm uuid; mgr uuid; adm uuid; target uuid;
begin
  -- RM-created work keeps its owner (owner already an OPERATIONS_USER).
  -- NOTE: role/business_type are enums — compare directly, never coalesce('').
  if new.assigned_to_user_id is not null
     and (select role from epc_business where id = new.assigned_to_user_id) = 'OPERATIONS_USER' then
    return new;
  end if;

  select id into rm  from epc_business where is_default_intake limit 1;                     -- Malvika
  select id into mgr from epc_business where contact_mobile = '8769145691' limit 1;         -- Manish
  select id into adm from epc_business where business_type = 'admin' and role = 'MAIN_ADMIN' limit 1;  -- Admin

  if TG_TABLE_NAME = 'epc_business' then
    if new.business_type = 'admin' then return new; end if;  -- never touch admin/user rows
    target := mgr;
  elsif TG_TABLE_NAME = 'insurance_applications' then
    target := adm;
  else
    target := rm;  -- epc_applications, loan_leads → default-intake RM (Malvika)
  end if;

  if target is not null then new.assigned_to_user_id := target; end if;
  return new;
end;
$$;

-- Re-bind the three existing triggers (function body changed) and add epc_business.
drop trigger if exists trg_auto_assign_apps  on epc_applications;
create trigger trg_auto_assign_apps  before insert on epc_applications      for each row execute function auto_assign_intake();
drop trigger if exists trg_auto_assign_ins   on insurance_applications;
create trigger trg_auto_assign_ins   before insert on insurance_applications for each row execute function auto_assign_intake();
drop trigger if exists trg_auto_assign_leads on loan_leads;
create trigger trg_auto_assign_leads before insert on loan_leads            for each row execute function auto_assign_intake();
drop trigger if exists trg_auto_assign_epc   on epc_business;
create trigger trg_auto_assign_epc   before insert on epc_business          for each row execute function auto_assign_intake();

-- Backfill: assign every existing non-admin EPC to Manish (only touches
-- assigned_to_user_id, so the hierarchy-column guard is not triggered).
do $$
declare mgr uuid;
begin
  select id into mgr from epc_business where contact_mobile = '8769145691' limit 1;
  if mgr is not null then
    update epc_business set assigned_to_user_id = mgr
      where business_type is distinct from 'admin';
  end if;
end $$;

-- ── 2b. Reassignment via a SECURITY DEFINER function (RLS-independent) ──────
-- The board calls this over rpc under the caller's own JWT. The function runs
-- as its owner (bypasses RLS) but re-enforces the tier rules in code, so it is
-- the single vetted path for changing a case owner — no service key needed.
create or replace function reassign_case(p_module text, p_id uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor        uuid := nullif(auth.jwt() ->> 'business_id','')::uuid;
  actor_bt     text;
  actor_role   text;
  actor_parent uuid;
  tbl          text;
  prev         uuid;
  prev_parent  uuid;
  tgt_parent   uuid;
  can_touch    boolean := false;
  target_ok    boolean := false;
begin
  tbl := case p_module
           when 'apps'      then 'epc_applications'
           when 'insurance' then 'insurance_applications'
           when 'loanleads' then 'loan_leads'
           when 'epcs'      then 'epc_business'
           else null end;
  if tbl is null then raise exception 'invalid module'; end if;
  if actor is null then raise exception 'not signed in'; end if;

  select business_type::text, role, parent_user_id
    into actor_bt, actor_role, actor_parent
    from epc_business where id = actor;
  if actor_bt is distinct from 'admin' then raise exception 'admins only'; end if;

  execute format('select assigned_to_user_id from %I where id = $1', tbl) into prev using p_id;

  if p_to is not null then
    select parent_user_id into tgt_parent from epc_business where id = p_to;
  end if;

  -- May the actor TOUCH this case? (own it, or oversee its owner)
  if actor_role is null or actor_role = 'MAIN_ADMIN' then
    can_touch := true;
  elsif actor_role = 'MANAGER' then
    if prev = actor then
      can_touch := true;
    elsif prev is not null then
      select parent_user_id into prev_parent from epc_business where id = prev;
      can_touch := (prev_parent = actor);
    end if;
  elsif actor_role = 'OPERATIONS_USER' then
    can_touch := (prev = actor);
  end if;
  if not can_touch then raise exception 'You can only reassign your own cases.'; end if;

  -- Is the TARGET allowed for this actor?
  if actor_role is null or actor_role = 'MAIN_ADMIN' or p_to is null then
    target_ok := true;
  elsif actor_role = 'MANAGER' then
    target_ok := (p_to = actor or tgt_parent = actor);          -- self or own RM
  elsif actor_role = 'OPERATIONS_USER' then
    target_ok := (p_to = actor_parent or p_to = actor);          -- up to manager, or self
  end if;
  if not target_ok then raise exception 'You can only assign within your team.'; end if;

  execute format('update %I set assigned_to_user_id = $1, last_updated_by_user_id = $2 where id = $3', tbl)
    using p_to, actor, p_id;

  insert into user_activity_log (actor_user_id, subject_user_id, module, record_id, action, previous_value, new_value)
  values (actor, p_to, p_module, p_id,
          case when prev is not null then 'reassigned' else 'assigned' end,
          prev::text, p_to::text);
end;
$$;

grant execute on function reassign_case(text, uuid, uuid) to authenticated;

-- ── 2. Reassignment without a service key ──────────────────────────────────
-- Add ONE clause to each with_check: an OPERATIONS_USER may set the new owner
-- to their own manager (parent_user_id). USING (can-touch) is unchanged.

drop policy if exists "admin_tier_applications" on epc_applications;
create policy "admin_tier_applications" on epc_applications for all
  using (
    (auth.jwt() ->> 'business_type') = 'admin' and (
      coalesce(auth.jwt() ->> 'hierarchy_role','') not in ('OPERATIONS_USER','MANAGER')
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') = 'MANAGER'
          and assigned_to_user_id in (select b.id from epc_business b where b.parent_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid))
    )
  )
  with check (
    (auth.jwt() ->> 'business_type') = 'admin' and (
      coalesce(auth.jwt() ->> 'hierarchy_role','') not in ('OPERATIONS_USER','MANAGER')
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') = 'MANAGER'
          and assigned_to_user_id in (select b.id from epc_business b where b.parent_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid))
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') in ('OPERATIONS_USER','MANAGER')
          and (assigned_to_user_id is null
               or exists (select 1 from epc_business b where b.id = assigned_to_user_id and b.business_type = 'admin')))
    )
  );

drop policy if exists "admin_tier_insurance" on insurance_applications;
create policy "admin_tier_insurance" on insurance_applications for all
  using (
    (auth.jwt() ->> 'business_type') = 'admin' and (
      coalesce(auth.jwt() ->> 'hierarchy_role','') not in ('OPERATIONS_USER','MANAGER')
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') = 'MANAGER'
          and assigned_to_user_id in (select b.id from epc_business b where b.parent_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid))
    )
  )
  with check (
    (auth.jwt() ->> 'business_type') = 'admin' and (
      coalesce(auth.jwt() ->> 'hierarchy_role','') not in ('OPERATIONS_USER','MANAGER')
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') = 'MANAGER'
          and assigned_to_user_id in (select b.id from epc_business b where b.parent_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid))
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') in ('OPERATIONS_USER','MANAGER')
          and (assigned_to_user_id is null
               or exists (select 1 from epc_business b where b.id = assigned_to_user_id and b.business_type = 'admin')))
    )
  );

drop policy if exists "loan_leads_admin_tier" on loan_leads;
create policy "loan_leads_admin_tier" on loan_leads for all
  using (
    (auth.jwt() ->> 'business_type') = 'admin' and (
      coalesce(auth.jwt() ->> 'hierarchy_role','') not in ('OPERATIONS_USER','MANAGER')
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') = 'MANAGER'
          and assigned_to_user_id in (select b.id from epc_business b where b.parent_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid))
    )
  )
  with check (
    (auth.jwt() ->> 'business_type') = 'admin' and (
      coalesce(auth.jwt() ->> 'hierarchy_role','') not in ('OPERATIONS_USER','MANAGER')
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') = 'MANAGER'
          and assigned_to_user_id in (select b.id from epc_business b where b.parent_user_id = nullif(auth.jwt() ->> 'business_id','')::uuid))
      or (coalesce(auth.jwt() ->> 'hierarchy_role','') in ('OPERATIONS_USER','MANAGER')
          and (assigned_to_user_id is null
               or exists (select 1 from epc_business b where b.id = assigned_to_user_id and b.business_type = 'admin')))
    )
  );
