-- =========================================================
-- 0044 — Loan disbursement tracking.
--
-- COLUMNS (all on epc_applications, all nullable/additive):
--   sanctioned_amount           what the lender actually sanctioned. Denormalised
--                               from approval_details->>'approved_loan_amount' and
--                               written at approval time. Kept as a REAL column, not
--                               read out of the jsonb, because approval_details is
--                               explicitly a free-form table the admin can restructure
--                               (see ApprovalDetailsTable) — a field rename there must
--                               not silently break disbursement math, lists or sorting.
--   first_disbursement_amount / _date    1st tranche. The DATE starts the 45-day clock.
--   second_disbursement_amount / _date   2nd tranche (after completion-doc review).
--   disbursement_deadline       GENERATED: first_disbursement_date + 45 days. Stored +
--                               always derived, so it can never drift out of sync and is
--                               still sortable/queryable. Null until the 1st is entered.
--   completion_docs_status      admin's review state over the 3 completion docs.
--   completion_reviewed_at/_by  audit of that review.
--
-- The 45-day deadline is a FLAG, not a gate: overdue turns the countdown red for
-- review, it never auto-blocks anything.
--
-- TRIGGER — enforce_disbursement_admin_only:
--   epc_applications' RLS policy "own_applications" is `for all`, so an EPC can
--   UPDATE their own row. Hiding the inputs in the UI is not enough — an EPC could
--   PATCH the disbursement columns directly through the API. This trigger blocks any
--   non-admin caller from CHANGING a disbursement column, matching the requirement
--   that only admins enter amounts (EPCs may view them + upload the 3 docs).
--   Modelled on 0010's self-edit lock triggers: admin passes, service role (no JWT)
--   passes, everyone else raises.
--
-- BACKFILL: fills sanctioned_amount for already-approved rows from the approval
-- table. Only touches rows where it is currently NULL — no data is overwritten.
--
-- Rollback:
--   drop trigger if exists trg_disbursement_admin_only on epc_applications;
--   drop function if exists enforce_disbursement_admin_only();
--   alter table epc_applications
--     drop column if exists disbursement_deadline,
--     drop column if exists sanctioned_amount,
--     drop column if exists first_disbursement_amount,
--     drop column if exists first_disbursement_date,
--     drop column if exists second_disbursement_amount,
--     drop column if exists second_disbursement_date,
--     drop column if exists completion_docs_status,
--     drop column if exists completion_reviewed_at,
--     drop column if exists completion_reviewed_by;
-- =========================================================

-- ── Columns ──────────────────────────────────────────────
alter table epc_applications
  add column if not exists sanctioned_amount          numeric,
  add column if not exists first_disbursement_amount  numeric,
  add column if not exists first_disbursement_date    date,
  add column if not exists second_disbursement_amount numeric,
  add column if not exists second_disbursement_date   date,
  add column if not exists completion_docs_status     text,
  add column if not exists completion_reviewed_at     timestamptz,
  add column if not exists completion_reviewed_by     text;

-- Always exactly first_disbursement_date + 45 days; null until the 1st is entered.
alter table epc_applications
  add column if not exists disbursement_deadline date
  generated always as (first_disbursement_date + 45) stored;

alter table epc_applications
  drop constraint if exists epc_applications_completion_docs_status_check;
alter table epc_applications
  add constraint epc_applications_completion_docs_status_check
  check (completion_docs_status is null
         or completion_docs_status in ('pending', 'submitted', 'approved', 'rejected'));

comment on column epc_applications.sanctioned_amount is
  'Lender-sanctioned amount, denormalised from approval_details at approval time. Basis for disbursement math.';
comment on column epc_applications.disbursement_deadline is
  'Generated: first_disbursement_date + 45 days. Overdue flags for review; never auto-blocks.';

-- ── Admin-only disbursement writes ───────────────────────
create or replace function enforce_disbursement_admin_only()
returns trigger as $$
declare
  caller_type text;
begin
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type = 'admin' then return new; end if;
  if caller_type is null then return new; end if;   -- service role

  if new.sanctioned_amount          is distinct from old.sanctioned_amount
  or new.first_disbursement_amount  is distinct from old.first_disbursement_amount
  or new.first_disbursement_date    is distinct from old.first_disbursement_date
  or new.second_disbursement_amount is distinct from old.second_disbursement_amount
  or new.second_disbursement_date   is distinct from old.second_disbursement_date
  or new.completion_docs_status     is distinct from old.completion_docs_status
  or new.completion_reviewed_at     is distinct from old.completion_reviewed_at
  or new.completion_reviewed_by     is distinct from old.completion_reviewed_by
  then
    raise exception 'disbursement_admin_only' using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_disbursement_admin_only on epc_applications;
create trigger trg_disbursement_admin_only
  before update on epc_applications
  for each row execute function enforce_disbursement_admin_only();

-- ── Backfill sanctioned_amount for already-approved rows ─
-- Only fills NULLs; never overwrites an existing value.
update epc_applications
set sanctioned_amount = nullif(approval_details ->> 'approved_loan_amount', '')::numeric
where sanctioned_amount is null
  and approval_details is not null
  and nullif(approval_details ->> 'approved_loan_amount', '') is not null;
