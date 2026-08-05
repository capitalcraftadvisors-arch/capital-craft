-- 0059_approval_sanction_rfd.sql
-- Approval → Sanction → RFD → Disbursement workflow.
-- New ladder stage 'rfd', a sanction-letter doc category, per-section
-- edit-lock flags, the approval-complete gate, and the sanction-letter
-- "unavailable at filling" flag. Additive only. Backfill included so live
-- approved/disbursed loans are NOT forced back through the new gates.

-- ── new enum values (not referenced elsewhere in this file, so safe) ──
alter type loan_status       add value if not exists 'rfd';
alter type loan_doc_category add value if not exists 'sanction_letter';

-- ── new columns ──────────────────────────────────────────────────
alter table epc_applications
  add column if not exists rfd_at                      timestamptz,
  add column if not exists approval_details_filled     boolean not null default false,
  add column if not exists approval_details_locked     boolean not null default false,
  add column if not exists sanction_details_locked     boolean not null default false,
  add column if not exists disbursement_details_locked boolean not null default false,
  add column if not exists sanction_letter_unavailable boolean not null default false;

-- ── backfill live rows so they don't get stuck on the new gates ───

-- (1) Already approved (or beyond) → approval-details treated as complete,
--     so the Disbursement action stays unlocked. Only flips the gate flag;
--     touches no approval data.
update epc_applications
   set approval_details_filled = true
 where approval_details is not null
    or status in ('approved', 'sent_to_nbfc', 'disbursed');

-- (2) 1st disbursement already entered → past the RFD gate. Stamp rfd_at.
--     The app derives "RFD reached" as (status = 'rfd' OR rfd_at IS NOT NULL),
--     so this marks legacy rows past-RFD WITHOUT rewriting their status enum.
update epc_applications
   set rfd_at = coalesce(approved_at, first_disbursement_date::timestamptz, reviewed_at, now())
 where first_disbursement_amount is not null
   and rfd_at is null;

-- Per-section edit-lock flags intentionally LEFT false for existing rows, so
-- an admin can still correct a legacy Approval / Sanction / Disbursement
-- section exactly once before it locks. sanction_letter_unavailable stays
-- false (legacy rows simply have no sanction letter and show no note).
