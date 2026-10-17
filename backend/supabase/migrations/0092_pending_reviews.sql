-- 0092 — Pendings: maker-checker on approval + disbursement details.
--
-- A team member's (MANAGER / OPERATIONS_USER) approval details and 1st / 2nd
-- disbursement are saved as 'pending' and wait for the MAIN ADMIN's check on
-- /admin/pendings. The main admin's own entry is saved 'approved'. NULL = a
-- legacy row from before this feature — never pending, never locked.
--
-- The trigger enforces it server-side (client writes go through RLS):
--   * only the main admin (or service role) can set a review to 'approved';
--   * no disbursement amount / date change while the approval is pending.
-- A legacy admin JWT with no hierarchy_role is treated as the main admin (as 0067).

alter table epc_applications
  add column if not exists approval_review_status text check (approval_review_status in ('pending','approved')),
  add column if not exists approval_reviewed_at  timestamptz,
  add column if not exists approval_reviewed_by  text,
  add column if not exists disb1_review_status   text check (disb1_review_status in ('pending','approved')),
  add column if not exists disb1_reviewed_at     timestamptz,
  add column if not exists disb1_reviewed_by     text,
  add column if not exists disb2_review_status   text check (disb2_review_status in ('pending','approved')),
  add column if not exists disb2_reviewed_at     timestamptz,
  add column if not exists disb2_reviewed_by     text;

create index if not exists epc_applications_pending_review_idx on epc_applications (id)
  where approval_review_status = 'pending' or disb1_review_status = 'pending' or disb2_review_status = 'pending';

create or replace function enforce_pending_review()
returns trigger as $$
declare
  caller_type text;
  caller_role text;
begin
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type is null then return new; end if;   -- service role
  caller_role := coalesce(auth.jwt() ->> 'hierarchy_role', '');
  if caller_type = 'admin' and caller_role in ('MAIN_ADMIN', '') then return new; end if;

  if (new.approval_review_status = 'approved' and new.approval_review_status is distinct from old.approval_review_status)
  or (new.disb1_review_status    = 'approved' and new.disb1_review_status    is distinct from old.disb1_review_status)
  or (new.disb2_review_status    = 'approved' and new.disb2_review_status    is distinct from old.disb2_review_status)
  then
    raise exception 'review_main_admin_only' using errcode = 'check_violation';
  end if;

  if old.approval_review_status = 'pending' and (
       new.first_disbursement_amount  is distinct from old.first_disbursement_amount
    or new.first_disbursement_date    is distinct from old.first_disbursement_date
    or new.second_disbursement_amount is distinct from old.second_disbursement_amount
    or new.second_disbursement_date   is distinct from old.second_disbursement_date)
  then
    raise exception 'disbursement_locked_pending_approval' using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_pending_review on epc_applications;
create trigger trg_pending_review
  before update on epc_applications
  for each row execute function enforce_pending_review();
