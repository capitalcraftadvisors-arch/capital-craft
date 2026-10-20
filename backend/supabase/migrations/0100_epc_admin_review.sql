-- 0100 — EPC pendings: the main admin checks an EPC profile after the team
-- (Manish / Malvika) approves it, before the team can email lenders or change
-- its lender status.
--
--   admin_review_status  'pending'  = the team approved it; waits on /admin/pendings
--                        'approved' = the main admin checked it (or approved it himself)
--                        NULL       = approved before this feature, or not approved — never locked
--
-- Enforced in the database, not just the UI:
--   * epc_business: when a team member approves a profile it becomes 'pending';
--     only the main admin (or service role) can change the check; leaving
--     "approved" clears it (a fresh approval needs a fresh check).
--   * epc_lender_status: a team member can't change a lender status while the
--     profile is pending, nor send docs / approve a lender before the profile is
--     approved at all.
-- A legacy admin JWT with no hierarchy_role is the main admin (as 0067 / 0092).

alter table epc_business
  add column if not exists admin_review_status text check (admin_review_status in ('pending', 'approved')),
  add column if not exists admin_reviewed_at   timestamptz,
  add column if not exists admin_reviewed_by   text;

create index if not exists epc_business_admin_pending_idx on epc_business (id) where admin_review_status = 'pending';

-- A team member = an admin JWT that isn't the main admin.
create or replace function jwt_is_team_admin() returns boolean
language sql stable as $$
  select coalesce(nullif(auth.jwt() ->> 'business_type', '') = 'admin'
     and coalesce(auth.jwt() ->> 'hierarchy_role', '') not in ('MAIN_ADMIN', ''), false);
$$;

create or replace function enforce_epc_admin_review()
returns trigger as $$
begin
  if new.status is distinct from 'approved' then
    new.admin_review_status := null; new.admin_reviewed_at := null; new.admin_reviewed_by := null;
    return new;
  end if;
  if jwt_is_team_admin() then
    if old.status is distinct from 'approved' then
      -- the team's approval always waits for the main admin's check
      new.admin_review_status := 'pending'; new.admin_reviewed_at := null; new.admin_reviewed_by := null;
    else
      -- and the team can't change the check itself
      new.admin_review_status := old.admin_review_status;
      new.admin_reviewed_at := old.admin_reviewed_at;
      new.admin_reviewed_by := old.admin_reviewed_by;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_epc_admin_review on epc_business;
create trigger trg_epc_admin_review
  before update on epc_business
  for each row execute function enforce_epc_admin_review();

create or replace function enforce_epc_lender_lock()
returns trigger as $$
declare
  b_status text;
  b_review text;
begin
  if not jwt_is_team_admin() then return new; end if;
  select status, admin_review_status into b_status, b_review from epc_business where id = new.business_id;
  if b_review = 'pending' then
    raise exception 'epc_pending_admin_review' using errcode = 'check_violation';
  end if;
  if (new.docs_given or new.approved) and b_status is distinct from 'approved' then
    raise exception 'epc_not_approved' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_epc_lender_lock on epc_lender_status;
create trigger trg_epc_lender_lock
  before insert or update on epc_lender_status
  for each row execute function enforce_epc_lender_lock();

-- Sidebar badge: loan pendings + EPC pendings in ONE request (RLS applies).
create or replace function admin_pending_count() returns int
language sql stable as $$
  select (select count(*) from epc_applications
           where approval_review_status = 'pending' or disb1_review_status = 'pending' or disb2_review_status = 'pending')::int
       + (select count(*) from epc_business where admin_review_status = 'pending')::int;
$$;
revoke execute on function admin_pending_count() from public, anon;
grant execute on function admin_pending_count() to authenticated;
