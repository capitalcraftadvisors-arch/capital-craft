-- =========================================================
-- 0057 — Loan status-ladder bookkeeping columns
--
-- Timestamps for the two new manual transitions + the "prior status" needed
-- to Resume a held case back to where it was. All additive/nullable, so
-- existing rows are untouched. status_before_hold is loan_status typed (the
-- type already exists; this does not USE the new 'docs_sent' value).
--
-- Rollback:
--   alter table epc_applications
--     drop column if exists docs_sent_at,
--     drop column if exists hold_at,
--     drop column if exists status_before_hold;
-- =========================================================

alter table epc_applications
  add column if not exists docs_sent_at       timestamptz,
  add column if not exists hold_at            timestamptz,
  add column if not exists status_before_hold loan_status;

comment on column epc_applications.docs_sent_at is
  'When admin marked docs sent to lender (status -> docs_sent).';
comment on column epc_applications.hold_at is
  'When the case was put on hold (status -> on_hold).';
comment on column epc_applications.status_before_hold is
  'Status immediately before Hold; Resume restores it.';
