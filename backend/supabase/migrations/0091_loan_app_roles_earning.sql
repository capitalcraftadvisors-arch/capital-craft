-- =========================================================
-- 0091 — Loan application: applicant / co-applicant earning + role reason
--
-- The EPC chatbot now decides who is the applicant and who is the
-- co-applicant (applicant must be 21..60 and earning; the electricity-bill
-- owner is the co-applicant when they can't apply). It records, per person,
-- whether they earn and their monthly income, and why a co-applicant was
-- added. The applicant's monthly income reuses the existing monthly_income
-- column (0001) — already read by the Credit Fair email.
--
-- All nullable, no backfill. Shown on the admin profile only when present.
--
-- Rollback:
--   alter table epc_applications drop column if exists coapp_role_reason;
--   alter table epc_applications drop column if exists coapp_monthly_income;
--   alter table epc_applications drop column if exists coapp_earning;
--   alter table epc_applications drop column if exists applicant_earning;
-- =========================================================

alter table epc_applications
  add column if not exists applicant_earning    boolean,
  add column if not exists coapp_earning        boolean,
  add column if not exists coapp_monthly_income numeric(12,2),
  add column if not exists coapp_role_reason    text;
