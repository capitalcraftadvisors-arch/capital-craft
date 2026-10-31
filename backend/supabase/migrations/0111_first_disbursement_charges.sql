-- 0111 — 1st-disbursement charges. With the 1st disbursement the admin now
-- also enters the lender's deductions:
--   first_processing_fee   Processing Fees Charged (including GST)
--   first_legal_charges    Legal document charges
--   first_cersai_charges   CERSAI Hypothecation charges
-- so the 2nd disbursement must equal
--   sanctioned_amount − (first_disbursement_amount + the three charges).
--
-- They get the same protection as the disbursement amounts (0044 / 0092),
-- in a trigger of their own so those functions stay untouched:
--   * only an admin (or the service role) can change them;
--   * no change while the approval details await the main admin's check.

alter table epc_applications
  add column if not exists first_processing_fee numeric,
  add column if not exists first_legal_charges  numeric,
  add column if not exists first_cersai_charges numeric;

create or replace function enforce_first_charges()
returns trigger as $$
declare
  caller_type text;
  caller_role text;
begin
  if new.first_processing_fee is not distinct from old.first_processing_fee
     and new.first_legal_charges is not distinct from old.first_legal_charges
     and new.first_cersai_charges is not distinct from old.first_cersai_charges then
    return new;
  end if;
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type is null then return new; end if;   -- service role
  if caller_type is distinct from 'admin' then
    raise exception 'disbursement_admin_only' using errcode = 'check_violation';
  end if;
  caller_role := coalesce(auth.jwt() ->> 'hierarchy_role', '');
  if caller_role not in ('MAIN_ADMIN', '') and old.approval_review_status = 'pending' then
    raise exception 'disbursement_locked_pending_approval' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_first_charges on epc_applications;
create trigger trg_first_charges
  before update on epc_applications
  for each row execute function enforce_first_charges();
