-- =========================================================
-- 0058 — Loan abort + lender-rejection reason
--
--   rejection_reason  — recorded when a lender rejects the application.
--   abort_reason      — recorded when an approved application is aborted.
--   aborted_at        — soft-cancel flag; when set the app reads as "Aborted"
--                       (terminal), drops out of the active summary cards, and
--                       stays in the record. Clearing it un-aborts (no UI yet).
--
-- All additive/nullable — existing rows untouched. Abort is a flag (not a new
-- loan_status value) so the prior status is preserved and nothing else breaks.
--
-- Rollback:
--   alter table epc_applications
--     drop column if exists rejection_reason,
--     drop column if exists abort_reason,
--     drop column if exists aborted_at;
-- =========================================================

alter table epc_applications
  add column if not exists rejection_reason text,
  add column if not exists abort_reason     text,
  add column if not exists aborted_at        timestamptz;

comment on column epc_applications.rejection_reason is
  'Reason recorded when a lender rejects the loan application.';
comment on column epc_applications.abort_reason is
  'Reason recorded when an approved application is aborted.';
comment on column epc_applications.aborted_at is
  'Soft-cancel flag; when set the application reads as Aborted (terminal).';
