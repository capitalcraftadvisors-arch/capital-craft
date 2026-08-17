-- =========================================================
-- 0068 — 3-tier hierarchy (Admin → Manager → RM), default-intake auto-assign,
--         and manager-subtree case scoping for the Task Manager.
--
-- Hierarchy now:
--   Admin (MAIN_ADMIN)      sees everything
--     └ Manish (MANAGER)    sees his own + every case owned by an RM who
--                           reports to him (parent_user_id = Manish)
--         └ Malvika (RM)    sees only her own cases  (+ she is the default
--                           intake RM for new unowned work)
--
-- New unowned cases (or cases created by a non-RM) auto-route to the default
-- intake RM via a BEFORE INSERT trigger, so nothing lands "nowhere".
--
-- Rollback: restore 0067 policies; drop the auto_assign triggers/function;
-- reset roles/parents; drop is_default_intake.
-- =========================================================

-- ── 1. Role restructure (identify people by mobile, not hardcoded ids) ─────
update epc_business set role = 'MANAGER'
  where contact_mobile = '8769145691';                     -- Manish → Manager

update epc_business
  set parent_user_id = (select id from epc_business where contact_mobile = '8769145691')
  where contact_mobile = '7300085864';                     -- Malvika reports to Manish

-- ── 2. Default intake RM flag ──────────────────────────────────────────────
alter table epc_business add column if not exists is_default_intake boolean not null default false;
update epc_business set is_default_intake = false;
update epc_business set is_default_intake = true where contact_mobile = '7300085864';  -- Malvika

-- ── 3. Auto-assign new work to the default intake RM ───────────────────────
-- Fires when a new case has no RM owner yet (null, or owned by a non-RM such as
-- an admin/manager/public insert). RM-created cases (owner already an
-- OPERATIONS_USER) keep their owner. Reassignment is an UPDATE, so it is never
-- affected by this INSERT trigger.
create or replace function auto_assign_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare intake uuid;
begin
  if new.assigned_to_user_id is null
     or coalesce((select b.role from epc_business b where b.id = new.assigned_to_user_id), '') <> 'OPERATIONS_USER' then
    select id into intake from epc_business where is_default_intake limit 1;
    if intake is not null then
      new.assigned_to_user_id := intake;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_assign_apps  on epc_applications;
create trigger trg_auto_assign_apps  before insert on epc_applications     for each row execute function auto_assign_intake();
drop trigger if exists trg_auto_assign_ins   on insurance_applications;
create trigger trg_auto_assign_ins   before insert on insurance_applications for each row execute function auto_assign_intake();
drop trigger if exists trg_auto_assign_leads on loan_leads;
create trigger trg_auto_assign_leads before insert on loan_leads           for each row execute function auto_assign_intake();
-- EPC onboarding: only real EPC rows, never the admin/RM user rows.
drop trigger if exists trg_auto_assign_epc   on epc_business;
create trigger trg_auto_assign_epc   before insert on epc_business
  for each row when (new.business_type is distinct from 'admin') execute function auto_assign_intake();

-- ── 4. Manager-subtree RLS (replaces 0067 scoped policies) ─────────────────
-- MAIN_ADMIN (or legacy admin w/o hierarchy_role) → all
-- MANAGER      → own + any case assigned to an RM whose parent_user_id = them
-- OPERATIONS_USER → own only
-- Predicate is identical across the three case tables.
--   self       = nullif(auth.jwt() ->> 'business_id','')::uuid
--   role_claim = auth.jwt() ->> 'hierarchy_role'

drop policy if exists "admin_scoped_applications" on epc_applications;
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
    )
  );

drop policy if exists "admin_scoped_insurance" on insurance_applications;
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
    )
  );

drop policy if exists "loan_leads_admin_scoped" on loan_leads;
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
    )
  );
