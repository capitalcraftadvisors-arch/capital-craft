-- 0121 — Pendings v2: save → locked → the main admin checks (approve / send back / edit / undo).
--
-- Approval details, the 1st disbursement and the 2nd disbursement each follow:
--   * a team member (MANAGER / OPERATIONS_USER) fills and saves → 'pending', and the
--     saved details are LOCKED for the team;
--   * the main admin approves → 'approved' (stays locked for the team: only the main
--     admin can change approved details), or sends it back with a reason →
--     'sent_back' (the team can correct and save again → 'pending'), or undoes
--     a decision → 'pending';
--   * the next stage opens for the team only once the previous one is approved:
--     approval → 1st disbursement → 2nd disbursement (+ the completion-docs review).
-- NULL = a legacy row (before 0092) — never locked, never gating.
-- The main admin (and a legacy admin JWT with no hierarchy_role, as 0067) and the
-- service role are never restricted. Replaces 0092's enforce_pending_review().

alter table epc_applications
  drop constraint if exists epc_applications_approval_review_status_check,
  drop constraint if exists epc_applications_disb1_review_status_check,
  drop constraint if exists epc_applications_disb2_review_status_check;

alter table epc_applications
  add constraint epc_applications_approval_review_status_check check (approval_review_status in ('pending','approved','sent_back')),
  add constraint epc_applications_disb1_review_status_check    check (disb1_review_status    in ('pending','approved','sent_back')),
  add constraint epc_applications_disb2_review_status_check    check (disb2_review_status    in ('pending','approved','sent_back')),
  add column if not exists approval_review_note text,   -- the admin's send-back reason
  add column if not exists disb1_review_note    text,
  add column if not exists disb2_review_note    text;

create or replace function enforce_pending_review()
returns trigger as $$
declare
  caller_type text;
  caller_role text;
  approval_open boolean;
  disb1_open boolean;
begin
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type is null then return new; end if;   -- service role
  caller_role := coalesce(auth.jwt() ->> 'hierarchy_role', '');
  if caller_type = 'admin' and caller_role in ('MAIN_ADMIN', '') then return new; end if;

  -- 1. Only the main admin decides: approve, send back, undo an approval, write the reason.
  if (new.approval_review_status in ('approved','sent_back') and new.approval_review_status is distinct from old.approval_review_status)
  or (new.disb1_review_status    in ('approved','sent_back') and new.disb1_review_status    is distinct from old.disb1_review_status)
  or (new.disb2_review_status    in ('approved','sent_back') and new.disb2_review_status    is distinct from old.disb2_review_status)
  or (old.approval_review_status = 'approved' and new.approval_review_status is distinct from old.approval_review_status)
  or (old.disb1_review_status    = 'approved' and new.disb1_review_status    is distinct from old.disb1_review_status)
  or (old.disb2_review_status    = 'approved' and new.disb2_review_status    is distinct from old.disb2_review_status)
  or new.approval_review_note is distinct from old.approval_review_note
  or new.disb1_review_note    is distinct from old.disb1_review_note
  or new.disb2_review_note    is distinct from old.disb2_review_note
  then
    raise exception 'review_main_admin_only' using errcode = 'check_violation';
  end if;

  if caller_type <> 'admin' then return new; end if;  -- EPCs never write these fields (0044)

  approval_open := old.approval_review_status is null or old.approval_review_status = 'approved';
  disb1_open    := old.disb1_review_status    is null or old.disb1_review_status    = 'approved';

  -- 2. Saved approval details: locked while they wait for the check, and once approved.
  if old.approval_review_status in ('pending','approved') and (
       new.approval_details        is distinct from old.approval_details
    or new.approved_lender         is distinct from old.approved_lender
    or new.sanctioned_amount       is distinct from old.sanctioned_amount
    or new.approval_details_filled is distinct from old.approval_details_filled
    or new.credit_score            is distinct from old.credit_score
    or new.credit_ntc              is distinct from old.credit_ntc)
  then
    raise exception 'review_locked' using errcode = 'check_violation';
  end if;

  -- 3. 1st disbursement (+ its charges): opens once the approval is approved;
  --    locked once saved, and once approved.
  if new.first_disbursement_amount is distinct from old.first_disbursement_amount
  or new.first_disbursement_date   is distinct from old.first_disbursement_date
  or new.first_processing_fee      is distinct from old.first_processing_fee
  or new.first_legal_charges       is distinct from old.first_legal_charges
  or new.first_cersai_charges      is distinct from old.first_cersai_charges
  then
    if not approval_open then
      raise exception 'disbursement_locked_pending_approval' using errcode = 'check_violation';
    end if;
    if old.disb1_review_status in ('pending','approved') then
      raise exception 'review_locked' using errcode = 'check_violation';
    end if;
  end if;

  -- 4. Completion-docs review + 2nd disbursement: open once the 1st disbursement is approved.
  if new.second_disbursement_amount is distinct from old.second_disbursement_amount
  or new.second_disbursement_date   is distinct from old.second_disbursement_date
  or new.completion_docs_status     is distinct from old.completion_docs_status
  then
    if not approval_open then
      raise exception 'disbursement_locked_pending_approval' using errcode = 'check_violation';
    end if;
    if not disb1_open then
      raise exception 'disbursement_locked_pending_disb1' using errcode = 'check_violation';
    end if;
    if old.disb2_review_status in ('pending','approved') and (
         new.second_disbursement_amount is distinct from old.second_disbursement_amount
      or new.second_disbursement_date   is distinct from old.second_disbursement_date)
    then
      raise exception 'review_locked' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;
