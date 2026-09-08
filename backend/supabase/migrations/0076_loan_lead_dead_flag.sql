-- =========================================================
-- 0076 — Loan-lead "dead lead" flag
--
-- A lead the team has written off. dead_at is null for live leads; set to the
-- time it was marked dead. A dead lead stays visible in the Lead tab (shown
-- with a red "Dead lead" status) but cannot be converted to a loan application
-- ("Ready for loan application" is hidden) until it is revived (dead_at → null).
--
-- Rollback: alter table loan_leads drop column if exists dead_at;
-- =========================================================

alter table loan_leads
  add column if not exists dead_at timestamptz;
